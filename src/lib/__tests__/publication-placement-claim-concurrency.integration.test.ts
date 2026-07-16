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
 * supabase/migrations/20260716210000_publication_placement_claim_mutation_lockdown.sql
 * and 20260715191218_20260715130100_content_placements.sql), and once a
 * test has actually inserted a real claim, the remaining fixture rows
 * become undeletable too via ON DELETE RESTRICT foreign keys. Against the
 * genuinely ephemeral Postgres instance this suite runs on in CI, that is
 * expected and harmless; the only cleanup this file performs is closing
 * the two pg connections.
 *
 * Run locally: DIRECT_DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" npx vitest run src/lib/__tests__/publication-placement-claim-concurrency.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

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
    connA = new Client({ connectionString: DB_URL });
    connB = new Client({ connectionString: DB_URL });
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
});
