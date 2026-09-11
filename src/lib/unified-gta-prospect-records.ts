/**
 * Read adapter for the unified prospect workspace.
 *
 * Legacy rows remain source records, not firm identities. This adapter makes
 * them searchable beside governed firm records without promoting the legacy
 * cluster count or candidate domain into current firm evidence.
 */
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import { legacyGtaSourceRecords } from "@/lib/legacy-gta-prospect-source";

// Only the legacy classifier's explicit advertising class is carried into the
// observed field. "Likely" and instrumentation-only signals stay unknown
// until a dated source is reviewed.
const legacyAdvertising = new Set(["advertising"]);

function practiceAreas(value: string): readonly string[] {
  if (!value || value === "unknown") return [];
  return value.split(/[|;,]/).map((item) => item.trim()).filter(Boolean);
}

/**
 * Project the immutable legacy source corpus into display records. The source
 * key remains the record ID and every identity remains unresolved until a
 * separately reviewed mapping is registered.
 */
export function legacyGtaDirectoryProspects(): readonly ReconciledGtaProspect[] {
  return legacyGtaSourceRecords().map((source) => ({
    id: source.sourceRecordKey,
    recordOrigin: "legacy_provenance",
    firmId: null,
    canonicalDomain: null,
    firmName: source.candidate.displayName,
    city: source.candidate.city || "Unknown",
    officeCities: source.candidate.city ? [source.candidate.city] : [],
    websiteUrl: source.candidate.websiteUrl,
    practiceAreas: practiceAreas(source.raw.practice_areas || source.raw.main_pa),
    // The legacy figure is an address-cluster observation, never a current
    // firm roster count. It is retained below for provenance only.
    observedLawyerCount: null,
    observedLawyerCountQualifier: "unknown",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: null,
    rosterCheckedAt: source.observations.lsoObservedOn,
    reconciliationStatus: "unresolved",
    legacyClusterLawyerCount: source.candidate.lawyerCount,
    legacyCrosswalk: `Legacy GTA source record ${source.sourceRowNumber}`,
    reconciliationNote: "Legacy address-cluster record retained for research. Firm identity has not been confirmed.",
    advertisingEvidence: legacyAdvertising.has(source.raw.advertising) ? "observed" : "unknown",
    advertisingSourceUrl: null,
    gbpEvidence: source.observations.gbpObservedOn ? "observed" : "unknown",
    gbpSourceUrl: null,
    publicContacts: source.raw.email.trim() ? [{
      name: null,
      relationship: "firm_inbox",
      email: source.raw.email.trim(),
      emailKind: "general_firm",
      sourceUrl: null,
      observedAt: source.observations.lsoObservedOn,
    }] : [],
  }));
}

/** Keep governed/reviewed records before unresolved legacy source rows. */
export function combineUnifiedGtaProspects(
  reviewed: readonly ReconciledGtaProspect[],
  legacy: readonly ReconciledGtaProspect[] = legacyGtaDirectoryProspects(),
): readonly ReconciledGtaProspect[] {
  return [...reviewed, ...legacy].sort((left, right) =>
    left.firmName.localeCompare(right.firmName, "en-CA", { sensitivity: "base" }) || left.id.localeCompare(right.id, "en-CA"),
  );
}
