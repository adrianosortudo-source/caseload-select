import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrlRaw = process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL;
const databaseUrlText = databaseUrlRaw?.trim() ?? "";
const databaseUrl = databaseUrlText && ((databaseUrlText.startsWith('"') && databaseUrlText.endsWith('"')) ||
  (databaseUrlText.startsWith("'") && databaseUrlText.endsWith("'")))
  ? databaseUrlText.slice(1, -1) : databaseUrlText;
if (process.env.PROSPECT_ENRICHMENT_REQUIRE_DATABASE_URL === "1" && !databaseUrl) {
  throw new Error("prospect coverage backfill integration tests require a direct local Postgres URL");
}
if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["127.0.0.1", "::1"].includes(parsed.hostname.replace(/^\[|\]$/g, "")) ||
      !parsed.port || parsed.pathname !== "/postgres") {
    throw new Error("prospect coverage backfill integration tests require direct disposable loopback Postgres");
  }
}
const integrationDescribe = databaseUrl ? describe : describe.skip;

integrationDescribe("prospect candidate legacy coverage backfill", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  afterAll(async () => { await pool.end(); });

  it("exposes private progress, processes at most 100 locked UUID-keyset rows, and captures an unscanned delete", async () => {
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const privileges = await client.query<{
        postgresBatch: boolean; postgresStatus: boolean; anonBatch: boolean; authenticatedBatch: boolean;
        serviceBatch: boolean; anonStatus: boolean; authenticatedStatus: boolean; serviceStatus: boolean;
        authenticatedProgress: boolean;
      }>(`SELECT
          has_function_privilege('postgres','prospect_candidate_private.coverage_backfill_batch(text,uuid,integer)','EXECUTE') AS "postgresBatch",
          has_function_privilege('postgres','prospect_candidate_private.coverage_backfill_status()','EXECUTE') AS "postgresStatus",
          has_function_privilege('anon','prospect_candidate_private.coverage_backfill_batch(text,uuid,integer)','EXECUTE') AS "anonBatch",
          has_function_privilege('authenticated','prospect_candidate_private.coverage_backfill_batch(text,uuid,integer)','EXECUTE') AS "authenticatedBatch",
          has_function_privilege('service_role','prospect_candidate_private.coverage_backfill_batch(text,uuid,integer)','EXECUTE') AS "serviceBatch",
          has_function_privilege('anon','prospect_candidate_private.coverage_backfill_status()','EXECUTE') AS "anonStatus",
          has_function_privilege('authenticated','prospect_candidate_private.coverage_backfill_status()','EXECUTE') AS "authenticatedStatus",
          has_function_privilege('service_role','prospect_candidate_private.coverage_backfill_status()','EXECUTE') AS "serviceStatus",
          has_table_privilege('authenticated','prospect_candidate_private.legacy_backfill_progress','SELECT') AS "authenticatedProgress"`);
      expect(privileges.rows[0]).toEqual({ postgresBatch: true, postgresStatus: true, anonBatch: false, authenticatedBatch: false,
        serviceBatch: false, anonStatus: false, authenticatedStatus: false, serviceStatus: false, authenticatedProgress: false });

      const before = await client.query<{ total_tables: number; complete_tables: number; incomplete_tables: number;
        table_name: string; last_id: string | null; rows_projected: string; complete: boolean }>(
        "SELECT * FROM prospect_candidate_private.coverage_backfill_status() WHERE table_name='gta_prospect_firms'",
      );
      expect(before.rows).toHaveLength(1);
      expect(Object.keys(before.rows[0]).sort()).toEqual(["complete", "complete_tables", "incomplete_tables", "last_id", "rows_projected", "table_name", "total_tables"]);
      expect(before.rows[0]).toMatchObject({ total_tables: expect.any(Number), complete_tables: expect.any(Number),
        incomplete_tables: expect.any(Number), table_name: "gta_prospect_firms", last_id: null, rows_projected: "0", complete: false });
      expect(before.rows[0].incomplete_tables).toBe(before.rows[0].total_tables);

      await client.query("SAVEPOINT invalid_batches");
      await expect(client.query(
        "SELECT prospect_candidate_private.coverage_backfill_batch($1::text,$2::uuid,$3::integer)",
        ["gta_prospect_firms", null, 101],
      )).rejects.toThrow(/batch size must be between 1 and 100/);
      await client.query("ROLLBACK TO SAVEPOINT invalid_batches");
      await expect(client.query(
        "SELECT prospect_candidate_private.coverage_backfill_batch($1::text,$2::uuid,$3::integer)",
        ["public.gta_prospect_firms", null, 100],
      )).rejects.toThrow(/unsupported coverage backfill inventory table/);
      await client.query("ROLLBACK TO SAVEPOINT invalid_batches");

      // Isolate the worker from the normal AFTER INSERT projection so this test
      // proves the batch itself projects rows; the separate BEFORE DELETE trigger
      // remains active while the not-yet-scanned final fixture is deleted.
      await client.query("ALTER TABLE public.gta_prospect_firms DISABLE TRIGGER candidate_legacy_projection");
      const suffix = randomUUID().replaceAll("-", "");
      const ids = Array.from({ length: 101 }, (_, index) => `00000000-0000-0000-0000-${index.toString(16).padStart(12, "0")}`);
      const collisions = await client.query("SELECT 1 FROM public.gta_prospect_firms WHERE id BETWEEN $1::uuid AND $2::uuid LIMIT 1", [ids[0], ids[100]]);
      expect(collisions.rows).toHaveLength(0);
      await client.query(
        `INSERT INTO public.gta_prospect_firms(id,source_record_key,display_name,normalized_display_name,reconciliation_status)
         SELECT id::uuid,'coverage-backfill-${suffix}-'||ordinal::text,'Coverage Backfill Fixture','coverage backfill fixture','provisional_new'
         FROM unnest($1::text[]) WITH ORDINALITY AS fixture(id,ordinal)`,
        [ids],
      );

      const first = await client.query<{ progress: Record<string, unknown> }>(
        "SELECT prospect_candidate_private.coverage_backfill_batch($1::text,$2::uuid,$3::integer) AS progress",
        ["gta_prospect_firms", null, 100],
      );
      const result = first.rows[0].progress;
      expect(Object.keys(result).sort()).toEqual(["complete", "last_id", "previous_cursor", "rows_projected", "table_name"]);
      expect(result).toEqual({ table_name: "gta_prospect_firms", previous_cursor: null, last_id: ids[99], rows_projected: 100, complete: false });

      await client.query("SAVEPOINT stale_cursor");
      await expect(client.query(
        "SELECT prospect_candidate_private.coverage_backfill_batch($1::text,$2::uuid,$3::integer)",
        ["gta_prospect_firms", null, 100],
      )).rejects.toThrow(/coverage backfill cursor changed/);
      await client.query("ROLLBACK TO SAVEPOINT stale_cursor");

      // The 101st row is above the returned cursor and would otherwise be missed
      // by a delete-before-scan. Its OLD row must be projected before deletion.
      await client.query("DELETE FROM public.gta_prospect_firms WHERE id=$1::uuid", [ids[100]]);
      const captured = await client.query<{ source_row: { id: string } }>(
        `SELECT snapshot->'row' AS source_row FROM public.prospect_research_candidate_coverage
         WHERE source_table='gta_prospect_firms' AND source_key=$1 ORDER BY revision DESC LIMIT 1`,
        [ids[100]],
      );
      expect(captured.rows).toHaveLength(1);
      expect(captured.rows[0].source_row.id).toBe(ids[100]);
    } finally {
      if (transactionOpen) await client.query("ROLLBACK");
      client.release();
    }
  });
});
