import "server-only";
import { collectProspectEnrichmentCoreOptions, prospectCoreSourceDomain, publicCoreSource, type ProspectEnrichmentNewCoreOptions } from "@/lib/prospect-enrichment-core-evidence";
import type { ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import type { ReadDatabase } from "./_package-read";
import { databaseRows } from "./_read-common";

export async function readProspectEnrichmentNewCoreOptions(input: {
  packageId: string; payload: ProspectEnrichmentEnvelope; state: string; storedFirmId: unknown; existingFirmId: string | null;
  items: readonly { itemId: string; clientItemId: string; sourceIds: readonly string[] }[]; client: ReadDatabase;
}): Promise<ProspectEnrichmentNewCoreOptions | null> {
  if (input.existingFirmId || ["applied", "rejected", "superseded"].includes(input.state)) return null;
  const { payload, client } = input;
  const holds: string[] = [];
  if (payload.mode !== "propose") holds.push("new_core_requires_proposal_mode");
  if (payload.subject.identityState === "conflict") holds.push("new_core_identity_conflict");
  if (input.storedFirmId || payload.subject.databaseFirmId || payload.subject.stableFirmId) holds.push("new_core_existing_identity_requires_review");
  const name = payload.subject.displayName.trim().toLowerCase().replace(/\s+/g, " ");
  const proposedKey = payload.subject.sourceRecordKey;
  const generatedKey = "pe-" + input.packageId.replace(/-/g, "").toLowerCase();
  const [identityResult, mappingRows] = await Promise.all([
    client.rpc("lookup_prospect_enrichment_core_identity_conflicts_v1", {
      p_normalized_display_name: name,
      p_source_record_keys: [...new Set([proposedKey, generatedKey].filter((value): value is string => typeof value === "string"))],
      p_domains: [],
    }),
    client.from("prospect_source_record_map").select("id,firm_id,mapping_status").eq("source_system", payload.sourceSystem)
      .eq("source_record_id", payload.subject.researchKey).eq("mapping_status", "confirmed").limit(1).then(databaseRows),
  ]);
  const coreIdentityRows = databaseRows(identityResult);
  if (coreIdentityRows.length > 1000) holds.push("new_core_identity_coverage_incomplete");
  if (coreIdentityRows.some((row) => row.match_kind === "name")) holds.push("new_core_name_collision_requires_existing_review");
  if (mappingRows.some((row) => row.firm_id)) holds.push("new_core_confirmed_mapping_requires_existing_review");
  const sourceKeyMatches = new Set(coreIdentityRows.filter((row) => row.match_kind === "source_key").map((row) => String(row.match_value)));
  const sourceRecordKey = proposedKey && !sourceKeyMatches.has(proposedKey) ? proposedKey : generatedKey;
  if (sourceRecordKey === generatedKey && generatedKey !== proposedKey && sourceKeyMatches.has(generatedKey)) holds.push("new_core_generated_key_already_exists");
  const domains = [...new Set(payload.sources.filter(publicCoreSource).flatMap((source) => {
    const domain = prospectCoreSourceDomain(source.url); return domain ? [domain] : [];
  }))];
  const blockedDomains = new Set<string>();
  for (let offset = 0; offset < domains.length; offset += 100) {
    const chunk = domains.slice(offset, offset + 100);
    const { data, error } = await client.rpc("lookup_prospect_enrichment_core_identity_conflicts_v1", { p_normalized_display_name: null, p_source_record_keys: [], p_domains: chunk });
    if (error) throw new Error("Protected domain lookup failed.");
    const rows = databaseRows({ data, error });
    if (rows.length > 1000) { holds.push("new_core_domain_coverage_incomplete"); continue; }
    for (const row of rows) if (row.match_kind === "domain" && typeof row.match_value === "string") blockedDomains.add(row.match_value);
  }
  // Conflicted sources remain in the immutable package but cannot be selected as new-firm bootstrap evidence.
  const sources = payload.sources.filter((source) => !blockedDomains.has(prospectCoreSourceDomain(source.url) ?? ""));
  const options = collectProspectEnrichmentCoreOptions({ payload: { ...payload, sources }, items: input.items, sourceRecordKey, identityHolds: holds });
  if (blockedDomains.size && !options.eligible) options.holds.push("new_core_source_domain_requires_existing_review");
  return options;
}
