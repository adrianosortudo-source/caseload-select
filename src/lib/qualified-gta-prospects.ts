import source from "@/data/qualified-gta-prospects.json";
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";

export type QualifiedProspectConfidence = "high" | "moderate";
export type AdvertisingActivityState = "observable_current" | "observable_recent" | "observable_historical";
export type QualificationState = "qualified" | "needs_evidence";
export type AuditState = "ready" | "not_ready";
export type EvidenceFreshness = "last_30_days" | "31_to_180_days" | "older_than_180_days" | "unknown";

export type IntakeChannelObservation = {
  channel: string;
  observed_state: string;
};

export type QualifiedProspectEvidence = {
  evidenceId: string;
  firmId: string;
  sourceType: string;
  sourceUrl: string;
  observedAt: string;
  captureSha256: string;
  recordLocator: string | null;
  registrationScope: readonly string[];
  limits: readonly string[];
  disposition: string;
};

export type QualifiedProspectDossier = {
  firmId: string;
  firmName: string;
  canonicalDomain: string;
  websiteUrl: string;
  city: string;
  officeCities: readonly string[];
  sourceRecordRefs: readonly {
    source_system: string;
    source_record_id: string;
    source_file_sha256?: string | null;
    source_record_sha256: string | null;
  }[];
  identityLimitations: readonly string[];
  lawyerCount: {
    observedCount: 2 | 3;
    observedAt: string;
    confidence: QualifiedProspectConfidence;
    namedLawyers: readonly string[];
    sourceType: string;
    sourceUrl: string;
    evidenceIds: readonly string[];
    completenessLimit: string;
  };
  advertisingActivity: {
    state: AdvertisingActivityState;
    summary: string;
    evidenceIds: readonly string[];
    sourceTypes: readonly string[];
    spendClaim: "not_made";
    limitations: readonly string[];
  };
  gbpOpportunity: {
    type: string;
    reason: string;
    sourceUrl: string;
    observedAt: string;
    profileFields: Record<string, unknown>;
    recommendedReview: string;
    limitations: readonly string[];
  };
  websiteAndIntake: {
    opportunityTypes: readonly string[];
    opportunityContext: string;
    sourceUrl: string;
    observedOn: string;
    evidenceIds: readonly string[];
    channels: readonly IntakeChannelObservation[];
    observedChannels: readonly string[];
    limitation: string;
  };
  qualification: {
    state: "qualified";
    ruleVersion: string;
    assessedAt: string;
    cohortId: string;
    criteria: {
      acceptedTwoOrThreeLawyerObservation: true;
      observableAdvertisingActivity: true;
      supportedGbpOpportunity: true;
      registeredWebsiteAndIntakeEvidence: true;
    };
  };
  audit: {
    auditId: string;
    state: "ready";
    sourceFile: string;
    observedOn: string;
    verificationPriorities: readonly string[];
    claimBoundaries: readonly string[];
  };
  evidenceIds: readonly string[];
  controls: QualifiedProspectControls;
};

export type QualifiedProspectControls = {
  contactAuthorized: false;
  sendAuthorized: false;
  outreachAuthorized: false;
  formSubmissionAuthorized: false;
  deliveryOrPublicationAuthorized: false;
  implementationAuthorized: false;
  pdfGenerationAuthorized: false;
};

type QualifiedProspectArtifact = {
  schemaVersion: string;
  generatedAt: string;
  cohortId: string;
  sourceProvenance: {
    handoff: { file: string; sha256: string };
    registry: { file: string; sha256: string };
    audits: readonly { file: string; sha256: string }[];
  };
  importPolicy: {
    identityKey: string;
    duplicatePolicy: string;
    mutationScope: string;
  };
  controls: QualifiedProspectControls;
  dossiers: readonly QualifiedProspectDossier[];
  evidenceRecords: readonly QualifiedProspectEvidence[];
};

export type QualifiedProspectImportReport = {
  cohortId: string;
  inputCount: number;
  added: number;
  updated: number;
  ambiguous: number;
  unchangedBaseRecords: number;
  additions: readonly { firmId: string; canonicalDomain: string; recordId: string }[];
  updates: readonly { firmId: string; canonicalDomain: string; recordId: string }[];
  ambiguities: readonly { firmId: string; canonicalDomain: string; recordIds: readonly string[] }[];
};

