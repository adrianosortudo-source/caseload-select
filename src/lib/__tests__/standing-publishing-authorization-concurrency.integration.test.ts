/**
 * Deterministic concurrency test for set_standing_publishing_authorization
 * (supabase/migrations/20260717230956_standing_publishing_authorization.sql):
 * two lawyer sessions for the SAME firm calling enable/disable at the same
 * instant must never race into an ambiguous "current state" -- the RPC
 * locks the intake_firms row (`for update`) so the two calls serialize,
 * and event_seq (an identity column) then gives whichever call committed
 * second a strictly greater sequence number, making "latest wins" always
 * well-defined.
 *
 * Real two-connection integration test, same rationale and gating as
 * publication-placement-claim-concurrency.integration.test.ts: proving a
 * Postgres row-locking race is closed requires genuine transaction
 * control two mocked Supabase clients cannot provide. Gated behind
 * DIRECT_DATABASE_URL, skipped by default.
 *
 * Cleanup does not attempt to DELETE from standing_publishing_authorizations
 * (it rejects DELETE unconditionally, see block_append_only_mutation) or
 * intake_firms (firm_lawyers/standing_publishing_authorizations hold
 * ON DELETE RESTRICT/CASCADE references into it once real rows exist).
 * Harmless against the ephemeral, per-job Postgres instance this suite
 * runs on in CI.
 *
 * Run locally: DIRECT_DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" npx vitest run src/lib/__tests__/standing-publishing-authorization-concurrency.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

describe.skipIf(!DB_URL)("set_standing_publishing_authorization concurrency (real Postgres, two connections)", () => {
  let Client: typeof import("pg").Client;
  let connA: import("pg").Client;
  let connB: import("pg").Client;

  const firmId = randomUUID();
  const lawyerId = randomUUID();

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    connA = new Client({ connectionString: DB_URL });
    connB = new Client({ connectionString: DB_URL });
    await connA.connect();
    await connB.connect();

    await connA.query(
      `insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Standing Auth Concurrency Fixture', null, $2)`,
      [firmId, `standing-auth-concurrency-fixture-${firmId}`],
    );
    await connA.query(
      `insert into firm_lawyers (id, firm_id, email, name, role, display_name) values ($1, $2, 'damaris@drglaw.test', 'Damaris', 'admin', 'Damaris')`,
      [lawyerId, firmId],
    );
  }, 30000);

  afterAll(async () => {
    if (connA) await connA.end();
    if (connB) await connB.end();
  });

  it("two concurrent enable calls for the same firm both succeed with strictly sequential event_seq, never a lost update", async () => {
    const [resultA, resultB] = await Promise.all([
      connA.query(
        `select set_standing_publishing_authorization($1, 'enabled', 'lawyer', $2, 'Damaris', 'damaris@drglaw.test', 'auth text A', 'v1', 'all_future_content', 'weekly_digest', null, null, null) as result`,
        [firmId, lawyerId],
      ),
      connB.query(
        `select set_standing_publishing_authorization($1, 'enabled', 'lawyer', $2, 'Damaris', 'damaris@drglaw.test', 'auth text B', 'v1', 'all_future_content', 'weekly_digest', null, null, null) as result`,
        [firmId, lawyerId],
      ),
    ]);

    const a = resultA.rows[0].result;
    const b = resultB.rows[0].result;
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    // Both calls created their own row (this RPC has no idempotency-key
    // dedup, unlike claim_placement_for_publish) -- two distinct event
    // ids, with strictly sequential, never-equal event_seq values.
    expect(a.event_id).not.toBe(b.event_id);
    const seqs = [a.event_seq, b.event_seq].sort((x, y) => x - y);
    expect(seqs[1]).toBe(seqs[0] + 1);

    const { rows } = await connA.query(
      `select count(*)::int as n from standing_publishing_authorizations where firm_id = $1`,
      [firmId],
    );
    expect(rows[0].n).toBe(2);

    // "Latest state" is unambiguous: exactly one row has the max event_seq.
    const latest = await connA.query(
      `select id, event_seq from standing_publishing_authorizations where firm_id = $1 order by event_seq desc limit 1`,
      [firmId],
    );
    expect(latest.rows).toHaveLength(1);
    expect(latest.rows[0].event_seq).toBe(seqs[1]);
  }, 30000);

  it("a concurrent enable and disable for the same firm resolve deterministically: exactly one becomes the latest state", async () => {
    const [enableResult, disableResult] = await Promise.all([
      connA.query(
        `select set_standing_publishing_authorization($1, 'enabled', 'lawyer', $2, 'Damaris', 'damaris@drglaw.test', 'auth text', 'v1', 'all_future_content', 'weekly_digest', null, null, null) as result`,
        [firmId, lawyerId],
      ),
      connB.query(
        `select set_standing_publishing_authorization($1, 'disabled', 'lawyer', $2, 'Damaris', 'damaris@drglaw.test', null, null, null, null, 'concurrent disable', null, null) as result`,
        [firmId, lawyerId],
      ),
    ]);

    const enableRow = enableResult.rows[0].result;
    const disableRow = disableResult.rows[0].result;
    expect(enableRow.ok).toBe(true);
    expect(disableRow.ok).toBe(true);

    // Which one lands last is a genuine race and deliberately not
    // asserted (mirrors the different-key claim race test) -- what must
    // hold is that the outcome is unambiguous and consistent.
    const latest = await connA.query(
      `select event from standing_publishing_authorizations where firm_id = $1 order by event_seq desc limit 1`,
      [firmId],
    );
    expect(latest.rows).toHaveLength(1);
    expect(["enabled", "disabled"]).toContain(latest.rows[0].event);
    expect(latest.rows[0].event).toBe(
      enableRow.event_seq > disableRow.event_seq ? "enabled" : "disabled",
    );
  }, 30000);
});
