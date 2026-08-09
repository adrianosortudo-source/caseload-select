/**
 * Deterministic concurrency regression test for corrective-release finding
 * 1 (receipt/version concurrency integrity): a stale approved version must
 * not be able to receive a publication receipt after a concurrent
 * current-version change lands.
 *
 * This is a genuine two-connection integration test against a real
 * Postgres instance -- the defect this proves closed is a Postgres
 * row-locking race (TOCTOU between a trigger's SELECT and an INSERT's
 * commit), which cannot be exercised meaningfully through mocks. Mocking
 * the database here would test that the mock behaves as programmed, not
 * that Postgres actually serializes the two transactions.
 *
 * Also covers the claim_id binding rules added by
 * supabase/migrations/20260716205822_publication_receipt_claim_binding.sql:
 * a root receipt (reconciles_receipt_id null) must name a real, active,
 * scope-matching claim; two receipt-insert attempts racing to consume the
 * SAME claim_id must yield exactly one winner; a NULL claim_id on a root
 * receipt is rejected outright; and a receipt cannot release a claim held
 * by a different actor. The composed release contract is intentional: the
 * legacy standing-claim RPC selects its path, while the current
 * 20260809150948 release triggers and 20260809170708 deliverable-scoped
 * hold function authoritatively revalidate claim and receipt inserts.
 *
 * Gated behind DIRECT_DATABASE_URL (a direct, non-pooled Postgres
 * connection string -- Supabase project settings -> Database -> Connection
 * string -> "Direct connection"; the pooled/PgBouncer transaction-mode URL
 * does not preserve session state across statements and cannot hold an
 * open, uncommitted transaction the way this test requires). Skipped
 * automatically wherever that variable is not set, exactly like this
 * repo's other environment-gated suites (e.g. the OPENROUTER_API_KEY-gated
 * eval file referenced in prior PR descriptions) -- this keeps the default
 * `vitest run` fast, offline, and secret-free, while remaining a real,
 * repeatable regression test in any environment (local dev, a dedicated CI
 * job) that supplies real database credentials.
 *
 * Fixture ids are generated fresh (crypto.randomUUID()) per test run, so
 * repeated or parallel runs never collide and a prior run's leftover rows
 * (if any) can never poison a new run. Cleanup does not attempt to DELETE
 * from publication_receipts, publication_placement_claims, or
 * content_placements: all three reject DELETE unconditionally (append-only
 * / identity-locked evidence tables -- see
 * supabase/migrations/20260715191218_20260715130100_content_placements.sql
 * and 20260716205829_publication_placement_claim_mutation_lockdown.sql),
 * and once a test has actually inserted a real receipt or claim, the
 * remaining fixture rows (content_deliverables, deliverable_versions,
 * intake_firms) become undeletable too via ON DELETE RESTRICT foreign keys
 * pointing at the now-permanent evidence rows. This is intentional
 * production behavior, not a gap: publication evidence is a permanent
 * audit trail. Against the genuinely ephemeral Postgres instance this
 * suite runs on in CI (a fresh `supabase start` stack, torn down after the
 * job) that is a complete non-issue; the only cleanup this file performs
 * is closing the two pg connections.
 *
 * Run locally: DIRECT_DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" npx vitest run src/lib/__tests__/publication-receipt-concurrency.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

// Root cause of a CI-only "Error: getaddrinfo EAI_AGAIN base" failure,
// found after five rounds of diagnosis (see PR #57 description for the
// full trail): pg-connection-string's parse() -- what `new Client({
// connectionString })` uses internally -- calls
// `new URL(str, 'postgres://base')` (node_modules/pg-connection-string/
// index.js), passing its own dummy placeholder base URL whose hostname is
// literally "base". `postgresql:` is not in the WHATWG URL "special
// schemes" list (http/https/ws/wss/ftp/file), and non-special-scheme URL
// parsing has genuinely changed across Node/V8 versions. Under CI's pinned
// Node 20 (this repo runs Node 24 locally, where it never reproduced),
// that dummy base's own hostname leaks through into the parsed result
// instead of being correctly ignored for what is already a fully
// qualified absolute URL. Confirmed directly: a diagnostic round proved
// DIRECT_DATABASE_URL itself was the correct, full connection string at
// the exact moment `new Client()` ran, ruling out every other
// explanation -- the bug is inside pg-connection-string's own parsing,
// version-pinned identically between local and CI.
//
// Fix: parse DIRECT_DATABASE_URL ourselves with a bare `new URL(url)` --
// no base argument at all -- and pass discrete host/port/user/password/
// database fields to Client instead of `connectionString`. This never
// invokes pg-connection-string's parser, sidestepping the exact
// mechanism (a base URL's own host leaking through) regardless of which
// Node version is spec-correct.
function parseDirectDatabaseUrl(url: string) {
  // Defensive normalization: a later CI run threw "Invalid URL" with the
  // (GH-Actions-masked) input showing literal surrounding double-quote
  // characters, e.g. "***127.0.0.1:54322/postgres" -- consistent with the
  // `supabase status -o env` step's dotenv-style KEY="value" output line
  // getting appended to $GITHUB_ENV, whose simple KEY=VALUE parser takes
  // everything after the first `=` literally, quotes included, unless the
  // multiline heredoc form is used. The Setup Supabase CLI step does not
  // pin an exact version, so the CLI's exact -o env quoting behaviour at
  // any given run is not something this file controls. Stripping one
  // matching pair of leading/trailing quotes (plus incidental whitespace)
  // before parsing is safe unconditionally: a well-formed URL never
  // legitimately starts or ends with a quote character.
  const trimmed = url.trim();
  const unquoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1)
      : trimmed;
  const parsed = new URL(unquoted);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

describe.skipIf(!DB_URL)("publication_receipts concurrency (real Postgres, two connections)", () => {
  // Imported lazily and only inside the gated branch: `pg` is a devDependency
  // added solely for this test, and importing it unconditionally would make
  // it a hard requirement for every `vitest run` invocation even when the
  // suite is skipped.
  let Client: typeof import("pg").Client;
  let connA: import("pg").Client;
  let connB: import("pg").Client;

  // Fresh random ids per run -- never collide across repeated or parallel
  // runs, and a previous run's rows (undeletable evidence, see file
  // docstring) can never block a new run's inserts.
  const firmId = randomUUID();
  const deliverableId = randomUUID();
  const placementId = randomUUID();
  const versionOld = randomUUID();
  const versionNew = randomUUID();
  const versionNewer = randomUUID();

  // Second and third independent deliverable/placement/version fixtures,
  // isolated from the version-race pair above, for the claim_id-binding
  // scenarios that don't need a version race of their own.
  const deliverableId2 = randomUUID();
  const placementId2 = randomUUID();
  const versionId2 = randomUUID();

  const deliverableId3 = randomUUID();
  const placementId3 = randomUUID();
  const versionId3 = randomUUID();

  // Obtained once in beforeAll: a claim on the OLD version, needed to
  // thread claim_id through even the receipt insert test 1 expects to be
  // rejected (a real caller would already hold a claim before attempting
  // to publish). Superseded by test 2's own claim on the NEW version.
  let claimOldId: string;

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    const connectionOptions = parseDirectDatabaseUrl(DB_URL!);
    connA = new Client(connectionOptions);
    connB = new Client(connectionOptions);
    await connA.connect();
    await connB.connect();

    // Throwaway fixture, fully self-contained (no real firm/client data).
    await connA.query(
      `insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Publication Receipt Concurrency Fixture', null, $2)`,
      [firmId, `concurrency-test-fixture-${firmId}`],
    );

    // --- Fixture 1: the version-race pair used by test 1 and test 2. ---
    await connA.query(
      `insert into content_deliverables
         (id, firm_id, title, content_kind, status, created_by_role)
       values ($1, $2, 'concurrency test fixture', 'text', 'draft', 'operator')`,
      [deliverableId, firmId],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
       values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [versionOld, deliverableId, firmId],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
       values ($1, $2, $3, 2, '<p>v2</p>', 'operator')`,
      [versionNew, deliverableId, firmId],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
       values ($1, $2, $3, 3, '<p>v3</p>', 'operator')`,
      [versionNewer, deliverableId, firmId],
    );
    // Approve the OLD version first -- this is the state a caller reads
    // before racing a receipt insert against a concurrent re-approval.
    await connA.query(
      `update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`,
      [versionOld, deliverableId],
    );
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, required_artifact_type, created_by_role)
       values ($1, $2, $3, 'firm_website', 'webpage', 'operator')`,
      [placementId, firmId, deliverableId],
    );

    // A real caller would already hold a claim before attempting to
    // publish -- obtain one on the OLD version now, while it is still the
    // deliverable's current approved version.
    const claimOld = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', null, 'Test Operator') as result`,
      [firmId, deliverableId, placementId, versionOld, "fixture-claim-old"],
    );
    claimOldId = claimOld.rows[0].result.claim_id;

    // --- Fixture 2: independent deliverable/placement/version for the
    // claim_id NULL-rejection and actor-mismatch scenarios. ---
    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
       values ($1, $2, 'claim binding fixture', 'text', 'draft', 'operator')`,
      [deliverableId2, firmId],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
       values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [versionId2, deliverableId2, firmId],
    );
    await connA.query(
      `update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`,
      [versionId2, deliverableId2],
    );
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
       values ($1, $2, $3, 'linkedin_post', 'operator')`,
      [placementId2, firmId, deliverableId2],
    );

    // --- Fixture 3: independent deliverable/placement/version for the
    // concurrent-same-claim_id receipt race. ---
    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
       values ($1, $2, 'same claim_id race fixture', 'text', 'draft', 'operator')`,
      [deliverableId3, firmId],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
       values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [versionId3, deliverableId3, firmId],
    );
    await connA.query(
      `update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`,
      [versionId3, deliverableId3],
    );
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
       values ($1, $2, $3, 'linkedin_post', 'operator')`,
      [placementId3, firmId, deliverableId3],
    );
  }, 30000);

  afterAll(async () => {
    // No row cleanup: see the file docstring for why. Every table this
    // suite writes to either rejects DELETE outright (publication_receipts,
    // publication_placement_claims, content_placements) or is left
    // FK-restricted by those tables once real evidence rows exist
    // (content_deliverables, deliverable_versions, intake_firms). Against
    // the ephemeral, per-job Postgres instance this suite runs on in CI,
    // that is expected and harmless.
    if (connA) await connA.end();
    if (connB) await connB.end();
  });

  it("blocks and then rejects a receipt insert racing a concurrent version change", async () => {
    // Session A: begin a transaction that re-approves the SAME deliverable
    // onto the NEW version, but does not commit yet -- this holds the row
    // lock the fixed trigger must wait on.
    await connA.query("begin");
    const updatePromise = connA.query(
      `update content_deliverables set approved_version_id = $1, current_version_id = $1 where id = $2`,
      [versionNew, deliverableId],
    );
    await updatePromise;

    // Session B: concurrently attempt to insert a receipt for the OLD
    // (pre-update) approved_version_id -- this should BLOCK on A's lock,
    // not read a stale snapshot and succeed. Names the claim obtained in
    // beforeAll: the version-drift check fires before the claim checks in
    // validate_publication_receipt_scope(), so this is still expected to
    // fail on the drift error, not a claim-related one.
    const insertStale = connB.query(
      `insert into publication_receipts
         (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
       values ($1, $2, $3, 'firm_website', $4, now(), 'https://example.test/stale', 'operator', 'Test Operator', $5)`,
      [firmId, deliverableId, placementId, versionOld, claimOldId],
    );

    // Give B's blocked query a moment to actually reach the database and
    // start waiting (proving it's blocked, not merely slow to schedule),
    // then confirm via pg_locks that B is genuinely waiting on A's lock
    // before releasing A.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const waiting = await connA.query(
      `select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock' and query ilike '%publication_receipts%'`,
    );
    expect(waiting.rows[0].n).toBeGreaterThanOrEqual(1);

    // Release A's lock. B's blocked INSERT can now proceed, re-reads the
    // POST-commit row (approved_version_id = versionNew), and must be
    // rejected by the existing drift check because it still targets
    // versionOld.
    await connA.query("commit");

    await expect(insertStale).rejects.toThrow(/exact current version \(version drift\)/i);

    // Confirm no stale-version receipt row exists.
    const { rows } = await connA.query(
      `select count(*)::int as n from publication_receipts where deliverable_id = $1 and approved_version_id = $2`,
      [deliverableId, versionOld],
    );
    expect(rows[0].n).toBe(0);

    // The rejected insert never got far enough to release the claim.
    const claimStatus = await connA.query(`select status from publication_placement_claims where id = $1`, [claimOldId]);
    expect(claimStatus.rows[0].status).toBe("active");
  }, 30000);

  it("allows a legitimate receipt to commit and then serializes the version bump after it", async () => {
    // Test 1 committed the deliverable onto versionNew. Claim it now --
    // superseding the still-active claim from beforeAll/test 1 on
    // versionOld, which was never released because that insert was
    // rejected before the release trigger ever ran.
    const claimNew = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', null, 'Test Operator', $6) as result`,
      [firmId, deliverableId, placementId, versionNew, "fixture-claim-new", claimOldId],
    );
    const claimNewResult = claimNew.rows[0].result;
    expect(claimNewResult.ok).toBe(true);
    const claimNewId: string = claimNewResult.claim_id;

    // Mirror ordering: B claims the lock first with a currently-valid
    // receipt (for the now-current versionNew); A's concurrent version
    // bump (to a further versionNewer) must wait for B, not race it.
    await connB.query("begin");
    const insertValid = connB.query(
      `insert into publication_receipts
         (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
       values ($1, $2, $3, 'firm_website', $4, now(), 'https://example.test/valid', 'operator', 'Test Operator', $5)
       returning id`,
      [firmId, deliverableId, placementId, versionNew, claimNewId],
    );
    await insertValid;

    const updateBlocked = connA.query(
      `update content_deliverables set approved_version_id = $1, current_version_id = $1 where id = $2`,
      [versionNewer, deliverableId],
    );

    await new Promise((resolve) => setTimeout(resolve, 300));
    await connB.query("commit");
    await updateBlocked;

    const { rows } = await connA.query(
      `select count(*)::int as n from publication_receipts where deliverable_id = $1 and approved_version_id = $2 and public_url = 'https://example.test/valid'`,
      [deliverableId, versionNew],
    );
    expect(rows[0].n).toBe(1);

    // The committed receipt released its claim.
    const claimStatus = await connA.query(`select status from publication_placement_claims where id = $1`, [claimNewId]);
    expect(claimStatus.rows[0].status).toBe("released");
  }, 30000);

  it("rejects a root receipt insert with claim_id explicitly NULL", async () => {
    await expect(
      connA.query(
        `insert into publication_receipts
           (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
         values ($1, $2, $3, 'linkedin_post', $4, now(), 'https://example.test/no-claim', 'operator', 'Test Operator', null)`,
        [firmId, deliverableId2, placementId2, versionId2],
      ),
    ).rejects.toThrow(/active release claim/i);
  }, 30000);

  it("rejects a receipt whose actor does not match the claim's claimed-by identity, leaving the claim active", async () => {
    const operatorId = randomUUID();
    const otherActorId = randomUUID();

    const claimResult = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', $6, 'Real Operator') as result`,
      [firmId, deliverableId2, placementId2, versionId2, "scenario-7-key", operatorId],
    );
    const claim = claimResult.rows[0].result;
    expect(claim.ok).toBe(true);
    const claimId: string = claim.claim_id;

    await expect(
      connA.query(
        `insert into publication_receipts
           (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_id, actor_name, claim_id)
         values ($1, $2, $3, 'linkedin_post', $4, now(), 'https://example.test/wrong-actor', 'operator', $5, 'Wrong Operator', $6)`,
        [firmId, deliverableId2, placementId2, versionId2, otherActorId, claimId],
      ),
    ).rejects.toThrow(/actor/i);

    const { rows } = await connA.query(`select status from publication_placement_claims where id = $1`, [claimId]);
    expect(rows[0].status).toBe("active");
  }, 30000);

  it("two concurrent receipt inserts naming the SAME claim_id yield exactly one root receipt", async () => {
    const claimResult = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', null, 'Test Operator') as result`,
      [firmId, deliverableId3, placementId3, versionId3, "scenario-5-key"],
    );
    const claim = claimResult.rows[0].result;
    expect(claim.ok).toBe(true);
    const claimId: string = claim.claim_id;

    const insertSql = `insert into publication_receipts
         (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
       values ($1, $2, $3, 'linkedin_post', $4, now(), $5, 'operator', 'Test Operator', $6)
       returning id`;

    // Fire both concurrently -- neither awaited before the other starts --
    // via two separate connections, so this is a genuine race for the same
    // claim row, not a sequential check. Promise.allSettled (rather than
    // Promise.all) so we can inspect BOTH outcomes: exactly one is expected
    // to reject, and Promise.all would otherwise short-circuit on the first
    // rejection.
    const results = await Promise.allSettled([
      connA.query(insertSql, [firmId, deliverableId3, placementId3, versionId3, "https://example.test/claim-race-a", claimId]),
      connB.query(insertSql, [firmId, deliverableId3, placementId3, versionId3, "https://example.test/claim-race-b", claimId]),
    ]);

    const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilledCount).toBe(1);

    const rejectedResult = results.find((r) => r.status === "rejected");
    expect(rejectedResult).toBeDefined();
    if (rejectedResult && rejectedResult.status === "rejected") {
      const message = String(rejectedResult.reason?.message ?? rejectedResult.reason);
      expect(message).toMatch(/active release claim/i);
    }

    const { rows } = await connA.query(`select count(*)::int as n from publication_receipts where claim_id = $1`, [claimId]);
    expect(rows[0].n).toBe(1);
  }, 30000);

  // --- Adversarial-review follow-up: findings 1 + 2
  // (20260717001444_publication_receipt_actor_binding_and_hash_trust_fix.sql).
  // Each test below is fully self-contained (creates its own firm /
  // deliverable / placement / version fixtures inline) rather than reusing
  // the beforeAll fixtures above, to avoid coupling to the existing races'
  // claim/version state.

  it("finding 1: rejects a root receipt with actor_id NULL against an actor-owned claim, leaving the claim active", async () => {
    const firm = randomUUID();
    const deliverable = randomUUID();
    const placement = randomUUID();
    const version = randomUUID();
    const ownerActorId = randomUUID();

    await connA.query(`insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Actor Binding Fixture', null, $2)`, [firm, `actor-binding-fixture-${firm}`]);
    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role) values ($1, $2, 'actor binding fixture', 'text', 'draft', 'operator')`,
      [deliverable, firm],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role) values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [version, deliverable, firm],
    );
    await connA.query(`update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`, [version, deliverable]);
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role) values ($1, $2, $3, 'linkedin_post', 'operator')`,
      [placement, firm, deliverable],
    );

    const claimResult = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', $6, 'Owner Operator') as result`,
      [firm, deliverable, placement, version, "actor-binding-key", ownerActorId],
    );
    const claimId: string = claimResult.rows[0].result.claim_id;

    // The vulnerability finding 1 fixes: actor_id NULL against a claim
    // that IS actor-owned must be rejected, not silently accepted.
    await expect(
      connA.query(
        `insert into publication_receipts
           (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_id, actor_name, claim_id)
         values ($1, $2, $3, 'linkedin_post', $4, now(), 'https://example.test/null-actor', 'operator', null, 'Anonymous', $5)`,
        [firm, deliverable, placement, version, claimId],
      ),
    ).rejects.toThrow(/authenticated claim actor/i);

    const { rows } = await connA.query(`select status from publication_placement_claims where id = $1`, [claimId]);
    expect(rows[0].status).toBe("active");
  }, 30000);

  it("finding 2: clears a caller-supplied artifact_sha256 when artifact_id is NULL, on every receipt path", async () => {
    const firm = randomUUID();
    const deliverable = randomUUID();
    const placement = randomUUID();
    const version = randomUUID();

    await connA.query(`insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Hash Clear Fixture', null, $2)`, [firm, `hash-clear-fixture-${firm}`]);
    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role) values ($1, $2, 'hash clear fixture', 'text', 'draft', 'operator')`,
      [deliverable, firm],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role) values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [version, deliverable, firm],
    );
    await connA.query(`update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`, [version, deliverable]);
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role) values ($1, $2, $3, 'linkedin_post', 'operator')`,
      [placement, firm, deliverable],
    );

    const claimResult = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', null, 'Test Operator') as result`,
      [firm, deliverable, placement, version, "hash-clear-key"],
    );
    const claimId: string = claimResult.rows[0].result.claim_id;

    // The vulnerability finding 2 fixes: artifact_id NULL, but an arbitrary
    // sha256 supplied directly on the insert. Must be stored as NULL.
    const { rows } = await connA.query(
      `insert into publication_receipts
         (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id, artifact_id, artifact_sha256)
       values ($1, $2, $3, 'linkedin_post', $4, now(), 'https://example.test/no-artifact-fake-hash', 'operator', 'Test Operator', $5, null, $6)
       returning artifact_sha256`,
      [firm, deliverable, placement, version, claimId, "deadbeef".repeat(8)],
    );
    expect(rows[0].artifact_sha256).toBeNull();
  }, 30000);

  it("keeps a V1 client-change hold on its deliverable through V2 until that exact hold is resolved", async () => {
    const firm = randomUUID();
    const lawyer = randomUUID();
    const deliverable = randomUUID();
    const otherDeliverable = randomUUID();
    const placement = randomUUID();
    const v1 = randomUUID();
    const v2 = randomUUID();
    const otherVersion = randomUUID();

    await connA.query(
      `insert into intake_firms (id, name, custom_domain, subdomain)
       values ($1, 'Deliverable Hold Fixture', null, $2)`,
      [firm, `deliverable-hold-fixture-${firm}`],
    );
    await connA.query(
      `insert into firm_lawyers (id, firm_id, email, name, role, display_name)
       values ($1, $2, 'canonical@drglaw.test', 'Canonical Lawyer', 'admin', 'Canonical Lawyer')`,
      [lawyer, firm],
    );
    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
       values ($1, $2, 'V1-to-V2 hold fixture', 'text', 'in_review', 'operator'),
              ($3, $2, 'Other resolution target', 'text', 'draft', 'operator')`,
      [deliverable, firm, otherDeliverable],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
       values ($1, $2, $3, 1, '<p>v1</p>', 'operator'),
              ($4, $2, $3, 2, '<p>v2</p>', 'operator'),
              ($5, $6, $3, 1, '<p>other</p>', 'operator')`,
      [v1, deliverable, firm, v2, otherVersion, otherDeliverable],
    );
    await connA.query(
      `update content_deliverables set current_version_id = $1 where id = $2`,
      [v1, deliverable],
    );
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
       values ($1, $2, $3, 'linkedin_post', 'operator')`,
      [placement, firm, deliverable],
    );

    // The approval RPC, rather than a hand-written hold event, proves that
    // a caller cannot forge the signer identity written into the immutable
    // changes_requested ledger.
    const changeRequest = await connA.query(
      `select record_approval_atomic(
         $1, $2, $3, 'changes_requested', 'lawyer', $4,
         'Forged signer', 'forged@example.test', 'Please revise', 1,
         'V1-to-V2 hold fixture', null, null, 'Client requested a revision', '[]'::jsonb
       ) as result`,
      [deliverable, v1, firm, lawyer],
    );
    expect(changeRequest.rows[0].result.ok).toBe(true);

    const opened = await connA.query(
      `select id, version_id, actor_name, actor_email
       from deliverable_client_change_hold_events
       where firm_id = $1 and deliverable_id = $2 and event = 'opened'`,
      [firm, deliverable],
    );
    expect(opened.rows).toHaveLength(1);
    const openedHoldId: string = opened.rows[0].id;
    expect(opened.rows[0]).toMatchObject({
      version_id: v1,
      actor_name: 'Canonical Lawyer',
      actor_email: 'canonical@drglaw.test',
    });

    // Posting V2 makes it the current standing-eligible version, but must
    // not silently clear the V1 client request.
    await connA.query(
      `update content_deliverables
       set status = 'in_review', current_version_id = $1, approved_version_id = null, approved_at = null
       where id = $2`,
      [v2, deliverable],
    );
    const enableStanding = await connA.query(
      `select set_standing_publishing_authorization(
         $1, 'enabled', 'lawyer', $2, 'Forged signer', 'forged@example.test',
         'Standing authorization text', 'v1', 'all_future_content', 'weekly_digest', null, null, null
       ) as result`,
      [firm, lawyer],
    );
    expect(enableStanding.rows[0].result.ok).toBe(true);

    const heldV2 = await connA.query(
      `select has_unresolved_deliverable_client_change_hold($1, $2, $3) as held`,
      [firm, deliverable, v2],
    );
    expect(heldV2.rows[0].held).toBe(true);

    await expect(
      connA.query(
        `select claim_placement_for_publish($1, $2, $3, $4, 'held-v2-claim', 'operator', null, 'Test Operator') as result`,
        [firm, deliverable, placement, v2],
      ),
    ).rejects.toThrow(/unresolved client change hold/i);
    await expect(
      connA.query(
        `insert into publication_receipts
           (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
         values ($1, $2, $3, 'linkedin_post', $4, now(), 'https://example.test/held-v2', 'operator', 'Test Operator', null)`,
        [firm, deliverable, placement, v2],
      ),
    ).rejects.toThrow(/unresolved client change hold/i);

    // A resolution must identify the original ledger event and its original
    // V1 audit version. Neither another deliverable nor V2 may resolve it.
    const wrongDeliverable = await connA.query(
      `select set_deliverable_client_change_hold($1, $2, $3, 'resolved', $4, 'lawyer', $5, 'Forged signer', 'forged@example.test', null) as result`,
      [firm, otherDeliverable, otherVersion, openedHoldId, lawyer],
    );
    expect(wrongDeliverable.rows[0].result).toMatchObject({ ok: false });
    expect(wrongDeliverable.rows[0].result.error).toMatch(/open client change hold not found/i);
    const wrongVersion = await connA.query(
      `select set_deliverable_client_change_hold($1, $2, $3, 'resolved', $4, 'lawyer', $5, 'Forged signer', 'forged@example.test', null) as result`,
      [firm, deliverable, v2, openedHoldId, lawyer],
    );
    expect(wrongVersion.rows[0].result).toMatchObject({ ok: false });
    expect(wrongVersion.rows[0].result.error).toMatch(/resolution version does not match/i);

    const resolved = await connA.query(
      `select set_deliverable_client_change_hold($1, $2, $3, 'resolved', $4, 'lawyer', $5, 'Forged signer', 'forged@example.test', null) as result`,
      [firm, deliverable, v1, openedHoldId, lawyer],
    );
    expect(resolved.rows[0].result.ok).toBe(true);
    const releasedV2 = await connA.query(
      `select has_unresolved_deliverable_client_change_hold($1, $2, $3) as held`,
      [firm, deliverable, v2],
    );
    expect(releasedV2.rows[0].held).toBe(false);

    // Standing authorization may now be used, but its normal release gates
    // still cannot be bypassed after the hold is resolved.
    const disableStanding = await connA.query(
      `select set_standing_publishing_authorization($1, 'disabled', 'lawyer', $2, 'Canonical Lawyer', 'canonical@drglaw.test', null, null, null, null, 'test disabled', null, null) as result`,
      [firm, lawyer],
    );
    expect(disableStanding.rows[0].result.ok).toBe(true);
    const disabledClaim = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, 'disabled-v2-claim', 'operator', null, 'Test Operator') as result`,
      [firm, deliverable, placement, v2],
    );
    expect(disabledClaim.rows[0].result.ok).toBe(false);

    await connA.query(
      `select set_standing_publishing_authorization($1, 'enabled', 'lawyer', $2, 'Canonical Lawyer', 'canonical@drglaw.test', 'Standing authorization text', 'v1', 'all_future_content', 'weekly_digest', null, null, null) as result`,
      [firm, lawyer],
    );
    await connA.query(
      `update deliverable_versions
       set requires_individual_review = true, individual_review_reason = 'Regression: individual review required'
       where id = $1`,
      [v2],
    );
    const individualReviewClaim = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, 'individual-review-v2-claim', 'operator', null, 'Test Operator') as result`,
      [firm, deliverable, placement, v2],
    );
    expect(individualReviewClaim.rows[0].result.ok).toBe(false);
    await connA.query(
      `update deliverable_versions
       set requires_individual_review = false, individual_review_reason = null
       where id = $1`,
      [v2],
    );
    await connA.query(`update content_deliverables set status = 'draft' where id = $1`, [deliverable]);
    const statusDriftClaim = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, 'status-drift-v2-claim', 'operator', null, 'Test Operator') as result`,
      [firm, deliverable, placement, v2],
    );
    expect(statusDriftClaim.rows[0].result.ok).toBe(false);
    await connA.query(`update content_deliverables set status = 'in_review' where id = $1`, [deliverable]);

    const finalClaimQuery = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, 'final-v2-claim', 'operator', null, 'Test Operator') as result`,
      [firm, deliverable, placement, v2],
    );
    const finalClaim = finalClaimQuery.rows[0].result;
    expect(finalClaim).toMatchObject({ ok: true, release_path: 'standing_authorization' });

    // Claims are snapshots, not perpetual authority: status drift after a
    // claim must stop the root receipt until the release state is restored.
    await connA.query(`update content_deliverables set status = 'draft' where id = $1`, [deliverable]);
    await expect(
      connA.query(
        `insert into publication_receipts
           (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
         values ($1, $2, $3, 'linkedin_post', $4, now(), 'https://example.test/status-drift-v2', 'operator', 'Test Operator', $5)`,
        [firm, deliverable, placement, v2, finalClaim.claim_id],
      ),
    ).rejects.toThrow(/exact individual approval or eligible in_review standing authorization/i);
    await connA.query(`update content_deliverables set status = 'in_review' where id = $1`, [deliverable]);

    const receipt = await connA.query(
      `insert into publication_receipts
         (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
       values ($1, $2, $3, 'linkedin_post', $4, now(), 'https://example.test/released-v2', 'operator', 'Test Operator', $5)
       returning release_path, standing_authorization_event_id`,
      [firm, deliverable, placement, v2, finalClaim.claim_id],
    );
    expect(receipt.rows[0].release_path).toBe('standing_authorization');
    expect(receipt.rows[0].standing_authorization_event_id).toBeTruthy();
  }, 30000);
});
