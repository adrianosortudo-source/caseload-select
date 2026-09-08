import {
  buildGtaProspectImportPlan,
  sha256,
  type GtaProspectImportPlan,
} from "@/lib/gta-prospect-research-import";

type JsonObject = Record<string, unknown>;

export type ResearchBatchInput = {
  batchId: string;
  sourcePath: string;
  qaPath: string;
  sourcePayload: JsonObject;
  qaPayload: JsonObject;
};

export type GtaProspectResearchManifest = {
  schemaVersion: "gta-prospect-research-dry-run-manifest-v1";
  purpose: "deterministic offline import review";
  actionsNotPerformed: readonly string[];
  sourceBatches: {
    batchId: string;
    sourcePath: string;
    sourceSha256: string;
    qaPath: string;
    qaSha256: string;
    sourceRecordCount: number;
    acceptedForStagingCount: number;
    excludedCount: number;
  }[];
  importPlan: {
    sourceSha256: string;
    acceptedRecordCount: number;
    rejectedRecordCount: number;
  };
  importRecords: GtaProspectImportPlan["accepted"];
  provenance: {
    sourceRecordKey: string;
    batchId: string;
    batchSourceRecordId: string;
    sourcePath: string;
    qaPath: string;
    qaDisposition: "accepted_for_staging";
    rosterSourceUrl: string;
    observedOn: string;
    observedLawyerCount: number;
    observedLawyerCountQualifier: "exact" | "at_least";
    legacyReconciliation: "unknown_no_stable_crosswalk";
  }[];
  exclusions: {
    batchId: string;
    batchSourceRecordId: string;
    qaDisposition: string;
    reason: string | null;
  }[];
};

const IMPORTER_KEYS = [
  "id",
  "firmName",
  "city",
  "officeCities",
  "websiteUrl",
  "practiceAreas",
  "observedLawyerCount",
  "observedLawyerCountQualifier",
  "observedLawyerCountDisplay",
  "rosterSourceUrl",
  "rosterCheckedAt",
  "reconciliationStatus",
  "legacyClusterLawyerCount",
  "legacyCrosswalk",
  "reconciliationNote",
  "advertisingEvidence",
  "advertisingSourceUrl",
  "gbpEvidence",
  "gbpSourceUrl",
] as const;

const asObject = (value: unknown): JsonObject | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const asRecords = (value: unknown, label: string): JsonObject[] => {
  if (!Array.isArray(value) || !value.every(asObject)) {
    throw new Error(`${label} must be an array of record objects.`);
  }
  return value as JsonObject[];
};

const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
};

const stringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string" && item.trim().length > 0)) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return [...value] as string[];
};

const positiveInteger = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value as number;
};

const sourceId = (record: JsonObject, label: string): string =>
  string(record.id ?? record.record_id, `${label} source record id`);

const qaId = (record: JsonObject, label: string): string =>
  string(record.id ?? record.record_id, `${label} QA record id`);

const normalizeSourceKey = (batchId: string, rawId: string) =>
  `gta-prospect-${batchId}-${rawId}`
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sourceRecords = (payload: JsonObject, label: string) =>
  asRecords(payload.records, `${label} source payload records`);

const qaRecords = (payload: JsonObject, label: string) =>
  asRecords(payload.records, `${label} QA payload records`);

const observationDate = (source: JsonObject, batch: ResearchBatchInput) =>
  string(source.observation_date ?? batch.sourcePayload.observed_on, `${batch.batchId} observation date`);

const countQualifier = (source: JsonObject, batchId: string): "exact" | "at_least" => {
  const raw = source.count_qualifier ?? source.count_label;
  if (raw === "exact") return "exact";
  if (raw === "at_least" || raw === "minimum") return "at_least";
  throw new Error(`${batchId} accepted source record has unsupported count qualifier ${JSON.stringify(raw)}.`);
};

const exclusionReason = (qa: JsonObject) => {
  if (typeof qa.reason === "string" && qa.reason.trim()) return qa.reason;
  if (Array.isArray(qa.reasons)) {
    const first = qa.reasons.find(value => typeof value === "string" && value.trim());
    if (typeof first === "string") return first;
  }
  return null;
};

function projectAcceptedRecord(source: JsonObject, batch: ResearchBatchInput) {
  const rawId = sourceId(source, batch.batchId);
  const officeCities = source.office_cities === undefined
    ? [string(source.office_city, `${batch.batchId}/${rawId} office city`)]
    : stringArray(source.office_cities, `${batch.batchId}/${rawId} office cities`);
  const practiceAreas = source.practice_areas === undefined
    ? stringArray(source.practice_areas_published ?? [], `${batch.batchId}/${rawId} published practice areas`)
    : stringArray(source.practice_areas, `${batch.batchId}/${rawId} practice areas`);
  const observedLawyerCount = positiveInteger(source.observed_lawyer_count, `${batch.batchId}/${rawId} observed lawyer count`);
  const qualifier = countQualifier(source, `${batch.batchId}/${rawId}`);
  const rosterSourceUrl = string(source.roster_source_url ?? source.first_party_roster_url, `${batch.batchId}/${rawId} roster source URL`);
  const observedOn = observationDate(source, batch);
  const id = normalizeSourceKey(batch.batchId, rawId);

  return {
    id,
    firmName: string(source.firm_name, `${batch.batchId}/${rawId} firm name`),
    city: officeCities[0],
    officeCities,
    websiteUrl: null,
    practiceAreas,
    observedLawyerCount,
    observedLawyerCountQualifier: qualifier,
    observedLawyerCountDisplay: null,
    rosterSourceUrl,
    rosterCheckedAt: observedOn,
    reconciliationStatus: "provisional_new",
    legacyClusterLawyerCount: null,
    legacyCrosswalk: null,
    reconciliationNote: "Legacy reconciliation is unknown: no stable row-level crosswalk is present in the historical address-cluster artifact.",
    advertisingEvidence: "unknown",
    advertisingSourceUrl: null,
    gbpEvidence: "unknown",
    gbpSourceUrl: null,
  } satisfies Record<(typeof IMPORTER_KEYS)[number], unknown>;
}

