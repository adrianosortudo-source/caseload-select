/**
 * Deterministic concurrency regression test for the adversarial-review fix
 * to claim_placement_for_publish() (supabase/migrations/
 * 20260716155746_publication_placement_claim_race_fix.sql): two callers
 * submitting the SAME NEW idempotency_key concurrently must both receive
 * the identical claim result, never a competing-claim rejection for one
 * of them. Also covers the companion case: two callers submitting
 * DIFFERENT NEW idempotency_keys for the same placement+version must
 * resolve to exactly one active claim, with the loser cleanly rejected as
 * needs_reverification rather than racing past the one-active-claim
 * invariant.
 *
 * Real two-connection integration test, same rationale and gating as
 * publication-receipt-concurrency.integration.test.ts: proving a Postgres
 * row-locking/re-check race is closed requires genuine transaction
 * control two mocked Supabase clients cannot provide. Gated behind
 * DIRECT_DATABASE_URL, skipped by default.
 *
 * Fixture ids are generated fresh (crypto.randomUUID()) per test run, so
 * repeated or parallel runs never collide. Cleanup does not attempt to
 * DELETE from publication_placement_claims, publication_receipts, or
 * content_placements: all three reject DELETE unconditionally (see
 * supabase/migrations/20260716205829_publication_placement_claim_mutation_lockdown.sql
 * and 20260715191218_20260715130100_content_placements.sql), and once a
 * test has actually inserted a real claim, the remaining fixture rows
 * become undeletable too via ON DELETE RESTRICT foreign keys. Against the
 * genuinely ephemeral Postgres instance this suite runs on in CI, that is
 * expected and harmless; the only cleanup this file performs is closing
 * the two pg connections.
 *
 * Run locally: DIRECT_DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" npx vitest run src/lib/__tests__/publication-placement-claim-concurrency.integration.test.ts
 */

import dns from "node:dns";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

// pg forwards a `lookup` option straight through to net.connect(), which
// otherwise always calls dns.lookup() -- even for a literal IP host like
// the 127.0.0.1 this file's DIRECT_DATABASE_URL always points at in CI and
// local dev. A GitHub Actions run of this file failed twice with
// "getaddrinfo EAI_AGAIN base" (a DNS resolution error) despite the target
// being a plain IP; the failure did not reproduce locally against an
// identically-migrated real Postgres instance, and only manifested under
// CI's pinned Node 20 (this repo runs Node 24 locally). Short-circuiting
// DNS for IP literals removes the lookup path entirely regardless of root
// cause; a real hostname (the "run locally against a hosted Supabase
// project" case documented in this file's sibling suites) still resolves
// normally. @types/pg does not declare `lookup` even though the runtime
// accepts it, hence the local intersection type instead of an inline
// object literal.
type ClientConfigWithLookup = import("pg").ClientConfig & {
  lookup?: (
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ) => void;
};

function lookupPreferringIpLiteral(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  const family = net.isIP(hostname);
  if (family) {
    callback(null, hostname, family);
    return;
  }
  dns.lookup(hostname, options as dns.LookupOneOptions, callback);
}

