import "server-only";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import type { ReadDatabase } from "./_package-read";
import { databaseRows, isRecord, READ_UUID, ReadApiError } from "./_read-common";

export const PROTECTED_GTA_TARGET_TABLES = new Set([
  "gta_prospect_firms", "gta_prospect_stable_identity_registry", "gta_prospect_import_audit",
  "gta_prospect_supplemental_evidence_import_audit", "gta_prospect_shared_identity_observations",
  "gta_prospect_website_intake_observations", "gta_prospect_qualification_assessments",
  "gta_prospect_roster_observations", "gta_prospect_downtown_geography_observations",
  "gta_prospect_public_contact_observations",
]);

/** Returns complete, firm-scoped canonical rows through the fixed-table service-only RPC. */
export async function readProtectedGtaTargetRows(input: {
  client: ReadDatabase; firmId: string; table: string; ids: readonly string[];
}): Promise<Record<string, unknown>[]> {
  const ids = [...input.ids];
  if (!PROTECTED_GTA_TARGET_TABLES.has(input.table) || !READ_UUID.test(input.firmId) || ids.length < 1 || ids.length > 100
    || ids.some((id) => !READ_UUID.test(id)) || new Set(ids).size !== ids.length) {
    throw new ReadApiError("Canonical evidence target read bounds are invalid.");
  }
  const result = await input.client.rpc("read_prospect_enrichment_gta_target_rows_v1", {
    p_firm_id: input.firmId, p_table: input.table, p_ids: ids,
  });
  const records = databaseRows(result);
  if (records.length !== ids.length) throw new ReadApiError("Canonical evidence targets could not be read completely.");
  const byId = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const row = record.row_json, sqlHash = record.row_sha256;
    if (!isRecord(row) || typeof row.id !== "string" || !ids.includes(row.id) || byId.has(row.id)
      || (input.table === "gta_prospect_firms" ? row.id !== input.firmId : row.firm_id !== input.firmId)
      || typeof sqlHash !== "string" || !/^[a-f0-9]{64}$/.test(sqlHash)
      || prospectEnrichmentProtocolHash(row) !== sqlHash) {
      throw new ReadApiError("Canonical evidence target identity or hash is invalid.");
    }
    byId.set(row.id, row);
  }
  if (ids.some((id) => !byId.has(id))) throw new ReadApiError("Canonical evidence targets could not be read completely.");
  return ids.map((id) => byId.get(id)!);
}
