import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { buildGtaProspectIdentitySnapshot, parseGtaProspectIdentitySnapshot } from "../src/lib/gta-prospect-identity-snapshot";
import { buildOperatorProspectBaseline } from "../src/lib/gta-prospect-baseline-reconciliation";
import { reconcileGtaProspectBatch012 } from "../src/lib/gta-prospect-live-baseline-gate";
import { RECONCILED_GTA_PROSPECTS } from "../src/app/admin/prospects/reconciled-prospects";
import { legacyGtaSourceRecords } from "../src/lib/legacy-gta-prospect-source";
import type { ReconciledGtaProspect } from "../src/lib/gta-prospect-records";

const BATCH_ROOT = "docs/research/gta-prospect-batch-012";

function value(flag: string): string {
  const index = process.argv.indexOf(flag);
  const result = index === -1 ? undefined : process.argv[index + 1];
  if (!result || result.startsWith("--")) throw new Error(`Missing ${flag}.`);
  return result;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

function output(path: string, body: unknown): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function identityInput(value: unknown): ReconciledGtaProspect {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Live projection row is invalid.");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,159}$/.test(row.id) || typeof row.firm_name !== "string" || !row.firm_name.trim()) {
    throw new Error("Live projection identity is invalid.");
  }
  const website = typeof row.website_url === "string" ? row.website_url : null;
  const roster = typeof row.roster_source_url === "string" ? row.roster_source_url : null;
  if (!website && !roster) throw new Error("Live projection identity has no source URL.");
  // The snapshot builder accesses only these identity fields.  Deliberately do
  // not retain contact, CRM, outreach, or any other projection columns here.
  return { id: row.id, firmName: row.firm_name, canonicalDomain: website ?? roster, websiteUrl: website, rosterSourceUrl: roster } as ReconciledGtaProspect;
}

async function main(): Promise<void> {
  const expectedCount = Number(value("--expected-count"));
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) throw new Error("--expected-count must be a positive integer.");
  const snapshotOut = value("--snapshot-out");
  const reportOut = value("--report-out");
  const dryRunOut = value("--dry-run-out");

  // The reader validates the operator-only projection. Only its allowlisted
  // identity fields are written to disk below; public contact evidence never
  // crosses this script's output boundary.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Database credentials are unavailable.");
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let result = await client.rpc("list_gta_prospect_research_with_contacts_for_operator");
  if (result.error && (result.error.code === "PGRST202" || result.error.code === "42883")) {
    result = await client.rpc("list_gta_prospect_research_for_operator");
  }
  if (result.error || !Array.isArray(result.data)) throw new Error("Live projection is unavailable.");
  const liveRecords = result.data.map(identityInput);
  if (liveRecords.length !== expectedCount) throw new Error(`Live projection count mismatch: expected ${expectedCount}, received ${liveRecords.length}.`);
  const snapshot = buildGtaProspectIdentitySnapshot(liveRecords);
  parseGtaProspectIdentitySnapshot(snapshot, { expectedCount });

  const documents = ["lanes/west-north.json", "lanes/east-outer.json"].map((path) => json(`${BATCH_ROOT}/${path}`));
  const staticBaseline = buildOperatorProspectBaseline({
    fixtures: RECONCILED_GTA_PROSPECTS,
    ledgerProjection: [],
    legacySource: legacyGtaSourceRecords(),
  });
  const report = reconcileGtaProspectBatch012(snapshot, documents, staticBaseline);
  const clearCount = report.reviews.filter((review) => review.state === "clear").length;
  const reviewRequiredCount = report.reviews.length - clearCount;
  const dryRun = {
    schema_version: "gta-prospect-batch-012-import-dry-run.v1",
    batch_id: report.batch_id,
    generated_at: report.snapshot.generated_at,
    live_identity_snapshot: {
      record_count: report.snapshot.record_count,
      records_sha256: report.snapshot.records_sha256,
    },
    candidate_count: report.candidate_count,
    clear_count: clearCount,
    review_required_count: reviewRequiredCount,
    database_mutations: [],
    automatic_merge: false,
    import_authorized: false,
    records: report.reviews.map((review) => ({
      candidate_source: review.candidate_source,
      state: review.state,
      automatic_merge: false,
      proposed_database_action: "none",
    })),
  } as const;

  output(snapshotOut, snapshot);
  output(reportOut, report);
  output(dryRunOut, dryRun);
  process.stdout.write(`Batch 012 live reconciliation complete: ${clearCount} clear, ${reviewRequiredCount} review required, 0 database mutations.\n`);
}

main().catch(() => {
  process.stderr.write("Batch 012 live reconciliation failed.\n");
  process.exitCode = 1;
});
