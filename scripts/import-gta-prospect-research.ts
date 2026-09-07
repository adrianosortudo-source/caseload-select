#!/usr/bin/env tsx
/**
 * Internal GTA research importer. Default is a no-network, zero-write dry run.
 * It never reads from or writes to CRM tables and is not a web route.
 *
 * Usage:
 *   npx tsx scripts/import-gta-prospect-research.ts
 *   npx tsx scripts/import-gta-prospect-research.ts --input C:\\path\\records.json
 *   npx tsx scripts/import-gta-prospect-research.ts --apply --confirm-source-sha256 <dry-run hash>
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { RECONCILED_GTA_PROSPECTS } from "../src/app/admin/prospects/reconciled-prospects";
import {
  buildGtaProspectImportPlan,
  executeGtaProspectImport,
  normalizedResearchName,
  sha256,
  type GtaProspectImportPlan,
  type GtaProspectResearchRecord,
} from "../src/lib/gta-prospect-research-import";

type Args = { input: string | null; apply: boolean; confirmSourceSha256: string | null };

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { input: null, apply: false, confirmSourceSha256: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input") args.input = argv[++index] ?? null;
    else if (argument === "--apply") args.apply = true;
    else if (argument === "--confirm-source-sha256") args.confirmSourceSha256 = argv[++index] ?? null;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

async function readRecords(input: string | null): Promise<readonly unknown[]> {
  if (!input) return RECONCILED_GTA_PROSPECTS;
  const parsed: unknown = JSON.parse(await readFile(resolve(input), "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown[] }).records)) return (parsed as { records: unknown[] }).records;
  throw new Error("Input JSON must be an array or an object with a records array.");
}

function requireApplyEnvironment(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("--apply requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  return { url, serviceRoleKey };
}

async function applyPlan(plan: GtaProspectImportPlan, url: string, serviceRoleKey: string): Promise<void> {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: batch, error: batchError } = await supabase
    .from("gta_prospect_import_batches")
    .insert({ source_name: "reconciled_gta_prospect_records", source_sha256: plan.sourceSha256, source_record_count: plan.accepted.length })
    .select("id")
    .single();
  if (batchError || !batch) throw new Error(`Could not create import batch: ${batchError?.message ?? "no batch returned"}`);

  try {
    for (const record of plan.accepted) {
    const { data: inserted, error: firmInsertError } = await supabase
      .from("gta_prospect_firms")
      .upsert({
        source_record_key: record.id,
        display_name: record.firmName,
        normalized_display_name: normalizedResearchName(record.firmName),
        website_url: record.websiteUrl,
        reconciliation_status: record.reconciliationStatus,
      }, { onConflict: "source_record_key", ignoreDuplicates: true })
      .select("id");
    if (firmInsertError) throw new Error(`Could not create firm ${record.id}: ${firmInsertError.message}`);
    const firmId = inserted?.[0]?.id ?? (await supabase.from("gta_prospect_firms").select("id").eq("source_record_key", record.id).single()).data?.id;
    if (!firmId) throw new Error(`Could not resolve stable firm id for ${record.id}`);
    const sourceRecordSha256 = await sha256(record);
    const sourceUrl = record.rosterSourceUrl as string;
    const observedOn = record.rosterCheckedAt;
    const officeRows = (record.officeObservations ?? record.officeCities.map((city) => ({ city, sourceUrl, observedOn }))).map((office) => ({
      firm_id: firmId, city: office.city, province: office.province ?? "ON", address_raw: office.addressRaw ?? null,
      street_normalized: office.streetNormalized ?? null, suite_raw: office.suiteRaw ?? null,
      source_type: "reviewed_roster", source_url: office.sourceUrl, observed_on: office.observedOn,
    }));
    const evidenceRows = [
      { firm_id: firmId, import_batch_id: batch.id, evidence_type: "roster", source_type: "reviewed_roster", source_url: sourceUrl, observed_on: observedOn, raw_value: record.observedLawyerCountDisplay },
      ...(record.websiteUrl ? [{ firm_id: firmId, import_batch_id: batch.id, evidence_type: "website", source_type: "reviewed_website", source_url: record.websiteUrl, observed_on: observedOn, raw_value: record.websiteUrl }] : []),
      ...(record.advertisingEvidence === "observed" ? [{ firm_id: firmId, import_batch_id: batch.id, evidence_type: "advertising", source_type: "reviewed_advertising", source_url: record.advertisingSourceUrl, observed_on: observedOn, raw_value: null }] : []),
      ...(record.gbpEvidence === "observed" ? [{ firm_id: firmId, import_batch_id: batch.id, evidence_type: "google_business_profile", source_type: "reviewed_google_business_profile", source_url: record.gbpSourceUrl, observed_on: observedOn, raw_value: null }] : []),
    ];
    const domain = record.websiteUrl ? new URL(record.websiteUrl).hostname.toLocaleLowerCase() : null;
    const inserts = [
      supabase.from("gta_prospect_aliases").upsert([
        { firm_id: firmId, alias_kind: "brand_name", alias_value: record.firmName, normalized_alias_value: normalizedResearchName(record.firmName), source_type: "import_source", source_url: sourceUrl, observed_on: observedOn },
        { firm_id: firmId, alias_kind: "source_identifier", alias_value: record.id, normalized_alias_value: record.id, source_type: "import_source", source_url: sourceUrl, observed_on: observedOn },
        ...(record.legalNames ?? []).map((name) => ({ firm_id: firmId, alias_kind: "legal_name", alias_value: name, normalized_alias_value: normalizedResearchName(name), source_type: "reviewed_identity", source_url: sourceUrl, observed_on: observedOn })),
      ], { onConflict: "firm_id,alias_kind,normalized_alias_value,source_url,observed_on", ignoreDuplicates: true }),
      officeRows.length ? supabase.from("gta_prospect_offices").upsert(officeRows, { onConflict: "firm_id,city,province,address_raw,suite_raw,source_url,observed_on", ignoreDuplicates: true }) : Promise.resolve({ error: null }),
      domain ? supabase.from("gta_prospect_domains").upsert({ firm_id: firmId, domain_value: domain, normalized_domain_value: domain, source_type: "reviewed_website", source_url: record.websiteUrl, observed_on: observedOn }, { onConflict: "firm_id,normalized_domain_value,source_url,observed_on", ignoreDuplicates: true }) : Promise.resolve({ error: null }),
      supabase.from("gta_prospect_roster_observations").insert({ firm_id: firmId, import_batch_id: batch.id, source_type: "reviewed_roster", source_url: sourceUrl, observed_on: observedOn, observed_lawyer_count: record.observedLawyerCount, count_qualifier: record.observedLawyerCountQualifier, count_display: record.observedLawyerCountDisplay, raw_observation: record }),
      supabase.from("gta_prospect_evidence_links").upsert(evidenceRows, { onConflict: "firm_id,evidence_type,source_url,observed_on", ignoreDuplicates: true }),
      supabase.from("gta_prospect_identity_adjudications").insert({ firm_id: firmId, import_batch_id: batch.id, decision: record.reconciliationStatus, review_method: "manual_review", adjudication_basis: record.reconciliationNote ?? "Status supplied by the reviewed source-controlled record.", source_type: "import_source", source_url: sourceUrl, observed_on: observedOn }),
      supabase.from("gta_prospect_import_audit").insert({ import_batch_id: batch.id, source_record_key: record.id, source_record_sha256: sourceRecordSha256, validation_state: "accepted", action_state: inserted?.[0]?.id ? "created" : "already_present", firm_id: firmId, validation_errors: [], raw_source_record: record }),
    ];
    const outcomes = await Promise.all(inserts);
    const failed = outcomes.find((outcome) => outcome.error);
    if (failed?.error) throw new Error(`Could not persist ${record.id}: ${failed.error.message}`);
    }
  } catch (error) {
    // The history rows already written remain append-only evidence of the
    // partial attempt; the mutable batch state makes that condition explicit.
    await supabase.from("gta_prospect_import_batches").update({ state: "failed" }).eq("id", batch.id);
    throw error;
  }
  const { error: completeError } = await supabase.from("gta_prospect_import_batches").update({ state: "applied", applied_at: new Date().toISOString() }).eq("id", batch.id);
  if (completeError) throw new Error(`Could not complete import batch: ${completeError.message}`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const plan = await buildGtaProspectImportPlan(await readRecords(args.input));
  console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry_run", sourceSha256: plan.sourceSha256, accepted: plan.accepted.length, rejected: plan.rejected }, null, 2));
  if (!args.apply) return plan.rejected.length ? 1 : 0;
  if (!args.confirmSourceSha256 || args.confirmSourceSha256 !== plan.sourceSha256) throw new Error("--apply requires --confirm-source-sha256 matching the preceding dry-run hash.");
  const environment = requireApplyEnvironment();
  const result = await executeGtaProspectImport({ plan, dryRun: false, operatorAuthorized: true, writer: { apply: (acceptedPlan) => applyPlan(acceptedPlan, environment.url, environment.serviceRoleKey) } });
  if (result.state !== "applied") throw new Error(`Import did not apply: ${result.state}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((exitCode) => { process.exitCode = exitCode; }).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
