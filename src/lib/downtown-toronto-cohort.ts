/**
 * Evidence rules for the Downtown Toronto (1–10 lawyer) prospect cohort.
 *
 * Geography is deliberately tied to the City of Toronto Downtown Plan
 * (Secondary Plan 41). A city name or postal-code prefix is only discovery
 * evidence, never proof that an office belongs in this cohort.
 */
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";

export const DOWNTOWN_TORONTO_BOUNDARY_ID = "toronto-official-plan-secondary-plan-41" as const;
export const DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL =
  "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial11/MapServer/44";

export type DowntownGeographyStatus = "inside" | "outside" | "needs_manual_review";

export interface DowntownTorontoBoundaryObservation {
  boundaryId: typeof DOWNTOWN_TORONTO_BOUNDARY_ID;
  status: DowntownGeographyStatus;
  normalizedAddress: string;
  latitude: number | null;
  longitude: number | null;
  coordinateSourceUrl: string | null;
  boundarySourceUrl: string;
  boundaryGeometrySha256: string;
  observedOn: string;
  confidence: "high" | "moderate" | "unknown";
  note: string | null;
}

export type DowntownCohortDisposition =
  | "eligible_for_research"
  | "outside_geography"
  | "outside_size"
  | "needs_geography_review"
  | "needs_exact_roster";

/**
 * A firm can be researched as part of this cohort only with a confirmed
 * Downtown Plan location and an exact published roster of 1 through 10
 * practising lawyers. This intentionally excludes "at least N" counts: they
 * are useful discovery evidence but cannot prove the upper limit.
 */
export function downtownCohortDisposition(
  record: Pick<ReconciledGtaProspect, "observedLawyerCount" | "observedLawyerCountQualifier">,
  geography: Pick<DowntownTorontoBoundaryObservation, "status"> | null,
): DowntownCohortDisposition {
  if (!geography || geography.status === "needs_manual_review") return "needs_geography_review";
  if (geography.status === "outside") return "outside_geography";
  if (record.observedLawyerCountQualifier !== "exact" || record.observedLawyerCount === null) return "needs_exact_roster";
  if (record.observedLawyerCount < 1 || record.observedLawyerCount > 10) return "outside_size";
  return "eligible_for_research";
}

export function isDowntownTorontoCohortEligible(
  record: Pick<ReconciledGtaProspect, "observedLawyerCount" | "observedLawyerCountQualifier">,
  geography: Pick<DowntownTorontoBoundaryObservation, "status"> | null,
): boolean {
  return downtownCohortDisposition(record, geography) === "eligible_for_research";
}
