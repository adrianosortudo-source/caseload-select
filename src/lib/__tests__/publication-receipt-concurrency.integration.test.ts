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
 * Run locally: DIRECT_DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" npx vitest run src/lib/__tests__/publication-receipt-concurrency.integration.test.ts
 */

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

  const firmId = "99999999-0000-0000-0000-000000000001";
  const deliverableId = "99999999-0000-0000-0000-000000000002";
  const placementId = "99999999-0000-0000-0000-000000000003";
  const versionOld = "99999999-0000-0000-0000-000000000004";
  const versionNew = "99999999-0000-0000-0000-000000000005";

  async function cleanup(client: import("pg").Client) {
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

    // Throwaway fixture, fully self-contained (no real firm/client data).
    await connA.query(
      `insert into intake_firms (id, custom_domain, subdomain) values ($1, null, 'concurrency-test-fixture')`,
      [firmId],
    );
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
    // Approve the OLD version first -- this is the state a caller reads
    // before racing a receipt insert against a concurrent re-approval.
    await connA.query(
      `update content_deliverables set status = 'approved', approved_version_id = $1, current_version_id = $1 where id = $2`,
      [versionOld, deliverableId],
    );
    await connA.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, required_artifact_type)
       values ($1, $2, $3, 'firm_website', 'webpage')`,
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
    // not read a stale snapshot and succeed.
    const insertStale = connB.query(
      `insert into publication_receipts
         (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name)
       values ($1, $2, $3, 'firm_website', $4, now(), 'https://example.test/stale', 'operator', 'Test Operator')`,
      [firmId, deliverableId, placementId, versionOld],
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
  }, 30000);

  it("allows a legitimate receipt to commit and then serializes the version bump after it", async () => {
    // Mirror ordering: B claims the lock first with a currently-valid
    // receipt; A's concurrent version bump must wait for B, not race it.
    await connB.query("begin");
    const insertValid = connB.query(
      `insert into publication_receipts
         (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name)
       values ($1, $2, $3, 'firm_website', $4, now(), 'https://example.test/valid', 'operator', 'Test Operator')
       returning id`,
      [firmId, deliverableId, placementId, versionOld],
    );
    await insertValid;

    const updateBlocked = connA.query(
      `update content_deliverables set approved_version_id = $1, current_version_id = $1 where id = $2`,
      [versionNew, deliverableId],
    );

    await new Promise((resolve) => setTimeout(resolve, 300));
    await connB.query("commit");
    await updateBlocked;

    const { rows } = await connA.query(
      `select count(*)::int as n from publication_receipts where deliverable_id = $1 and approved_version_id = $2 and public_url = 'https://example.test/valid'`,
      [deliverableId, versionOld],
    );
    expect(rows[0].n).toBe(1);
  }, 30000);
});
