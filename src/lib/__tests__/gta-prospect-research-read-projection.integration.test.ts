/**
 * Real-Postgres regression coverage for the GTA research read boundary.
 * This suite runs only against the ephemeral local Supabase stack in CI (or a
 * developer's explicitly local stack), never a shared database.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

function parseDirectDatabaseUrl(url: string) {
  const parsed = new URL(url.trim().replace(/^['"]|['"]$/g, ""));
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

describe.skipIf(!DB_URL)("GTA prospect research read projection (real Postgres)", () => {
  let conn: import("pg").Client;
  const firmId = randomUUID();
  const appliedBatchId = randomUUID();
  const stagedBatchId = randomUUID();
  const sourceKey = `projection-fixture-${randomUUID().replaceAll("-", "")}`;
  const stagedSourceKey = `projection-staged-${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    const { Client } = await import("pg");
    conn = new Client(parseDirectDatabaseUrl(DB_URL!));
    await conn.connect();

    await conn.query(
      `insert into public.gta_prospect_import_batches
         (id, source_name, source_sha256, source_record_count, state, applied_at)
       values ($1, $2, repeat('a', 64), 1, 'applied', now()),
              ($3, $4, repeat('b', 64), 1, 'staged', null)`,
      [appliedBatchId, `projection-applied-${firmId}`, stagedBatchId, `projection-staged-${firmId}`],
    );
    await conn.query(
      `insert into public.gta_prospect_firms
         (id, source_record_key, display_name, normalized_display_name, website_url, reconciliation_status)
       values ($1, $2, 'Projection Fixture LLP', 'projection fixture llp', 'https://fixture.example', 'provisional_new'),
              ($3, $4, 'Staged Fixture LLP', 'staged fixture llp', 'https://staged.example', 'provisional_new')`,
      [firmId, sourceKey, randomUUID(), stagedSourceKey],
    );
    await conn.query(
      `insert into public.gta_prospect_offices (firm_id, city, source_type, source_url, observed_on)
       values ($1, 'Toronto', 'import_source', 'https://fixture.example/team', '2026-09-07'),
              ($1, 'Mississauga', 'import_source', 'https://fixture.example/team', '2026-09-07')`,
      [firmId],
    );
    await conn.query(
      `insert into public.gta_prospect_roster_observations
         (firm_id, import_batch_id, source_type, source_url, observed_on, observed_lawyer_count, count_qualifier, count_display, canonical_observation)
       values ($1, $2, 'import_source', 'https://fixture.example/team', '2026-09-07', 4, 'exact', '4 lawyers', '{}'::jsonb),
              ($1, $3, 'import_source', 'https://fixture.example/new-team', '2026-09-08', 99, 'exact', '99 lawyers', '{}'::jsonb)`,
      [firmId, appliedBatchId, stagedBatchId],
    );
    await conn.query(
      `insert into public.gta_prospect_evidence_links
         (firm_id, import_batch_id, evidence_type, source_type, source_url, observed_on)
       values ($1, $2, 'advertising', 'import_source', 'https://ads.example/library', '2026-09-07'),
              ($1, $3, 'google_business_profile', 'import_source', 'https://staged.example/gbp', '2026-09-08')`,
      [firmId, appliedBatchId, stagedBatchId],
    );
    await conn.query(
      `insert into public.gta_prospect_identity_adjudications
         (firm_id, import_batch_id, decision, review_method, adjudication_basis, source_type, source_url, observed_on)
       values ($1, $2, 'provisional_new', 'manual_review', 'Applied public-research review.', 'import_source', 'https://fixture.example/team', '2026-09-07')`,
      [firmId, appliedBatchId],
    );
    await conn.query(
      `insert into public.gta_prospect_import_audit
         (import_batch_id, source_record_key, source_record_sha256, validation_state, action_state, firm_id, validation_errors, canonical_record)
       values ($1, $2, repeat('c', 64), 'accepted', 'created', $3, '[]'::jsonb, '{}'::jsonb)`,
      [appliedBatchId, sourceKey, firmId],
    );
  }, 30000);

  afterAll(async () => {
    await conn.end();
  });

  async function asServiceRole(text: string, values: unknown[] = []) {
    await conn.query("begin");
    try {
      await conn.query("set local role service_role");
      const result = await conn.query(text, values);
      await conn.query("commit");
      return result;
    } catch (error) {
      await conn.query("rollback");
      throw error;
    }
  }

  it("denies direct table SELECT to service_role while allowing only the narrow read RPC", async () => {
    await expect(asServiceRole("select * from public.gta_prospect_firms")).rejects.toMatchObject({ code: "42501" });
    const projected = await asServiceRole("select * from public.list_gta_prospect_research_for_operator() where id = $1", [sourceKey]);
    expect(projected.rows).toEqual([
      expect.objectContaining({
        id: sourceKey,
        firm_name: "Projection Fixture LLP",
        city: "Mississauga",
        office_cities: ["Mississauga", "Toronto"],
        observed_lawyer_count: 4,
        observed_lawyer_count_display: "4 lawyers",
        roster_source_url: "https://fixture.example/team",
        advertising_evidence: "observed",
        advertising_source_url: "https://ads.example/library",
        gbp_evidence: "unknown",
        gbp_source_url: null,
        practice_areas: [],
        legacy_cluster_lawyer_count: null,
        legacy_crosswalk: null,
      }),
    ]);
  });

  it("never projects a staged-only record", async () => {
    const projected = await asServiceRole("select id from public.list_gta_prospect_research_for_operator() where id = $1", [stagedSourceKey]);
    expect(projected.rows).toEqual([]);
  });
});
