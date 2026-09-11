/**
 * The source-controlled record contract for the GTA firm expansion.
 *
 * This layer deliberately holds firm-level public research separately from
 * agency CRM contacts and from the historical LSO address clusters. A record
 * is ready to display once its roster evidence and reconciliation status have
 * been reviewed; it is not an authorization for outreach or CRM import.
 */

import {
  normalizedCityKey,
  normalizedPracticeAreaKey,
} from "@/lib/prospect-display-normalization";

export const LAWYER_COUNT_BANDS = ["1", "2", "3", "4-5", "6-10", "11-20", "21-50", "51+", "unknown"] as const;
export type LawyerCountBand = (typeof LAWYER_COUNT_BANDS)[number];
export type LawyerCountRange = { min: number; max: number | null };

export type ReconciliationStatus = "provisional_new" | "update_existing" | "new_pending_identity" | "duplicate" | "unresolved";
export type EvidenceAvailability = "observed" | "none" | "unknown";
export type ProspectRecordOrigin = "research_ledger" | "reviewed_fixture" | "shared_registry" | "legacy_provenance";
export type OwnerContactFilter = "identified" | "direct_owner_email" | "needs_direct_email";

/**
 * Operator-only display data from the separate owner-contact ledger.
 *
 * This is deliberately a read-model addition. It is not accepted by the
 * source-controlled firm-research importer, which remains limited to public
 * firm evidence and cannot ingest a contact by accident.
 */
export interface ProspectOwnerContactPresentation {
  ownerName: string;
  ownerRole: "sole_proprietor" | "owner" | "founding_partner" | "managing_partner" | "other_partner";
  ownershipConfidence: "confirmed_owner" | "leadership_only";
  emailAvailability: "direct_owner_email" | "firm_general_email" | "unavailable";
  emailAddress: string | null;
}
export type PublicProspectContact = Readonly<{
  name: string | null;
  relationship: "owner" | "founder" | "principal" | "named_lawyer" | "firm_inbox";
  email: string | null;
  emailKind: "owner" | "named_person" | "general_firm";
  sourceUrl: string | null;
  observedAt: string;
}>;

export interface ReconciledGtaProspect {
  /** Stable source-controlled identifier, not a database id. */
  id: string;
  /** Presentational provenance assigned by the read adapter; not an identity claim. */
  recordOrigin?: ProspectRecordOrigin;
  /** Stable shared firm identity when this record has been linked to the governed registry. */
  firmId?: string | null;
  /** Normalized host used for deterministic cross-source reconciliation. */
  canonicalDomain?: string | null;
  firmName: string;
  /** Display label for the recorded office location or locations. */
  city: string;
  /** Individual office cities used by the city filter. */
  officeCities: readonly string[];
  websiteUrl: string | null;
  practiceAreas: readonly string[];

  /** The count published on the reviewed firm roster, not an LSO cluster count. */
  observedLawyerCount: number | null;
  observedLawyerCountQualifier: "exact" | "at_least" | "unknown";
  /** Preserves a roster-specific label such as "3 core + counsel". */
  observedLawyerCountDisplay: string | null;
  rosterSourceUrl: string | null;
  rosterCheckedAt: string;

  /** Result of matching against the legacy 5,902-row directory corpus. */
  reconciliationStatus: ReconciliationStatus;
  legacyClusterLawyerCount: number | null;
  /** A reviewed legacy-match description; never a guessed legacy row id. */
  legacyCrosswalk: string | null;
  reconciliationNote: string | null;

  advertisingEvidence: EvidenceAvailability;
  advertisingSourceUrl: string | null;
  gbpEvidence: EvidenceAvailability;
  gbpSourceUrl: string | null;
  /** Publicly displayed contact observations. These are never an outreach authorization. */
  publicContacts?: readonly PublicProspectContact[];

  /**
   * Private, operator-gated owner-contact summary. This is attached only by
   * the reconciled read route after its session check, never by import data.
   */
  ownerContact?: ProspectOwnerContactPresentation | null;

  /** Evidence-backed qualification detail for enriched firm-expansion records. */
  qualifiedDossier?: import("@/lib/qualified-gta-prospects").QualifiedProspectDossier;
}

