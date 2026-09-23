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
  const [nameRows, mappingRows] = await Promise.all([
    client.from("gta_prospect_firms").select("id,normalized_display_name").eq("normalized_display_name", name).limit(1).then(databaseRows),
    client.from("prospect_source_record_map").select("id,firm_id,mapping_status").eq("source_system", payload.sourceSystem)
      .eq("source_record_id", payload.subject.researchKey).eq("mapping_status", "confirmed").limit(1).then(databaseRows),
  ]);
  if (nameRows.length) holds.push("new_core_name_collision_requires_existing_review");
  if (mappingRows.some((row) => row.firm_id)) holds.push("new_core_confirmed_mapping_requires_existing_review");
  const proposedKey = payload.subject.sourceRecordKey;
  const proposedKeyRows = proposedKey ? databaseRows(await client.from("gta_prospect_firms").select("id,source_record_key").eq("source_record_key", proposedKey).limit(1)) : [];
  const sourceRecordKey = proposedKey && proposedKeyRows.length === 0 ? proposedKey : "pe-" + input.packageId.replace(/-/g, "").toLowerCase();
  if (sourceRecordKey !== proposedKey) {
    const fallbackRows = databaseRows(await client.from("gta_prospect_firms").select("id,source_record_key").eq("source_record_key", sourceRecordKey).limit(1));
    if (fallbackRows.length) holds.push("new_core_generated_key_already_exists");
  }
  const domains = [...new Set(payload.sources.filter(publicCoreSource).flatMap((source) => {
    const domain = prospectCoreSourceDomain(source.url); return domain ? [domain] : [];
  }))];
  const blockedDomains = new Set<string>();
  for (let offset = 0; offset < domains.length; offset += 100) {
    const chunk = domains.slice(offset, offset + 100);
    const [registry, aliases] = await Promise.all([
      client.from("gta_prospect_stable_identity_registry").select("id,firm_id,canonical_domain").in("canonical_domain", chunk).limit(1001).then(databaseRows),
      client.from("gta_prospect_domains").select("id,firm_id,normalized_domain_value").in("normalized_domain_value", chunk).limit(1001).then(databaseRows),
    ]);
    if (registry.length > 1000 || aliases.length > 1000) { holds.push("new_core_domain_coverage_incomplete"); continue; }
    for (const row of registry) if (typeof row.canonical_domain === "string") blockedDomains.add(row.canonical_domain);
    for (const row of aliases) if (typeof row.normalized_domain_value === "string") blockedDomains.add(row.normalized_domain_value);
  }
  // Conflicted sources remain in the immutable package but cannot be selected as new-firm bootstrap evidence.
  const sources = payload.sources.filter((source) => !blockedDomains.has(prospectCoreSourceDomain(source.url) ?? ""));
  const options = collectProspectEnrichmentCoreOptions({ payload: { ...payload, sources }, items: input.items, sourceRecordKey, identityHolds: holds });
  if (blockedDomains.size && !options.eligible) options.holds.push("new_core_source_domain_requires_existing_review");
  return options;
}
