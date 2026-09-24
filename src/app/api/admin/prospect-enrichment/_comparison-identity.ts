import type { ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import type { ComparisonExportInput } from "../../../../../scripts/prospect-enrichment/comparison-export";
import type { ReadDatabase } from "./_package-read";
import { databaseRows, ReadApiError } from "./_read-common";

export async function readIdentity(envelopes: readonly ProspectEnrichmentEnvelope[], client: ReadDatabase): Promise<ComparisonExportInput["identities"]> {
  const groups = new Map<string, ProspectEnrichmentEnvelope[]>();
  for (const envelope of envelopes) groups.set(envelope.subject.researchKey, [...(groups.get(envelope.subject.researchKey) ?? []), envelope]);
  const subjects = envelopes.map((item) => item.subject);
  const { data: identityRows, error: identityError } = await client.rpc("read_prospect_enrichment_firm_identities_v1", {
    p_firm_ids: [...new Set(subjects.flatMap((subject) => subject.databaseFirmId ? [subject.databaseFirmId] : []))],
    p_source_record_keys: [...new Set(subjects.flatMap((subject) => subject.sourceRecordKey ? [subject.sourceRecordKey] : []))],
    p_stable_firm_ids: [...new Set(subjects.flatMap((subject) => subject.stableFirmId ? [subject.stableFirmId] : []))],
  });
  if (identityError) throw new ReadApiError("Firm identity read-back is unavailable.", 503);
  const identityRecords = databaseRows({ data: identityRows, error: identityError });
  if (identityRecords.length > 1000) throw new ReadApiError("Firm identity coverage exceeded its bounded read limit.", 503);
  const result: ComparisonExportInput["identities"] = [];
  for (const [researchKey, versions] of groups) {
    if (versions.some((item) => item.subject.identityState === "conflict")) continue;
    const candidates = new Set<string>();
    const maps = databaseRows(await client.from("prospect_source_record_map").select("firm_id,mapping_status").eq("source_system", versions[0].sourceSystem).eq("source_record_id", researchKey).limit(2));
    if (maps.length > 1 || maps.some((row) => row.mapping_status !== "confirmed")) continue;
    if (maps[0]?.firm_id) candidates.add(String(maps[0].firm_id).toLowerCase());
    let contradictory = false;
    for (const { subject } of versions) {
      if (subject.databaseFirmId) {
        const rows = identityRecords.filter((row) => String(row.firm_id).toLowerCase() === subject.databaseFirmId!.toLowerCase());
        if (rows.length !== 1 || subject.sourceRecordKey && rows[0].source_record_key !== subject.sourceRecordKey) contradictory = true;
        else candidates.add(String(rows[0].firm_id).toLowerCase());
      }
      if (subject.sourceRecordKey) {
        const rows = identityRecords.filter((row) => row.source_record_key === subject.sourceRecordKey);
        if (rows.length !== 1) { if (rows.length > 1) contradictory = true; }
        else candidates.add(String(rows[0].firm_id).toLowerCase());
      }
      if (subject.stableFirmId) {
        const rows = identityRecords.filter((row) => row.stable_firm_id === subject.stableFirmId);
        if (rows.length !== 1 || subject.canonicalDomain && rows[0].canonical_domain !== subject.canonicalDomain) contradictory = true;
        else candidates.add(String(rows[0].firm_id).toLowerCase());
      }
    }
    if (contradictory || candidates.size !== 1) continue;
    const firmId = [...candidates][0];
    const firms = identityRecords.filter((row) => String(row.firm_id).toLowerCase() === firmId);
    if (firms.length !== 1) continue;
    const stableFirmId = firms[0].stable_firm_id == null ? null : String(firms[0].stable_firm_id), canonicalDomain = firms[0].canonical_domain == null ? null : String(firms[0].canonical_domain);
    if (versions.some(({ subject }) => subject.stableFirmId && subject.stableFirmId !== stableFirmId || subject.canonicalDomain && subject.canonicalDomain !== canonicalDomain)) continue;
    result.push({ researchKey, databaseFirmId: firmId, stableFirmId, sourceRecordKey: String(firms[0].source_record_key), canonicalDomain });
  }
  return result;
}