describe.skipIf(!DB_URL)("claim_placement_for_publish concurrency (real Postgres, two connections)", () => {
  let Client: typeof import("pg").Client;
  let connA: import("pg").Client;
  let connB: import("pg").Client;

  // Fixture 1: used by the same-key idempotency race.
  const firmId = randomUUID();
  const deliverableId = randomUUID();
  const placementId = randomUUID();
  const versionId = randomUUID();

  // Fixture 2: independent placement/version for the different-key race,
  // so it starts with no active claim of its own (the same-key test's
  // winning claim would otherwise still be 'active' and block a fresh
  // claim attempt on the same placement).
  const deliverableId2 = randomUUID();
  const placementId2 = randomUUID();
  const versionId2 = randomUUID();

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    const clientOptions: ClientConfigWithLookup = { connectionString: DB_URL, lookup: lookupPreferringIpLiteral };
    connA = new Client(clientOptions);
    connB = new Client(clientOptions);
    await connA.connect();
    await connB.connect();

    await connA.query(
      `insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Claim Concurrency Fixture', null, $2)`,
      [firmId, `claim-concurrency-fixture-${firmId}`],
    );

    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
       values ($1, $2, 'claim concurrency fixture', 'text', 'draft', 'operator')`,
      [deliverableId, firmId],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
       values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [versionId, deliverableId, firmId],
    );
    await connA.query(
      `update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`,
      [versionId, deliverableId],
    );
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
       values ($1, $2, $3, 'linkedin_post', 'operator')`,
      [placementId, firmId, deliverableId],
    );

    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
       values ($1, $2, 'claim concurrency fixture 2', 'text', 'draft', 'operator')`,
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
  }, 30000);

  afterAll(async () => {
    // No row cleanup: see the file docstring for why -- publication_placement_claims
    // rejects DELETE outright once a real claim exists, and the rest of the
    // fixture chain becomes FK-restricted behind it. Harmless against the
    // ephemeral, per-job Postgres instance this suite runs on in CI.
    if (connA) await connA.end();
    if (connB) await connB.end();
  });

  it("two concurrent calls with the SAME NEW idempotency key both receive the identical claim, never a competing-claim rejection", async () => {
    const sameKey = "concurrent-same-key-test";

    // Fire both RPC calls truly concurrently -- neither awaited before the
    // other starts -- so both reach the unlocked fast-path idempotency
    // check before either has inserted a row.
    const [resultA, resultB] = await Promise.all([
      connA.query(
        `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', null, 'Connection A') as result`,
        [firmId, deliverableId, placementId, versionId, sameKey],
      ),
      connB.query(
        `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', null, 'Connection B') as result`,
        [firmId, deliverableId, placementId, versionId, sameKey],
      ),
    ]);

    const a = resultA.rows[0].result;
    const b = resultB.rows[0].result;

    // Both must succeed.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    // Both must reference the SAME claim -- this is the actual bug: before
    // the fix, the losing caller received ok:false with
    // next_action:needs_reverification instead of the winner's claim_id.
    expect(a.claim_id).toBe(b.claim_id);

    // Exactly one of the two results is the real insert (idempotent_replay
    // false) and the other is the replay (idempotent_replay true) -- proving
    // one caller actually won the insert and the other genuinely observed
    // it via the re-check, rather than e.g. both racing to insert and one
    // silently overwriting/duplicating.
    const replayFlags = [a.idempotent_replay, b.idempotent_replay].sort();
    expect(replayFlags).toEqual([false, true]);

    // Exactly one row exists for this key -- no duplicate claim was created.
    const { rows } = await connA.query(
      `select count(*)::int as n from publication_placement_claims where placement_id = $1 and idempotency_key = $2`,
      [placementId, sameKey],
    );
    expect(rows[0].n).toBe(1);
  }, 30000);

  it("two concurrent calls with DIFFERENT NEW idempotency keys yield exactly one active claim; the loser is rejected as needs_reverification", async () => {
    // Fire both with Promise.all, neither awaited before the other starts,
    // against the SAME placement+version with two DIFFERENT new keys -- a
    // genuine race for the one-active-claim-per-placement invariant, not a
    // sequential check.
    const [resultA, resultB] = await Promise.all([
      connA.query(
        `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', null, 'Connection A') as result`,
        [firmId, deliverableId2, placementId2, versionId2, "concurrent-different-key-a"],
      ),
      connB.query(
        `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', null, 'Connection B') as result`,
        [firmId, deliverableId2, placementId2, versionId2, "concurrent-different-key-b"],
      ),
    ]);

    const outcomes = [resultA.rows[0].result, resultB.rows[0].result];
    const winners = outcomes.filter((r) => r.ok === true);
    const losers = outcomes.filter((r) => r.ok === false);

    // Exactly one call wins the claim; the other is rejected -- which one
    // wins is a genuine race and deliberately not asserted.
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(winners[0].status).toBe("active");
    expect(losers[0].next_action).toBe("needs_reverification");

    // Only one active claim exists on this placement afterward.
    const { rows } = await connA.query(
      `select count(*)::int as n from publication_placement_claims where placement_id = $1 and status = 'active'`,
      [placementId2],
    );
    expect(rows[0].n).toBe(1);
  }, 30000);

  // Adversarial-review follow-up, finding 4
  // (20260717001510_publication_placement_claim_idempotency_identity_scoping.sql):
  // the SAME idempotency key reused with a DIFFERENT request identity must
  // fail closed, never silently hand back the original claim as a "replay."
  // Self-contained fixture (own firm/deliverable/placement/versions) so it
  // does not interact with the two races above.
  it("the same idempotency key reused with a different approved_version_id fails closed instead of returning the mismatched claim as a replay", async () => {
    const firm = randomUUID();
    const deliverable = randomUUID();
    const placement = randomUUID();
    const versionA = randomUUID();
    const versionB = randomUUID();
    const actorId = randomUUID();

    await connA.query(`insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Idempotency Scoping Fixture', null, $2)`, [firm, `idempotency-scoping-fixture-${firm}`]);
    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role) values ($1, $2, 'idempotency scoping fixture', 'text', 'draft', 'operator')`,
      [deliverable, firm],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role) values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [versionA, deliverable, firm],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role) values ($1, $2, $3, 2, '<p>v2</p>', 'operator')`,
      [versionB, deliverable, firm],
    );
    await connA.query(`update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`, [versionA, deliverable]);
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role) values ($1, $2, $3, 'linkedin_post', 'operator')`,
      [placement, firm, deliverable],
    );

    const key = "same-key-different-identity";
    const first = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', $6, 'Actor A') as result`,
      [firm, deliverable, placement, versionA, key, actorId],
    );
    expect(first.rows[0].result.ok).toBe(true);
    const realClaimId: string = first.rows[0].result.claim_id;

    // Same key, different approved_version_id -- must fail closed, not
    // return realClaimId as an ok:true replay.
    const mismatched = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', $6, 'Actor A') as result`,
      [firm, deliverable, placement, versionB, key, actorId],
    );
    const result = mismatched.rows[0].result;
    expect(result.ok).toBe(false);
    expect(result.next_action).toBe("use_new_idempotency_key");
    expect(result.existing_claim_id).toBe(realClaimId);

    // The real claim was never mutated by the mismatched-identity attempt.
    const { rows } = await connA.query(
      `select status, approved_version_id from publication_placement_claims where id = $1`,
      [realClaimId],
    );
    expect(rows[0].status).toBe("active");
    expect(rows[0].approved_version_id).toBe(versionA);

    // The identical request (same key, same full identity) still replays
    // cleanly -- the fix must not have broken genuine idempotent replay.
    const replay = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', $6, 'Actor A') as result`,
      [firm, deliverable, placement, versionA, key, actorId],
    );
    expect(replay.rows[0].result.ok).toBe(true);
    expect(replay.rows[0].result.claim_id).toBe(realClaimId);
    expect(replay.rows[0].result.idempotent_replay).toBe(true);
  }, 30000);

  // Codex independent release review of PR #47, gap 1
  // (20260717015014_publication_placement_claim_idempotency_firm_scoping.sql):
  // the finding-4 identity guard above compared deliverable_id,
  // approved_version_id, claimed_by_role, claimed_by_id, and
  // supersedes_claim_id, but never firm_id -- since the lookup itself is
  // scoped only by (placement_id, idempotency_key), a same-key request
  // naming a DIFFERENT firm_id could still pass every other check and be
  // handed back another firm's claim as an ok:true "replay." Self-contained
  // two-firm fixture so it does not interact with any other race in this
  // file.
  it("the same idempotency key reused with a different p_firm_id (otherwise identical inputs) fails closed instead of returning the other firm's claim as a replay", async () => {
    const firmA = randomUUID();
    const firmB = randomUUID();
    const deliverable = randomUUID();
    const placement = randomUUID();
    const version = randomUUID();
    const actorId = randomUUID();

    await connA.query(`insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Firm Scoping Fixture A', null, $2)`, [firmA, `firm-scoping-fixture-a-${firmA}`]);
    await connA.query(`insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Firm Scoping Fixture B', null, $2)`, [firmB, `firm-scoping-fixture-b-${firmB}`]);
    await connA.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role) values ($1, $2, 'firm scoping fixture', 'text', 'draft', 'operator')`,
      [deliverable, firmA],
    );
    await connA.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role) values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [version, deliverable, firmA],
    );
    await connA.query(`update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`, [version, deliverable]);
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role) values ($1, $2, $3, 'linkedin_post', 'operator')`,
      [placement, firmA, deliverable],
    );

    const key = "same-key-different-firm";
    const first = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', $6, 'Actor A') as result`,
      [firmA, deliverable, placement, version, key, actorId],
    );
    expect(first.rows[0].result.ok).toBe(true);
    const realClaimId: string = first.rows[0].result.claim_id;

    // Same placement_id + idempotency_key, DIFFERENT p_firm_id, otherwise
    // identical inputs (same deliverable/placement/version/actor as
    // firmA's real claim) -- must fail closed, not return realClaimId as
    // an ok:true replay for firmB.
    const crossFirm = await connA.query(
      `select claim_placement_for_publish($1, $2, $3, $4, $5, 'operator', $6, 'Actor A') as result`,
      [firmB, deliverable, placement, version, key, actorId],
    );
    const result = crossFirm.rows[0].result;
    expect(result.ok).toBe(false);
    expect(result.next_action).toBe("use_new_idempotency_key");
    expect(result.existing_claim_id).toBe(realClaimId);

    // The original firm-A claim was never mutated by the cross-firm attempt.
    const { rows } = await connA.query(
      `select status, firm_id from publication_placement_claims where id = $1`,
      [realClaimId],
    );
    expect(rows[0].status).toBe("active");
    expect(rows[0].firm_id).toBe(firmA);

    // Exactly one row exists for this key -- no cross-firm duplicate claim
    // was ever created.
    const { rows: countRows } = await connA.query(
      `select count(*)::int as n from publication_placement_claims where idempotency_key = $1`,
      [key],
    );
    expect(countRows[0].n).toBe(1);
  }, 30000);
});
