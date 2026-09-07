/**
 * Real-Postgres regression coverage for GTA public-research import writes.
 * This runs only against a fresh local/CI Supabase stack with every migration
 * applied; it never targets a shared database.
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

describe.skipIf(!DB_URL)("GTA prospect import batch lifecycle (real Postgres)", () => {
  let conn: import("pg").Client;
  const suffix = randomUUID().replaceAll("-", "");
  const sourceKey = `advisory-lock-${suffix}`;
  const sourceSha = "a".repeat(64);
  const retrySourceName = `batch-retry-${suffix}`;
  const retrySourceSha = "b".repeat(64);
  const record = {
    sourceRecordKey: sourceKey,
    firmName: "Advisory Lock Regression LLP",
    normalizedFirmName: "advisory lock regression llp",
    city: "Toronto",
    practiceAreas: ["Family law"],
    legacyCrosswalk: null,
    legacyClusterLawyerCount: null,
    websiteUrl: "https://example.test",
    officeCities: ["Toronto"],
    roster: {
      sourceUrl: "https://example.test/team",
      observedOn: "2026-09-07",
      lawyerCount: 2,
      qualifier: "exact",
      display: "2 lawyers",
    },
    reconciliation: {
      status: "provisional_new",
      basis: "Regression fixture for import batch lifecycle and advisory locking.",
    },
    evidence: [
      { type: "roster", sourceUrl: "https://example.test/team", observedOn: "2026-09-07", value: "2 lawyers" },
      { type: "website", sourceUrl: "https://example.test", observedOn: "2026-09-07", value: "https://example.test" },
    ],
  };

  beforeAll(async () => {
    const { Client } = await import("pg");
    conn = new Client(parseDirectDatabaseUrl(DB_URL!));
    await conn.connect();
  });

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

  it("starts a new batch, applies a valid record through the advisory lock, and retries a failed batch", async () => {
    const started = await asServiceRole(
      "select public.begin_gta_prospect_import_batch($1, $2, $3) as batch_id",
      [`batch-apply-${suffix}`, sourceSha, 1],
    );
    const batchId = started.rows[0]?.batch_id;
    expect(batchId).toEqual(expect.any(String));

    const hash = await asServiceRole(
      "select public.gta_prospect_research_record_sha256($1::jsonb) as record_sha256",
      [JSON.stringify(record)],
    );
    const applied = await asServiceRole(
      "select public.apply_gta_prospect_research_record($1::uuid, $2::jsonb, $3) as result",
      [batchId, JSON.stringify(record), hash.rows[0]?.record_sha256],
    );
    expect(applied.rows[0]?.result).toMatchObject({ state: "applied" });

    const firstRetryBatch = await asServiceRole(
      "select public.begin_gta_prospect_import_batch($1, $2, $3) as batch_id",
      [retrySourceName, retrySourceSha, 1],
    );
    const failedBatchId = firstRetryBatch.rows[0]?.batch_id;
    await asServiceRole("select public.fail_gta_prospect_import_batch($1::uuid)", [failedBatchId]);
    const retried = await asServiceRole(
      "select public.begin_gta_prospect_import_batch($1, $2, $3) as batch_id",
      [retrySourceName, retrySourceSha, 1],
    );
    expect(retried.rows[0]?.batch_id).toBe(failedBatchId);

    const state = await conn.query(
      "select state from public.gta_prospect_import_batches where id = $1::uuid",
      [failedBatchId],
    );
    expect(state.rows).toEqual([{ state: "staged" }]);
  });
});
