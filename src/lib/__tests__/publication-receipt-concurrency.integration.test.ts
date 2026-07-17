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
 * by a different actor.
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
    connA = new Client({ connectionString: DB_URL });
    connB = new Client({ connectionString: DB_URL });
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

    await expect(insertStale).rejects.toThrow(/approved_version_id/i);

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
    ).rejects.toThrow(/claim_id/i);
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
      expect(message).toMatch(/claim_id|not active/i);
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
    ).rejects.toThrow(/authenticated operator identity/i);

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
});
