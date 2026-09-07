/**
 * The source-controlled record contract for the GTA firm expansion.
 *
 * This layer deliberately holds firm-level public research separately from
 * agency CRM contacts and from the historical LSO address clusters. A record
 * is ready to display once its roster evidence and reconciliation status have
 * been reviewed; it is not an authorization for outreach or CRM import.
 */

export const LAWYER_COUNT_BANDS = ["1", "2", "3-5", "6-10", "11+", "unknown"] as const;
export type LawyerCountBand = (typeof LAWYER_COUNT_BANDS)[number];

export type ReconciliationStatus = "provisional_new" | "update_existing" | "new_pending_identity" | "duplicate" | "unresolved";
export type EvidenceAvailability = "observed" | "none" | "unknown";

export interface ReconciledGtaProspect {
  /** Stable source-controlled identifier, not a database id. */
  id: string;
  firmName: string;
  city: string;
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
  reconciliationNote: string | null;

  advertisingEvidence: EvidenceAvailability;
  advertisingSourceUrl: string | null;
  gbpEvidence: EvidenceAvailability;
  gbpSourceUrl: string | null;
}

export interface ReconciledProspectFilters {
  query?: string;
  city?: string;
  lawyerCountBand?: LawyerCountBand | "";
  practiceArea?: string;
  advertising?: EvidenceAvailability | "";
  gbp?: EvidenceAvailability | "";
}

export function lawyerCountBand(count: number | null): LawyerCountBand {
  if (count === null || !Number.isFinite(count) || count < 1) return "unknown";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count <= 5) return "3-5";
  if (count <= 10) return "6-10";
  return "11+";
}

export function lawyerCountBandLabel(band: LawyerCountBand): string {
  const labels: Record<LawyerCountBand, string> = {
    "1": "1 lawyer",
    "2": "2 lawyers",
    "3-5": "3–5 lawyers",
    "6-10": "6–10 lawyers",
    "11+": "11+ lawyers",
    unknown: "Count unknown",
  };
  return labels[band];
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
  const city = filters.city?.trim().toLocaleLowerCase() ?? "";
  const practiceArea = filters.practiceArea?.trim().toLocaleLowerCase() ?? "";

  return records.filter((record) => {
    if (query) {
      const searchable = [record.firmName, record.city, record.websiteUrl ?? "", ...record.practiceAreas]
        .join(" ")
        .toLocaleLowerCase();
      if (!searchable.includes(query)) return false;
    }
    if (city && record.city.toLocaleLowerCase() !== city) return false;
    if (filters.lawyerCountBand && lawyerCountBand(record.observedLawyerCount) !== filters.lawyerCountBand) return false;
    if (practiceArea && !record.practiceAreas.some((area) => area.toLocaleLowerCase() === practiceArea)) return false;
    if (filters.advertising && record.advertisingEvidence !== filters.advertising) return false;
    if (filters.gbp && record.gbpEvidence !== filters.gbp) return false;
    return true;
  });
}