export type QualifiedProspectMergeResult = {
  records: ReconciledGtaProspect[];
  report: QualifiedProspectImportReport;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFalseControls(value: unknown): value is QualifiedProspectControls {
  if (!isObject(value)) return false;
  return [
    "contactAuthorized",
    "sendAuthorized",
    "outreachAuthorized",
    "formSubmissionAuthorized",
    "deliveryOrPublicationAuthorized",
    "implementationAuthorized",
    "pdfGenerationAuthorized",
  ].every((key) => value[key] === false);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isObservedDate(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && !Number.isNaN(Date.parse(value));
}

function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateArtifact(value: unknown): QualifiedProspectArtifact {
  if (!isObject(value) || value.schemaVersion !== "1.0.0" || value.cohortId !== "qualified-prospects-2026-09-07") {
    throw new Error("Qualified prospect artifact identity is invalid.");
  }
  if (!Array.isArray(value.dossiers) || value.dossiers.length !== 20) {
    throw new Error("Qualified prospect artifact must contain 20 dossiers.");
  }
  if (!Array.isArray(value.evidenceRecords) || value.evidenceRecords.length !== 94) {
    throw new Error("Qualified prospect artifact must contain 94 evidence records.");
  }
  if (!isFalseControls(value.controls)) throw new Error("Qualified prospect artifact controls must remain disabled.");
  const provenance = value.sourceProvenance;
  if (!isObject(provenance) || !isObject(provenance.handoff) || !isObject(provenance.registry)
    || !isSha256(provenance.handoff.sha256) || !isSha256(provenance.registry.sha256)
    || !Array.isArray(provenance.audits) || provenance.audits.length !== 20
    || provenance.audits.some((entry) => !isObject(entry) || !isSha256(entry.sha256))) {
    throw new Error("Qualified prospect source provenance is incomplete.");
  }

  const dossiers = value.dossiers as unknown as QualifiedProspectDossier[];
  const evidenceRecords = value.evidenceRecords as unknown as QualifiedProspectEvidence[];
  const firmIds = new Set<string>();
  const domains = new Set<string>();
  const evidenceById = new Map(evidenceRecords.map((record) => [record.evidenceId, record]));
  if (evidenceById.size !== 94) throw new Error("Qualified prospect evidence IDs must be unique.");

  for (const record of evidenceRecords) {
    if (!/^EVID-[A-Z0-9]+$/.test(record.evidenceId) || !isSha256(record.captureSha256)
      || !record.sourceType.trim() || !isPublicHttpUrl(record.sourceUrl) || !isObservedDate(record.observedAt)) {
      throw new Error(`Qualified prospect evidence ${record.evidenceId} has invalid identity or hash.`);
    }
  }
  for (const dossier of dossiers) {
    const domain = normalizeCanonicalDomain(dossier.canonicalDomain);
    if (!/^FIRM-[A-Z0-9]+$/.test(dossier.firmId) || !domain || domain !== dossier.canonicalDomain) {
      throw new Error(`Qualified prospect ${dossier.firmName} has invalid firm identity.`);
    }
    if (firmIds.has(dossier.firmId) || domains.has(domain)) {
      throw new Error(`Qualified prospect ${dossier.firmName} duplicates an identity key.`);
    }
    firmIds.add(dossier.firmId);
    domains.add(domain);
    if (![2, 3].includes(dossier.lawyerCount.observedCount) || dossier.lawyerCount.namedLawyers.length !== dossier.lawyerCount.observedCount) {
      throw new Error(`Qualified prospect ${dossier.firmName} has an invalid lawyer observation.`);
    }
    if (new Set(dossier.lawyerCount.namedLawyers.map((name) => name.trim())).size !== dossier.lawyerCount.observedCount
      || dossier.lawyerCount.namedLawyers.some((name) => !name.trim())
      || !["high", "moderate"].includes(dossier.lawyerCount.confidence)
      || !isObservedDate(dossier.lawyerCount.observedAt)
      || !isPublicHttpUrl(dossier.lawyerCount.sourceUrl)
      || dossier.lawyerCount.evidenceIds.length === 0) {
      throw new Error(`Qualified prospect ${dossier.firmName} lacks evidence-bearing lawyer-count data.`);
    }
    if (dossier.advertisingActivity.spendClaim !== "not_made"
      || !["observable_current", "observable_recent", "observable_historical"].includes(dossier.advertisingActivity.state)
      || dossier.advertisingActivity.evidenceIds.length === 0
      || dossier.advertisingActivity.sourceTypes.length === 0
      || dossier.advertisingActivity.sourceTypes.some((sourceType) => !sourceType.trim())
      || dossier.qualification.state !== "qualified" || dossier.audit.state !== "ready") {
      throw new Error(`Qualified prospect ${dossier.firmName} does not meet the cohort contract.`);
    }
    if (!dossier.qualification.criteria.acceptedTwoOrThreeLawyerObservation
      || !dossier.qualification.criteria.observableAdvertisingActivity
      || !dossier.qualification.criteria.supportedGbpOpportunity
      || !dossier.qualification.criteria.registeredWebsiteAndIntakeEvidence
      || !isPublicHttpUrl(dossier.gbpOpportunity.sourceUrl)
      || !dossier.gbpOpportunity.reason.trim()
      || !isPublicHttpUrl(dossier.websiteAndIntake.sourceUrl)
      || dossier.websiteAndIntake.evidenceIds.length === 0
      || dossier.websiteAndIntake.observedChannels.length === 0
      || dossier.audit.verificationPriorities.length === 0) {
      throw new Error(`Qualified prospect ${dossier.firmName} lacks supported opportunity or audit evidence.`);
    }
    if (!isFalseControls(dossier.controls)) throw new Error(`Qualified prospect ${dossier.firmName} has an enabled external action.`);
    const aggregateEvidenceIds = new Set(dossier.evidenceIds);
    const fieldEvidenceIds = [
      ...dossier.lawyerCount.evidenceIds,
      ...dossier.advertisingActivity.evidenceIds,
      ...dossier.websiteAndIntake.evidenceIds,
    ];
    for (const evidenceId of fieldEvidenceIds) {
      if (!aggregateEvidenceIds.has(evidenceId) || evidenceById.get(evidenceId)?.firmId !== dossier.firmId) {
        throw new Error(`Qualified prospect ${dossier.firmName} has an invalid field evidence reference.`);
      }
    }
    const derivedAdvertisingTypes = new Set(dossier.advertisingActivity.evidenceIds.map((evidenceId) => evidenceById.get(evidenceId)?.sourceType));
    if (derivedAdvertisingTypes.has(undefined)
      || new Set(dossier.advertisingActivity.sourceTypes).size !== dossier.advertisingActivity.sourceTypes.length
      || dossier.advertisingActivity.sourceTypes.some((sourceType) => !derivedAdvertisingTypes.has(sourceType))
      || derivedAdvertisingTypes.size !== dossier.advertisingActivity.sourceTypes.length) {
      throw new Error(`Qualified prospect ${dossier.firmName} has inconsistent advertising source types.`);
    }
    for (const evidenceId of dossier.evidenceIds) {
      if (evidenceById.get(evidenceId)?.firmId !== dossier.firmId) {
        throw new Error(`Qualified prospect ${dossier.firmName} has an invalid evidence reference.`);
      }
    }
  }
  for (const record of evidenceRecords) {
    if (!firmIds.has(record.firmId)) throw new Error(`Evidence ${record.evidenceId} has no qualified firm.`);
  }
  return value as unknown as QualifiedProspectArtifact;
}

export function normalizeCanonicalDomain(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLocaleLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return null;
  }
}

function qualifiedRecordId(domain: string): string {
  return `qualified-${domain.replace(/[^a-z0-9]+/g, "-")}`;
}

function enrichRecord(record: ReconciledGtaProspect, dossier: QualifiedProspectDossier): ReconciledGtaProspect {
  return {
    ...record,
    firmId: dossier.firmId,
    canonicalDomain: dossier.canonicalDomain,
    observedLawyerCount: dossier.lawyerCount.observedCount,
    observedLawyerCountQualifier: "exact",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: dossier.lawyerCount.sourceUrl,
    rosterCheckedAt: dossier.lawyerCount.observedAt.slice(0, 10),
    advertisingEvidence: "observed",
    advertisingSourceUrl: evidenceUrl(dossier.advertisingActivity.evidenceIds[0]),
    gbpEvidence: "observed",
    gbpSourceUrl: dossier.gbpOpportunity.sourceUrl,
    qualifiedDossier: dossier,
  };
}

function addRecord(dossier: QualifiedProspectDossier): ReconciledGtaProspect {
  return {
    id: qualifiedRecordId(dossier.canonicalDomain),
    firmId: dossier.firmId,
    canonicalDomain: dossier.canonicalDomain,
    firmName: dossier.firmName,
    city: dossier.city,
    officeCities: dossier.officeCities,
    websiteUrl: dossier.websiteUrl,
    practiceAreas: [],
    observedLawyerCount: dossier.lawyerCount.observedCount,
    observedLawyerCountQualifier: "exact",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: dossier.lawyerCount.sourceUrl,
    rosterCheckedAt: dossier.lawyerCount.observedAt.slice(0, 10),
    reconciliationStatus: "provisional_new",
    legacyClusterLawyerCount: null,
    legacyCrosswalk: dossier.sourceRecordRefs.length > 0
      ? "Qualified cohort source references retained in the firm audit."
      : null,
    reconciliationNote: dossier.identityLimitations.length > 0
      ? "Identity limitations remain recorded in the evidence-linked audit."
      : "Matched through the approved canonical firm identity.",
    advertisingEvidence: "observed",
    advertisingSourceUrl: evidenceUrl(dossier.advertisingActivity.evidenceIds[0]),
    gbpEvidence: "observed",
    gbpSourceUrl: dossier.gbpOpportunity.sourceUrl,
    qualifiedDossier: dossier,
  };
}

const artifact = validateArtifact(source);
const evidenceIndex = new Map(artifact.evidenceRecords.map((record) => [record.evidenceId, record]));

function evidenceUrl(evidenceId: string | undefined): string | null {
  return evidenceId ? evidenceIndex.get(evidenceId)?.sourceUrl ?? null : null;
}

export const QUALIFIED_GTA_PROSPECT_ARTIFACT = artifact;
export const QUALIFIED_GTA_PROSPECTS = artifact.dossiers;
export const QUALIFIED_GTA_PROSPECT_EVIDENCE = artifact.evidenceRecords;

export function getQualifiedProspectByFirmId(firmId: string): QualifiedProspectDossier | null {
  return artifact.dossiers.find((dossier) => dossier.firmId === firmId) ?? null;
}

export function evidenceForQualifiedProspect(firmId: string): QualifiedProspectEvidence[] {
  return artifact.evidenceRecords.filter((record) => record.firmId === firmId);
}

export function mergeQualifiedProspects(baseRecords: readonly ReconciledGtaProspect[]): QualifiedProspectMergeResult {
  const records = [...baseRecords];
  const domainIndexes = new Map<string, number[]>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const domain = normalizeCanonicalDomain(record.canonicalDomain ?? record.websiteUrl);
    if (!domain) continue;
    domainIndexes.set(domain, [...(domainIndexes.get(domain) ?? []), index]);
  }

  const additions: { firmId: string; canonicalDomain: string; recordId: string }[] = [];
  const updates: { firmId: string; canonicalDomain: string; recordId: string }[] = [];
  const ambiguities: { firmId: string; canonicalDomain: string; recordIds: string[] }[] = [];
  const touchedBaseIndexes = new Set<number>();

  for (const dossier of artifact.dossiers) {
    const indexes = domainIndexes.get(dossier.canonicalDomain) ?? [];
    if (indexes.length > 1) {
      ambiguities.push({
        firmId: dossier.firmId,
        canonicalDomain: dossier.canonicalDomain,
        recordIds: indexes.map((index) => records[index].id),
      });
      continue;
    }
    if (indexes.length === 1) {
      const index = indexes[0];
      records[index] = enrichRecord(records[index], dossier);
      touchedBaseIndexes.add(index);
      updates.push({ firmId: dossier.firmId, canonicalDomain: dossier.canonicalDomain, recordId: records[index].id });
      continue;
    }
    const added = addRecord(dossier);
    records.push(added);
    domainIndexes.set(dossier.canonicalDomain, [records.length - 1]);
    additions.push({ firmId: dossier.firmId, canonicalDomain: dossier.canonicalDomain, recordId: added.id });
  }

  records.sort((left, right) => left.firmName.localeCompare(right.firmName, "en-CA", { sensitivity: "base" }) || left.id.localeCompare(right.id, "en-CA"));
  return {
    records,
    report: {
      cohortId: artifact.cohortId,
      inputCount: artifact.dossiers.length,
      added: additions.length,
      updated: updates.length,
      ambiguous: ambiguities.length,
      unchangedBaseRecords: baseRecords.length - touchedBaseIndexes.size,
      additions,
      updates,
      ambiguities,
    },
  };
}

export function qualificationState(record: ReconciledGtaProspect): QualificationState {
  return record.qualifiedDossier ? "qualified" : "needs_evidence";
}

export function auditState(record: ReconciledGtaProspect): AuditState {
  return record.qualifiedDossier?.audit.state === "ready" ? "ready" : "not_ready";
}

export function evidenceFreshness(
  record: ReconciledGtaProspect,
  referenceDate: Date = new Date(),
): EvidenceFreshness {
  const observed = record.qualifiedDossier?.audit.observedOn ?? record.rosterCheckedAt;
  const observedDate = new Date(`${observed.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(observedDate.getTime())) return "unknown";
  const ageDays = Math.max(0, Math.floor((referenceDate.getTime() - observedDate.getTime()) / 86_400_000));
  if (ageDays <= 30) return "last_30_days";
  if (ageDays <= 180) return "31_to_180_days";
  return "older_than_180_days";
}
