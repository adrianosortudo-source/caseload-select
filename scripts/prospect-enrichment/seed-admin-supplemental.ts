import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the disposable Admin fixture.`);
  return value;
}

function localDatabase(raw: string): URL {
  const url = new URL(raw.replace(/^['"]|['"]$/g, ""));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, "")) || !url.port || url.pathname !== "/postgres") {
    throw new Error("Admin fixture requires direct Postgres on an explicit loopback address.");
  }
  return url;
}

async function seed() {
  if (required("PROSPECT_ENRICHMENT_DISPOSABLE_DATABASE_CONFIRMATION") !== "YES-LOCAL-DISPOSABLE-ONLY") throw new Error("Admin fixture requires the explicit disposable-database confirmation.");
  const manifestPath = required("PROSPECT_ENRICHMENT_RENDERED_MANIFEST");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    firmId: string; sourceRecordKey: string; operator: { firmId: string; lawyerId: string };
    adminSupplemental?: Record<string, unknown>;
  };
  if (!manifest.firmId || !manifest.sourceRecordKey || !manifest.operator?.firmId || !manifest.operator?.lawyerId) throw new Error("Rendered manifest does not identify the seeded synthetic firm and operator.");
  const pool = new Pool({ connectionString: localDatabase(required("PROSPECT_ENRICHMENT_TEST_DATABASE_URL")).toString(), max: 1, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  const suffix = createHash("sha256").update(manifest.sourceRecordKey).digest("hex").slice(0, 12);
  const firmName = `Synthetic Admin firm ${suffix}`;
  const observedOn = new Date().toISOString().slice(0, 10);
  const sourceUrl = `https://${suffix}.synthetic.test/profile`;
  const initial = {
    sourceRecordKey: manifest.sourceRecordKey,
    firmName,
    normalizedFirmName: firmName.toLowerCase(),
    city: "Toronto",
    practiceAreas: ["Family Law"],
    legacyCrosswalk: null,
    legacyClusterLawyerCount: null,
    websiteUrl: `https://${suffix}.synthetic.test`,
    officeCities: ["Toronto"],
    roster: { sourceUrl, observedOn, lawyerCount: 3, qualifier: "exact", display: "3 lawyers" },
    reconciliation: { status: "update_existing", basis: "Synthetic existing-firm fixture for Admin acceptance only." },
    evidence: [
      { type: "roster", sourceUrl, observedOn, value: "3 lawyers" },
      { type: "website", sourceUrl, observedOn, value: `https://${suffix}.synthetic.test` },
    ],
  };
  let transactionStarted = false;
  try {
    const preflight = await client.query<{ database_name: string; firm_exists: boolean; operator_exists: boolean }>(
      `SELECT current_database() AS database_name,
       EXISTS(SELECT 1 FROM public.gta_prospect_firms WHERE id=$1::uuid AND source_record_key=$2) AS firm_exists,
       EXISTS(SELECT 1 FROM public.firm_lawyers WHERE id=$3::uuid AND firm_id=$4::uuid AND role='operator' AND disabled=false) AS operator_exists`,
      [manifest.firmId, manifest.sourceRecordKey, manifest.operator.lawyerId, manifest.operator.firmId],
    );
    if (preflight.rows[0]?.database_name !== "postgres" || !preflight.rows[0]?.firm_exists || !preflight.rows[0]?.operator_exists) throw new Error("Fixture preflight did not find the exact synthetic firm and active test operator in the disposable database.");
    await client.query("BEGIN");
    transactionStarted = true;
    const sourceHash = createHash("sha256").update(JSON.stringify(initial)).digest("hex");
    const begun = await client.query<{ receipt: { batch_id?: string; state?: string } }>(
      `SELECT public.begin_gta_prospect_operator_import_batch($1,$2,1) AS receipt`,
      [`synthetic-admin-base-${suffix}`, sourceHash],
    );
    const batchId = begun.rows[0]?.receipt?.batch_id;
    if (!batchId || begun.rows[0]?.receipt?.state !== "ready") throw new Error("Could not stage the synthetic baseline using the existing research import RPC.");
    const recordHash = await client.query<{ hash: string }>(`SELECT public.gta_prospect_research_record_sha256($1::jsonb) AS hash`, [JSON.stringify(initial)]);
    const applied = await client.query<{ receipt: { state?: string; firm_id?: string } }>(
      `SELECT public.apply_gta_prospect_operator_import_record($1::uuid,$2::jsonb,$3) AS receipt`,
      [batchId, JSON.stringify(initial), recordHash.rows[0]?.hash],
    );
    if (!["created", "updated"].includes(applied.rows[0]?.receipt?.state ?? "") || applied.rows[0]?.receipt?.firm_id !== manifest.firmId) throw new Error("Synthetic baseline did not attach to the existing firm UUID exactly.");
    await client.query(`SELECT public.complete_gta_prospect_import_batch($1::uuid)`, [batchId]);
    await client.query("COMMIT");
    transactionStarted = false;
    manifest.adminSupplemental = { sourceRecordKey: manifest.sourceRecordKey, firmId: manifest.firmId, firmName, observedOn, sourceUrl };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    process.stdout.write("Synthetic Admin firm baseline seeded through the existing import RPC on the confirmed disposable database.\n");
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  process.stderr.write(`Admin fixture seed refused or failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
