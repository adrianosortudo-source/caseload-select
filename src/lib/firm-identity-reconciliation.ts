/**
 * Shared, persistence-agnostic identity contract for firm expansion imports.
 *
 * The helpers in this module never allocate IDs and never fuzzy-merge a legacy
 * row. Callers must persist source mappings and stable firm IDs in their own
 * governed store. A match is mergeable only when `mergeAuthorized` is true.
 */

export const FIRM_IDENTITY_MATCH_STATES = ["confirmed", "unresolved", "distinct"] as const;
export type FirmIdentityMatchState = (typeof FIRM_IDENTITY_MATCH_STATES)[number];

export const FIRM_IDENTITY_CONFIDENCE_LEVELS = ["unknown", "low", "moderate", "high"] as const;
export type FirmIdentityConfidence = (typeof FIRM_IDENTITY_CONFIDENCE_LEVELS)[number];

export const FIRM_IDENTITY_EVIDENCE_SOURCES = [
  "public_regulator",
  "first_party_canonical",
  "official_business_profile",
  "publisher_record",
  "directory_record",
  "legacy_dataset",
] as const;
export type FirmIdentityEvidenceSource = (typeof FIRM_IDENTITY_EVIDENCE_SOURCES)[number];

export type StableFirmId = `FIRM-${string}`;

export type FirmSourceRecordRef = {
  sourceSystem: string;
  sourceRecordId: string;
};

type SourceMappingBase = FirmSourceRecordRef & {
  observedAt: string;
  confidence: FirmIdentityConfidence;
  evidenceIds: readonly string[];
  reason: string;
};

export type FirmSourceRecordMapping =
  | (SourceMappingBase & {
      matchState: "confirmed";
      firmId: StableFirmId;
      candidateFirmIds?: never;
      distinctFromFirmIds?: never;
    })
  | (SourceMappingBase & {
      matchState: "unresolved";
      firmId: null;
      candidateFirmIds: readonly StableFirmId[];
      distinctFromFirmIds?: never;
    })
  | (SourceMappingBase & {
      matchState: "distinct";
      firmId: null;
      candidateFirmIds?: never;
      distinctFromFirmIds: readonly StableFirmId[];
    });

export type GovernedFirmIdentity = {
  firmId: StableFirmId;
  canonicalName: string;
  canonicalDomain: string;
};

export type FirmIdentityCandidate = FirmSourceRecordRef & {
  firmId?: string | null;
  firmName: string;
  canonicalDomain?: string | null;
};

export type FirmIdentityMatchBasis =
  | "confirmed_source_mapping"
  | "stable_firm_id"
  | "unique_canonical_domain"
  | "explicit_unresolved_mapping"
  | "explicit_distinct_mapping"
  | "conflicting_high_confidence_identifiers"
  | "ambiguous_canonical_domain"
  | "name_only_candidate"
  | "no_high_confidence_match";

export type FirmIdentityMatchResult = {
  matchState: FirmIdentityMatchState;
  firmId: StableFirmId | null;
  candidateFirmIds: readonly StableFirmId[];
  basis: FirmIdentityMatchBasis;
  confidence: FirmIdentityConfidence;
  mergeAuthorized: boolean;
  reasons: readonly string[];
};

export type FirmIdentityEvidenceObservation<T> = {
  evidenceId: string;
  source: FirmIdentityEvidenceSource;
  observedAt: string;
  confidence: FirmIdentityConfidence;
  value: T;
};

export type FirmIdentityEvidenceResolution<T> =
  | { state: "empty"; preferred: null; ordered: readonly FirmIdentityEvidenceObservation<T>[]; contenders: readonly [] }
  | { state: "selected"; preferred: FirmIdentityEvidenceObservation<T>; ordered: readonly FirmIdentityEvidenceObservation<T>[]; contenders: readonly FirmIdentityEvidenceObservation<T>[] }
  | { state: "conflict"; preferred: null; ordered: readonly FirmIdentityEvidenceObservation<T>[]; contenders: readonly FirmIdentityEvidenceObservation<T>[] };

