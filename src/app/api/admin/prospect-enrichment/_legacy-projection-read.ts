import "server-only";
import { deriveLegacyAssessmentProjection, type LegacyAssessmentProjectionClaim } from "../../../../../scripts/prospect-enrichment/legacy-projection-mapper";
import type { ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { prospectEnrichmentProtocolHash as hash } from "@/lib/prospect-enrichment-hash";
import { getProspectEnrichmentFirmHistory } from "@/lib/prospect-enrichment-reader";
import { readEvidenceJsonPointer } from "@/lib/prospect-enrichment-legacy";
import { comparisonReadClient } from "./_comparison-read";
import { databaseRows, READ_UUID } from "./_read-common";
import type { ReadDatabase } from "./_package-read";
export type LegacyAssessmentProjectionTarget = { table: "gta_prospect_qualification_assessments"; id: string; rowSha256: string };
/** A local receipt/selector is a claim only. This performs no writes and never returns a partial proof. */
export async function readProspectLegacyAssessmentProjectionProof(input: {
  envelope: ProspectEnrichmentEnvelope; claim: LegacyAssessmentProjectionClaim;
  parentAssessmentTarget: LegacyAssessmentProjectionTarget; firmId: string; client: ReadDatabase;
}) {
  try {
    const target = input.parentAssessmentTarget;
    if (target.table !== "gta_prospect_qualification_assessments" || !READ_UUID.test(target.id) || !READ_UUID.test(input.firmId) || !/^[a-f0-9]{64}$/.test(target.rowSha256)) return null;
    if (input.envelope.subject.identityState !== "resolved" || input.envelope.subject.databaseFirmId !== input.firmId) return null;
    const rows = databaseRows(await input.client.from(target.table).select("*").eq("id", target.id).eq("firm_id", input.firmId).limit(2));
    const row = rows[0];
    if (rows.length !== 1 || row.id !== target.id || row.firm_id !== input.firmId || hash(row) !== target.rowSha256 || typeof row.evidence_import_batch_id !== "string") return null;
    const batches = databaseRows(await input.client.from("gta_prospect_supplemental_evidence_import_batches").select("id,state").eq("id", row.evidence_import_batch_id).limit(2));
    if (batches.length !== 1 || batches[0].state !== "applied") return null;
    const derived = deriveLegacyAssessmentProjection(input.envelope, input.claim, row.criteria);
    if (!derived || !derived.criteriaSelector.startsWith("/criteria/")) return null;
    const selected = readEvidenceJsonPointer(row, derived.criteriaSelector);
    if (!selected.found || hash(selected.value) !== derived.selectedValueSha256) return null;
    const client = comparisonReadClient(input.client); const seen = new Set<string>();
    let cursor: string | undefined, revision: string | null = null, count = 0, visible = false;
    for (;;) {
      const page = await getProspectEnrichmentFirmHistory({ firmId: input.firmId, table: target.table, cursor, limit: 100, client });
      if (!page.revisionStable || (revision !== null && page.revision !== revision)) return null;
      revision = page.revision; count += page.items.length;
      if (count > 5000 || seen.size > 100) return null;
      const rendered = page.items.find((item) => item.id === target.id && item.table === target.table);
      if (rendered) visible = Object.entries(rendered.data).every(([key, value]) => Object.hasOwn(row, key) && hash(row[key]) === hash(value));
      if (!page.nextCursor) break;
      if (seen.has(page.nextCursor)) return null;
      seen.add(page.nextCursor); cursor = page.nextCursor;
    }
    if (!visible) return null;
    const fresh = databaseRows(await input.client.from(target.table).select("*").eq("id", target.id).eq("firm_id", input.firmId).limit(1))[0];
    if (!fresh || hash(fresh) !== target.rowSha256) return null;
    const current = databaseRows(await input.client.from("gta_prospect_firms").select("id,enrichment_revision").eq("id", input.firmId).limit(1))[0];
    if (!current || String(current.enrichment_revision) !== revision) return null;
    return { ...derived, parentAssessmentTarget: { table: "gta_prospect_qualification_assessments" as const, id: target.id, rowSha256: target.rowSha256 }, databaseFirmId: input.firmId };
  } catch { return null; }
}
