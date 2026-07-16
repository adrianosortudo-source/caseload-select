/**
 * Deterministic concurrency regression test for the adversarial-review fix
 * to claim_placement_for_publish() (supabase/migrations/
 * 20260716155746_publication_placement_claim_race_fix.sql): two callers
 * submitting the SAME NEW idempotency_key concurrently must both receive
 * the identical claim result, never a competing-claim rejection for one
 * of them.
 *
 * Real two-connection integration test, same rationale and gating as
 * publication-receipt-concurrency.integration.test.ts: proving a Postgres
 * row-locking/re-check race is closed requires genuine transaction
 * control two mocked Supabase clients cannot provide. Gated behind
 * DIRECT_DATABASE_URL, skipped by default.
 *
 * Run locally: DIRECT_DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" npx vitest run src/lib/__tests__/publication-placement-claim-concurrency.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

describe.skipIf(!DB_URL)("claim_placement_for_publish concurrency (real Postgres, two connections)", () => {
  let Client: typeof import("pg").Client;
  let connA: import("pg").Client;
  let connB: import("pg").Client;

  const firmId = "99999999-1111-0000-0000-000000000001";
  const deliverableId = "99999999-1111-0000-0000-000000000002";
  const placementId = "99999999-1111-0000-0000-000000000003";
  const versionId = "99999999-1111-0000-0000-000000000004";

  async function cleanup(client: import("pg").Client) {
    await client.query(`delete from publication_placement_claims where firm_id = $1`, [firmId]);
    await client.query(`delete from publication_receipts where firm_id = $1`, [firmId]);
    await client.query(`delete from content_placements where firm_id = $1`, [firmId]);
    await client.query(`delete from deliverable_versions where deliverable_id = $1`, [deliverableId]);
    await client.query(`delete from content_deliverables where id = $1`, [deliverableId]);
    await client.query(`delete from intake_firms where id = $1`, [firmId]);
  }

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    connA = new Client({ connectionString: DB_URL });
    connB = new Client({ connectionString: DB_URL });
    await connA.connect();
    await connB.connect();
    await cleanup(connA);

    await connA.query(
      `insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Claim Concurrency Fixture', null, 'claim-concurrency-fixture')`,
      [firmId],
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
  }, 30000);

  afterAll(async () => {
    if (connA) {
      await cleanup(connA);
      await connA.end();
    }
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

    // Exactly one row exists for this key -- no duplicate claim was created.
    const { rows } = await connA.query(
      `select count(*)::int as n from publication_placement_claims where placement_id = $1 and idempotency_key = $2`,
      [placementId, sameKey],
    );
    expect(rows[0].n).toBe(1);
  }, 30000);
});