export interface ReconciledProspectFilters {
  query?: string;
  city?: string;
  lawyerCountBand?: LawyerCountBand | "";
  lawyerCountRange?: LawyerCountRange | null;
  practiceArea?: string;
  advertising?: EvidenceAvailability | "";
  gbp?: EvidenceAvailability | "";
  hasOwner?: boolean | "";
  hasPublicEmail?: boolean | "";
  qualification?: import("@/lib/qualified-gta-prospects").QualificationState | "";
  audit?: import("@/lib/qualified-gta-prospects").AuditState | "";
  advertisingActivity?: import("@/lib/qualified-gta-prospects").AdvertisingActivityState | "";
  advertisingSourceType?: string;
  gbpOpportunityType?: string;
  websiteOpportunityType?: string;
  intakeChannel?: string;
  lawyerCountConfidence?: import("@/lib/qualified-gta-prospects").QualifiedProspectConfidence | "";
  evidenceFreshness?: import("@/lib/qualified-gta-prospects").EvidenceFreshness | "";
  cohortId?: string;
  ownerContact?: OwnerContactFilter | "";
  referenceDate?: Date;
}

export function lawyerCountBand(count: number | null): LawyerCountBand {
  if (count === null || !Number.isFinite(count) || count < 1) return "unknown";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count === 3) return "3";
  if (count <= 5) return "4-5";
  if (count <= 10) return "6-10";
  if (count <= 20) return "11-20";
  if (count <= 50) return "21-50";
  return "51+";
}

export function lawyerCountBandLabel(band: LawyerCountBand): string {
  const labels: Record<LawyerCountBand, string> = {
    "1": "1 lawyer",
    "2": "2 lawyers",
    "3": "3 lawyers",
    "4-5": "4–5 lawyers",
    "6-10": "6–10 lawyers",
    "11-20": "11–20 lawyers",
    "21-50": "21–50 lawyers",
    "51+": "51+ lawyers",
    unknown: "Count unknown",
  };
  return labels[band];
}

export function lawyerCountRangeForBand(band: LawyerCountBand): LawyerCountRange | null {
  const ranges: Record<LawyerCountBand, LawyerCountRange | null> = {
    "1": { min: 1, max: 1 }, "2": { min: 2, max: 2 }, "3": { min: 3, max: 3 },
    "4-5": { min: 4, max: 5 }, "6-10": { min: 6, max: 10 }, "11-20": { min: 11, max: 20 },
    "21-50": { min: 21, max: 50 }, "51+": { min: 51, max: null }, unknown: null,
  };
  return ranges[band];
}

/**
 * A lower-bound roster observation can meet an open-ended minimum. It cannot
 * prove membership in a capped range, so it stays out of those results.
 */
export function matchesObservedLawyerCount(
  record: Pick<ReconciledGtaProspect, "observedLawyerCount" | "observedLawyerCountQualifier">,
  range: LawyerCountRange,
): boolean {
  const count = record.observedLawyerCount;
  if (count === null || record.observedLawyerCountQualifier === "unknown") return false;
  if (record.observedLawyerCountQualifier === "at_least") return range.max === null && count >= range.min;
  return count >= range.min && (range.max === null || count <= range.max);
}

export function observedLawyerCountLabel(record: Pick<ReconciledGtaProspect, "observedLawyerCount" | "observedLawyerCountQualifier" | "observedLawyerCountDisplay">): string {
  if (record.observedLawyerCountDisplay) return record.observedLawyerCountDisplay;
  if (record.observedLawyerCount === null || record.observedLawyerCountQualifier === "unknown") return "Count unknown";
  const noun = record.observedLawyerCount === 1 ? "lawyer" : "lawyers";
  return record.observedLawyerCountQualifier === "at_least"
    ? `At least ${record.observedLawyerCount} ${noun}`
    : `${record.observedLawyerCount} ${noun}`;
}