export async function buildGtaProspectResearchManifest(
  batches: readonly ResearchBatchInput[],
): Promise<GtaProspectResearchManifest> {
  if (batches.length !== 9) throw new Error("The manifest must reconcile exactly research batches 001 through 009.");

  const importInputs: JsonObject[] = [];
  const provenance: GtaProspectResearchManifest["provenance"] = [];
  const exclusions: GtaProspectResearchManifest["exclusions"] = [];
  const sourceBatches: GtaProspectResearchManifest["sourceBatches"] = [];

  for (const batch of [...batches].sort((left, right) => left.batchId.localeCompare(right.batchId))) {
    const source = sourceRecords(batch.sourcePayload, batch.batchId);
    const qa = qaRecords(batch.qaPayload, batch.batchId);
    const sourceById = new Map<string, JsonObject>();
    const qaById = new Map<string, JsonObject>();

    for (const record of source) {
      const id = sourceId(record, batch.batchId);
      if (sourceById.has(id)) throw new Error(`${batch.batchId} has a duplicate source record id ${id}.`);
      sourceById.set(id, record);
    }
    for (const record of qa) {
      const id = qaId(record, batch.batchId);
      if (qaById.has(id)) throw new Error(`${batch.batchId} has a duplicate QA record id ${id}.`);
      if (!sourceById.has(id)) throw new Error(`${batch.batchId} QA record ${id} has no source record.`);
      qaById.set(id, record);
    }
    if (qaById.size !== sourceById.size) {
      throw new Error(`${batch.batchId} source/QA record coverage differs (${sourceById.size} source, ${qaById.size} QA).`);
    }

    let acceptedForStagingCount = 0;
    for (const [rawId, record] of [...sourceById.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const review = qaById.get(rawId)!;
      const disposition = string(review.disposition, `${batch.batchId}/${rawId} QA disposition`);
      if (disposition !== "accepted_for_staging") {
        exclusions.push({ batchId: batch.batchId, batchSourceRecordId: rawId, qaDisposition: disposition, reason: exclusionReason(review) });
        continue;
      }

      const input = projectAcceptedRecord(record, batch);
      importInputs.push(input);
      provenance.push({
        sourceRecordKey: input.id,
        batchId: batch.batchId,
        batchSourceRecordId: rawId,
        sourcePath: batch.sourcePath,
        qaPath: batch.qaPath,
        qaDisposition: "accepted_for_staging",
        rosterSourceUrl: input.rosterSourceUrl,
        observedOn: input.rosterCheckedAt,
        observedLawyerCount: input.observedLawyerCount,
        observedLawyerCountQualifier: input.observedLawyerCountQualifier,
        legacyReconciliation: "unknown_no_stable_crosswalk",
      });
      acceptedForStagingCount += 1;
    }
    sourceBatches.push({
      batchId: batch.batchId,
      sourcePath: batch.sourcePath,
      sourceSha256: await sha256(batch.sourcePayload),
      qaPath: batch.qaPath,
      qaSha256: await sha256(batch.qaPayload),
      sourceRecordCount: source.length,
      acceptedForStagingCount,
      excludedCount: source.length - acceptedForStagingCount,
    });
  }

  const plan = await buildGtaProspectImportPlan(importInputs.sort((left, right) => String(left.id).localeCompare(String(right.id))));
  if (plan.rejected.length) {
    throw new Error(`The deterministic manifest does not satisfy the importer contract: ${JSON.stringify(plan.rejected)}.`);
  }

  const sourceKeys = new Set(plan.accepted.map(record => record.sourceRecordKey));
  if (sourceKeys.size !== plan.accepted.length || sourceKeys.size !== provenance.length) {
    throw new Error("The manifest contains duplicate source record keys.");
  }

  return {
    schemaVersion: "gta-prospect-research-dry-run-manifest-v1",
    purpose: "deterministic offline import review",
    actionsNotPerformed: [
      "database connection",
      "migration application",
      "data import",
      "CRM activity",
      "contact or outreach",
      "deployment",
      "merge",
    ],
    sourceBatches,
    importPlan: {
      sourceSha256: plan.sourceSha256,
      acceptedRecordCount: plan.accepted.length,
      rejectedRecordCount: plan.rejected.length,
    },
    importRecords: plan.accepted,
    provenance: provenance.sort((left, right) => left.sourceRecordKey.localeCompare(right.sourceRecordKey)),
    exclusions: exclusions.sort((left, right) => `${left.batchId}/${left.batchSourceRecordId}`.localeCompare(`${right.batchId}/${right.batchSourceRecordId}`)),
  };
}