const STABLE_FIRM_ID_PATTERN = /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/;
const SOURCE_PRECEDENCE: Record<FirmIdentityEvidenceSource, number> = {
  public_regulator: 600,
  first_party_canonical: 500,
  official_business_profile: 400,
  publisher_record: 300,
  directory_record: 200,
  legacy_dataset: 100,
};
const CONFIDENCE_PRECEDENCE: Record<FirmIdentityConfidence, number> = {
  high: 3,
  moderate: 2,
  low: 1,
  unknown: 0,
};

export function isStableFirmId(value: unknown): value is StableFirmId {
  return typeof value === "string" && STABLE_FIRM_ID_PATTERN.test(value);
}

export function normalizeFirmDomain(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    return parsed.hostname.toLocaleLowerCase("en-CA").replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function sourceRecordMappingKey(source: FirmSourceRecordRef): string {
  const sourceSystem = source.sourceSystem.trim().toLocaleLowerCase("en-CA");
  const sourceRecordId = source.sourceRecordId.trim();
  if (!sourceSystem || !sourceRecordId) throw new Error("Source mappings require a source system and record ID.");
  return JSON.stringify([sourceSystem, sourceRecordId]);
}

function observedAtMilliseconds(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid evidence observation date: ${value}`);
  return parsed;
}

function normalizedFirmName(value: string): string {
  return value.trim().toLocaleLowerCase("en-CA").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function uniqueFirmIds(values: readonly (StableFirmId | null | undefined)[]): StableFirmId[] {
  return [...new Set(values.filter((value): value is StableFirmId => value !== null && value !== undefined))].sort();
}

function compareSourceMappings(left: FirmSourceRecordMapping, right: FirmSourceRecordMapping): number {
  const dateDifference = observedAtMilliseconds(right.observedAt) - observedAtMilliseconds(left.observedAt);
  if (dateDifference) return dateDifference;
  const confidenceDifference = CONFIDENCE_PRECEDENCE[right.confidence] - CONFIDENCE_PRECEDENCE[left.confidence];
  if (confidenceDifference) return confidenceDifference;
  const leftEvidence = [...left.evidenceIds].sort().join("\u0000");
  const rightEvidence = [...right.evidenceIds].sort().join("\u0000");
  return leftEvidence.localeCompare(rightEvidence, "en-CA") || left.reason.localeCompare(right.reason, "en-CA");
}

export function validateFirmSourceRecordMapping(mapping: FirmSourceRecordMapping): readonly string[] {
  const issues: string[] = [];
  try {
    sourceRecordMappingKey(mapping);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Source mapping key is invalid.");
  }
  if (!Number.isFinite(Date.parse(mapping.observedAt))) issues.push("Source mapping observedAt must be a valid date.");
  if (!mapping.reason.trim()) issues.push("Source mapping reason is required.");
  if (mapping.evidenceIds.length === 0 || mapping.evidenceIds.some((id) => !id.trim())) {
    issues.push("Source mapping requires at least one evidence ID.");
  }
  if (mapping.matchState === "confirmed" && !isStableFirmId(mapping.firmId)) {
    issues.push("Confirmed source mappings require a stable firm ID.");
  }
  if (mapping.matchState === "unresolved" && mapping.candidateFirmIds.some((firmId) => !isStableFirmId(firmId))) {
    issues.push("Unresolved source mappings may reference only stable candidate firm IDs.");
  }
  if (mapping.matchState === "distinct") {
    if (mapping.distinctFromFirmIds.length === 0) issues.push("Distinct source mappings require at least one firm ID they are distinct from.");
    if (mapping.distinctFromFirmIds.some((firmId) => !isStableFirmId(firmId))) {
      issues.push("Distinct source mappings may reference only stable firm IDs.");
    }
  }
  return issues;
}

function compareEvidence<T>(left: FirmIdentityEvidenceObservation<T>, right: FirmIdentityEvidenceObservation<T>): number {
  const sourceDifference = SOURCE_PRECEDENCE[right.source] - SOURCE_PRECEDENCE[left.source];
  if (sourceDifference) return sourceDifference;
  const dateDifference = observedAtMilliseconds(right.observedAt) - observedAtMilliseconds(left.observedAt);
  if (dateDifference) return dateDifference;
  const confidenceDifference = CONFIDENCE_PRECEDENCE[right.confidence] - CONFIDENCE_PRECEDENCE[left.confidence];
  if (confidenceDifference) return confidenceDifference;
  return left.evidenceId.localeCompare(right.evidenceId, "en-CA");
}

function sameEvidenceRank<T>(left: FirmIdentityEvidenceObservation<T>, right: FirmIdentityEvidenceObservation<T>): boolean {
  return left.source === right.source
    && observedAtMilliseconds(left.observedAt) === observedAtMilliseconds(right.observedAt)
    && left.confidence === right.confidence;
}

/**
 * Resolves evidence in the fixed order source authority, observation date,
 * confidence, then evidence ID for a deterministic same-value tie-break.
 * Equally ranked conflicting values are returned as a conflict, never chosen.
 */
export function resolveFirmIdentityEvidence<T>(
  observations: readonly FirmIdentityEvidenceObservation<T>[],
  equal: (left: T, right: T) => boolean = Object.is,
): FirmIdentityEvidenceResolution<T> {
  for (const observation of observations) {
    if (!observation.evidenceId.trim()) throw new Error("Identity evidence requires an evidence ID.");
    observedAtMilliseconds(observation.observedAt);
  }
  const ordered = [...observations].sort(compareEvidence);
  const preferred = ordered[0];
  if (!preferred) return { state: "empty", preferred: null, ordered, contenders: [] };
  const contenders = ordered.filter((observation) => sameEvidenceRank(observation, preferred));
  if (contenders.some((observation) => !equal(observation.value, preferred.value))) {
    return { state: "conflict", preferred: null, ordered, contenders };
  }
  return { state: "selected", preferred, ordered, contenders };
}

function unresolved(
  basis: FirmIdentityMatchBasis,
  candidates: readonly StableFirmId[],
  reasons: readonly string[],
  confidence: FirmIdentityConfidence = "unknown",
): FirmIdentityMatchResult {
  return {
    matchState: "unresolved",
    firmId: null,
    candidateFirmIds: uniqueFirmIds(candidates),
    basis,
    confidence,
    mergeAuthorized: false,
    reasons,
  };
}

function confirmed(firmId: StableFirmId, basis: FirmIdentityMatchBasis, reason: string): FirmIdentityMatchResult {
  return {
    matchState: "confirmed",
    firmId,
    candidateFirmIds: [firmId],
    basis,
    confidence: "high",
    mergeAuthorized: true,
    reasons: [reason],
  };
}

function mappingConflictResult(mappings: readonly FirmSourceRecordMapping[]): FirmIdentityMatchResult | null {
  if (mappings.length === 0) return null;
  const signatures = new Set(mappings.map((mapping) => JSON.stringify([
    mapping.matchState,
    mapping.firmId,
    mapping.matchState === "unresolved" ? uniqueFirmIds(mapping.candidateFirmIds) : [],
    mapping.matchState === "distinct" ? uniqueFirmIds(mapping.distinctFromFirmIds) : [],
  ])));
  if (signatures.size === 1) return null;
  return unresolved(
    "conflicting_high_confidence_identifiers",
    mappings.flatMap((mapping) => mapping.matchState === "confirmed"
      ? [mapping.firmId]
      : mapping.matchState === "unresolved"
        ? mapping.candidateFirmIds
        : mapping.distinctFromFirmIds),
    ["The same source record has conflicting governed mappings; manual reconciliation is required."],
    "high",
  );
}

/**
 * Matches only governed high-confidence identifiers. Names are diagnostic and
 * never authorize a merge. Explicit unresolved/distinct mappings outrank
 * domain similarity and keep the candidate out of automatic ingestion.
 */
export function matchFirmIdentityCandidate(
  candidate: FirmIdentityCandidate,
  identities: readonly GovernedFirmIdentity[],
  mappings: readonly FirmSourceRecordMapping[],
): FirmIdentityMatchResult {
  const identityById = new Map(identities.map((identity) => [identity.firmId, identity]));
  if (identityById.size !== identities.length || identities.some((identity) => !isStableFirmId(identity.firmId))) {
    throw new Error("Governed firm identities require unique stable firm IDs.");
  }
  const invalidDomain = identities.find((identity) => normalizeFirmDomain(identity.canonicalDomain) !== identity.canonicalDomain);
  if (invalidDomain) throw new Error(`Governed firm ${invalidDomain.firmId} has a non-canonical domain.`);
  for (const mapping of mappings) {
    const issues = validateFirmSourceRecordMapping(mapping);
    if (issues.length) throw new Error(`Invalid source mapping ${sourceRecordMappingKey(mapping)}: ${issues.join(" ")}`);
  }

  const candidateKey = sourceRecordMappingKey(candidate);
  const exactMappings = mappings
    .filter((mapping) => sourceRecordMappingKey(mapping) === candidateKey)
    .sort(compareSourceMappings);
  const mappingConflict = mappingConflictResult(exactMappings);
  if (mappingConflict) return mappingConflict;
  const mapping = exactMappings[0];
  if (mapping?.matchState === "unresolved") {
    return unresolved("explicit_unresolved_mapping", mapping.candidateFirmIds, [mapping.reason], mapping.confidence);
  }
  if (mapping?.matchState === "distinct") {
    return {
      matchState: "distinct",
      firmId: null,
      candidateFirmIds: uniqueFirmIds(mapping.distinctFromFirmIds),
      basis: "explicit_distinct_mapping",
      confidence: mapping.confidence,
      mergeAuthorized: false,
      reasons: [mapping.reason],
    };
  }
  if (mapping?.matchState === "confirmed") {
    const identity = identityById.get(mapping.firmId);
    if (!identity) return unresolved("conflicting_high_confidence_identifiers", [mapping.firmId], ["The confirmed source mapping references a firm that is not in the governed identity set."], "high");
    const candidateDomain = normalizeFirmDomain(candidate.canonicalDomain);
    if ((candidate.firmId && candidate.firmId !== mapping.firmId) || (candidateDomain && candidateDomain !== identity.canonicalDomain)) {
      const conflictingFirmIds: StableFirmId[] = [mapping.firmId];
      if (isStableFirmId(candidate.firmId)) conflictingFirmIds.push(candidate.firmId);
      return unresolved("conflicting_high_confidence_identifiers", conflictingFirmIds, ["The confirmed source mapping conflicts with another supplied high-confidence identifier."], "high");
    }
    return confirmed(mapping.firmId, "confirmed_source_mapping", mapping.reason);
  }

  if (candidate.firmId) {
    if (!isStableFirmId(candidate.firmId) || !identityById.has(candidate.firmId)) {
      return unresolved("no_high_confidence_match", [], ["The supplied firm ID is invalid or is not present in the governed identity set."]);
    }
    const identity = identityById.get(candidate.firmId)!;
    const candidateDomain = normalizeFirmDomain(candidate.canonicalDomain);
    if (candidateDomain && candidateDomain !== identity.canonicalDomain) {
      const domainCandidates = identities.filter((entry) => entry.canonicalDomain === candidateDomain).map((entry) => entry.firmId);
      return unresolved("conflicting_high_confidence_identifiers", [candidate.firmId, ...domainCandidates], ["The supplied stable firm ID and canonical domain point to different governed identities."], "high");
    }
    return confirmed(candidate.firmId, "stable_firm_id", "The supplied stable firm ID exists in the governed identity set without a conflicting canonical domain.");
  }

  const candidateDomain = normalizeFirmDomain(candidate.canonicalDomain);
  if (candidateDomain) {
    const domainMatches = identities.filter((identity) => identity.canonicalDomain === candidateDomain);
    if (domainMatches.length === 1) {
      return confirmed(domainMatches[0].firmId, "unique_canonical_domain", "The normalized canonical domain matches exactly one governed firm identity.");
    }
    if (domainMatches.length > 1) {
      return unresolved("ambiguous_canonical_domain", domainMatches.map((identity) => identity.firmId), ["The canonical domain is attached to multiple governed identities."], "high");
    }
  }

  const nameMatches = identities
    .filter((identity) => normalizedFirmName(identity.canonicalName) === normalizedFirmName(candidate.firmName))
    .map((identity) => identity.firmId);
  if (nameMatches.length) {
    return unresolved("name_only_candidate", nameMatches, ["A normalized name match is diagnostic only and cannot authorize a legacy merge."], "low");
  }
  return unresolved("no_high_confidence_match", [], ["No governed stable ID, confirmed source mapping, or unique canonical-domain match was found."]);
}