export function filterReconciledGtaProspects(
  records: readonly ReconciledGtaProspect[],
  filters: ReconciledProspectFilters,
): ReconciledGtaProspect[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  const city = filters.city ? normalizedCityKey(filters.city) : "";
  const practiceArea = filters.practiceArea ? normalizedPracticeAreaKey(filters.practiceArea) : "";

  return records.filter((record) => {
    if (query) {
      const searchable = [record.firmName, record.city, ...record.officeCities, record.websiteUrl ?? "", ...record.practiceAreas,
        ...(record.publicContacts ?? []).flatMap((contact) => [contact.name ?? "", contact.email ?? ""])]
        .join(" ")
        .toLocaleLowerCase();
      if (!searchable.includes(query)) return false;
    }
    if (city && !record.officeCities.some((officeCity) => normalizedCityKey(officeCity) === city)) return false;
    if (filters.lawyerCountBand && lawyerCountBand(record.observedLawyerCount) !== filters.lawyerCountBand) return false;
    if (filters.lawyerCountRange && !matchesObservedLawyerCount(record, filters.lawyerCountRange)) return false;
    if (practiceArea && !record.practiceAreas.some((area) => normalizedPracticeAreaKey(area) === practiceArea)) return false;
    if (filters.advertising && record.advertisingEvidence !== filters.advertising) return false;
    if (filters.gbp && record.gbpEvidence !== filters.gbp) return false;
    if (filters.ownerContact === "identified" && !record.ownerContact) return false;
    if (filters.ownerContact === "direct_owner_email" && record.ownerContact?.emailAvailability !== "direct_owner_email") return false;
    if (filters.ownerContact === "needs_direct_email" && record.ownerContact?.emailAvailability === "direct_owner_email") return false;
    if (filters.hasOwner !== "" && filters.hasOwner !== undefined && Boolean(record.publicContacts?.some((contact) => contact.relationship === "owner" || contact.relationship === "founder")) !== filters.hasOwner) return false;
    if (filters.hasPublicEmail !== "" && filters.hasPublicEmail !== undefined && Boolean(record.publicContacts?.some((contact) => contact.email)) !== filters.hasPublicEmail) return false;
    if (filters.qualification || filters.audit || filters.advertisingActivity || filters.advertisingSourceType || filters.gbpOpportunityType
      || filters.websiteOpportunityType || filters.intakeChannel || filters.lawyerCountConfidence
      || filters.evidenceFreshness || filters.cohortId) {
      const dossier = record.qualifiedDossier;
      if (filters.qualification === "qualified" && !dossier) return false;
      if (filters.qualification === "needs_evidence" && dossier) return false;
      if (filters.audit === "ready" && dossier?.audit.state !== "ready") return false;
      if (filters.audit === "not_ready" && dossier?.audit.state === "ready") return false;
      if (filters.advertisingActivity && dossier?.advertisingActivity.state !== filters.advertisingActivity) return false;
      if (filters.advertisingSourceType && !dossier?.advertisingActivity.sourceTypes.includes(filters.advertisingSourceType)) return false;
      if (filters.gbpOpportunityType && dossier?.gbpOpportunity.type !== filters.gbpOpportunityType) return false;
      if (filters.websiteOpportunityType && !dossier?.websiteAndIntake.opportunityTypes.includes(filters.websiteOpportunityType)) return false;
      if (filters.intakeChannel && !dossier?.websiteAndIntake.observedChannels.includes(filters.intakeChannel)) return false;
      if (filters.lawyerCountConfidence && dossier?.lawyerCount.confidence !== filters.lawyerCountConfidence) return false;
      if (filters.cohortId && dossier?.qualification.cohortId !== filters.cohortId) return false;
      if (filters.evidenceFreshness) {
        // Loaded lazily in the module graph through the dossier field contract.
        const observed = dossier?.audit.observedOn ?? record.rosterCheckedAt;
        const observedDate = new Date(`${observed.slice(0, 10)}T00:00:00Z`);
        const referenceDate = filters.referenceDate ?? new Date();
        const ageDays = Number.isNaN(observedDate.getTime())
          ? null
          : Math.max(0, Math.floor((referenceDate.getTime() - observedDate.getTime()) / 86_400_000));
        const freshness = ageDays === null ? "unknown" : ageDays <= 30 ? "last_30_days" : ageDays <= 180 ? "31_to_180_days" : "older_than_180_days";
        if (freshness !== filters.evidenceFreshness) return false;
      }
    }
    return true;
  });
}
