import "server-only";

import type { GtaProspectEvidenceImportPlan } from "@/lib/gta-prospect-evidence-import";

type RpcError = { message?: string } | null;
export type GtaProspectOperatorEvidenceImportClient = {
  rpc: (functionName: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
};

export type GtaProspectOperatorEvidenceImportResult = Readonly<{
  state: "applied" | "already_applied";
  packageId: string;
  payloadSha256: string;
  counts: Readonly<{
    evidence: number;
    identityMappings: number;
    downtownGeography: number;
    websiteIntakeFindings: number;
    qualificationAssessments: number;
  }>;
  receipt: Readonly<{ sourceRecordCount: number }>;
}>;

type OperatorRecord = Readonly<{
  sourceRecordKey: string;
  identityMappings: readonly Record<string, unknown>[];
  downtownGeography: readonly Record<string, unknown>[];
  websiteIntakeFindings: readonly Record<string, unknown>[];
  qualificationAssessments: readonly Record<string, unknown>[];
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rpcError(error: RpcError, fallback: string): Error {
  return new Error(error?.message ?? fallback);
}

function parseBatchStart(value: unknown): { state: "ready" | "already_applied"; batchId: string } {
  if (!isObject(value) || (value.state !== "ready" && value.state !== "already_applied") || typeof value.batch_id !== "string") {
    throw new Error("The GTA prospect evidence import batch RPC returned an invalid receipt.");
  }
  return { state: value.state, batchId: value.batch_id };
}

function parseRecordReceipt(value: unknown, sourceRecordKey: string) {
  if (!isObject(value) || (value.state !== "applied" && value.state !== "already_applied")) {
    throw new Error(`${sourceRecordKey}: the GTA prospect evidence import RPC returned an invalid record receipt.`);
  }
}

/** Adapts the public, versioned envelope to one append-only DB record per source key. */
export function buildGtaProspectOperatorEvidenceRecords(plan: GtaProspectEvidenceImportPlan): readonly OperatorRecord[] {
  if (!plan.accepted) throw new Error("A rejected GTA prospect evidence package has no operator records.");
  const pkg = plan.accepted;
  const evidenceById = new Map(pkg.evidence.map((item) => [item.evidenceId, item]));
  const grouped = new Map<string, OperatorRecord>();
  const forSource = (sourceRecordKey: string): OperatorRecord => {
    const current = grouped.get(sourceRecordKey);
    if (current) return current;
    const created: OperatorRecord = {
      sourceRecordKey,
      identityMappings: [],
      downtownGeography: [],
      websiteIntakeFindings: [],
      qualificationAssessments: [],
    };
    grouped.set(sourceRecordKey, created);
    return created;
  };
  const evidenceFor = (ids: readonly string[]) => ids.map((id) => evidenceById.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const evidenceUrlsFor = (ids: readonly string[]) => evidenceFor(ids).map((item) => item.sourceUrl);
  for (const mapping of pkg.identityMappings) {
    const target = forSource(mapping.sourceRecordKey);
    (target.identityMappings as Record<string, unknown>[]).push({
      mappingId: mapping.mappingId, matchState: mapping.matchState, firmId: mapping.firmId, canonicalDomain: mapping.canonicalDomain,
      observedAt: mapping.observedOn, confidence: mapping.confidence, evidenceUrls: evidenceUrlsFor(mapping.evidenceIds), note: mapping.reason,
      candidateFirmIds: mapping.candidateFirmIds, distinctFromFirmIds: mapping.distinctFromFirmIds, firmName: mapping.firmName,
    });
  }
  for (const observation of pkg.downtownGeography) {
    const target = forSource(observation.geography.sourceRecordKey);
    const geography = observation.geography;
    (target.downtownGeography as Record<string, unknown>[]).push({
      observationId: observation.observationId, boundaryId: geography.boundaryId, geographyStatus: geography.status,
      normalizedAddress: geography.normalizedAddress, latitude: geography.latitude, longitude: geography.longitude,
      coordinateSourceType: geography.coordinateSourceType, coordinateSourceUrl: geography.coordinateSourceUrl,
      boundarySourceUrl: geography.boundarySourceUrl, boundaryGeometrySha256: geography.boundaryGeometrySha256,
      observedAt: geography.observedOn, confidence: geography.confidence, note: geography.note,
      evidenceUrls: evidenceUrlsFor(observation.evidenceIds),
    });
  }
  for (const finding of pkg.websiteIntakeFindings) {
    const target = forSource(finding.sourceRecordKey);
    (target.websiteIntakeFindings as Record<string, unknown>[]).push({
      findingId: finding.observationId, sourceUrl: finding.websiteUrl, observedAt: finding.observedOn,
      intakeChannels: finding.visibleIntakeChannels, opportunityState: finding.opportunityState,
      opportunityNote: finding.opportunityReason ?? finding.note, evidenceUrls: evidenceUrlsFor(finding.evidenceIds),
    });
  }
  for (const assessment of pkg.qualificationAssessments) {
    const target = forSource(assessment.sourceRecordKey);
    (target.qualificationAssessments as Record<string, unknown>[]).push({
      assessmentId: assessment.assessmentId, qualificationState: assessment.state, qualificationCohort: "downtown_toronto_one_to_ten",
      assessedAt: assessment.assessedOn,
      criteria: {
        lawyerCount: assessment.criteria.rosterWithinOneToTen, downtownGeometry: assessment.criteria.downtownPlan41,
        sharedIdentity: assessment.criteria.sharedFirmIdentity, ownerContact: assessment.criteria.ownerDirectEmail,
        advertisingActivity: assessment.criteria.observableAdvertisingActivity, gbpEvidence: assessment.criteria.gbpOpportunity,
        websiteIntake: assessment.criteria.websiteIntake,
      }, evidenceUrls: evidenceUrlsFor(assessment.evidenceIds), note: assessment.rationale,
    });
  }
  return Object.freeze([...grouped.values()]);
}

/**
 * Applies one fully reviewed evidence envelope through the ledger's service-
 * only batch boundary. The database rechecks source-key existence and makes
 * exact package replays no-op. A rejected plan is never sent to the database.
 */
export async function applyGtaProspectOperatorEvidenceImport({
  plan,
  client,
}: Readonly<{
  plan: GtaProspectEvidenceImportPlan;
  client?: GtaProspectOperatorEvidenceImportClient;
}>): Promise<GtaProspectOperatorEvidenceImportResult> {
  if (!plan.accepted || !plan.payloadSha256 || plan.rejected.length) {
    throw new Error("Invalid GTA prospect evidence packages cannot be applied.");
  }
  const db = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectOperatorEvidenceImportClient;
  })();
  const records = buildGtaProspectOperatorEvidenceRecords(plan);
  const started = await db.rpc("begin_gta_prospect_supplemental_evidence_import", {
    p_package_id: plan.accepted.packageId,
    p_package_sha256: plan.payloadSha256,
    p_source_record_count: records.length,
  });
  if (started.error) throw rpcError(started.error, "Could not begin the GTA prospect evidence import batch.");
  const batch = parseBatchStart(started.data);
  if (batch.state === "already_applied") return {
    state: "already_applied", packageId: plan.accepted.packageId, payloadSha256: plan.payloadSha256, counts: plan.summary,
    receipt: { sourceRecordCount: records.length },
  };
  try {
    for (const record of records) {
      const hash = await db.rpc("gta_prospect_supplemental_evidence_record_sha256", { p_record: record });
      if (hash.error || typeof hash.data !== "string") throw rpcError(hash.error, `${record.sourceRecordKey}: could not canonicalize evidence record.`);
      const applied = await db.rpc("apply_gta_prospect_supplemental_evidence_record", {
        p_batch_id: batch.batchId, p_record: record, p_record_sha256: hash.data,
      });
      if (applied.error) throw rpcError(applied.error, `${record.sourceRecordKey}: could not apply supplemental evidence.`);
      parseRecordReceipt(applied.data, record.sourceRecordKey);
    }
  } catch (error) {
    const failed = await db.rpc("fail_gta_prospect_supplemental_evidence_import", { p_batch_id: batch.batchId });
    if (failed.error) throw new Error(`Evidence import failed and its batch could not be marked failed: ${failed.error.message ?? "unknown database error"}`);
    throw error;
  }
  const completed = await db.rpc("complete_gta_prospect_supplemental_evidence_import", { p_batch_id: batch.batchId });
  if (completed.error) throw rpcError(completed.error, "Could not complete the GTA prospect evidence import batch.");
  return { state: "applied", packageId: plan.accepted.packageId, payloadSha256: plan.payloadSha256, counts: plan.summary, receipt: { sourceRecordCount: records.length } };
}

/** Route-facing name for the service-only apply boundary. */
export const applyGtaProspectEvidencePackage = applyGtaProspectOperatorEvidenceImport;
