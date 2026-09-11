import {
  DOWNTOWN_TORONTO_BOUNDARY_ID,
  DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL,
  type DowntownGeographyStatus,
} from "@/lib/downtown-toronto-cohort";

export const DOWNTOWN_COORDINATE_SOURCE_TYPES = [
  "toronto_one_address_repository",
  "reviewed_geocoder",
  "reviewed_firm_website",
  "manual_review",
] as const;
export type DowntownCoordinateSourceType = (typeof DOWNTOWN_COORDINATE_SOURCE_TYPES)[number];

export const DOWNTOWN_GEOGRAPHY_CONFIDENCES = ["high", "moderate", "unknown"] as const;
export type DowntownGeographyConfidence = (typeof DOWNTOWN_GEOGRAPHY_CONFIDENCES)[number];

export type DowntownGeographyCanonicalRecord = {
  sourceRecordKey: string;
  boundaryId: typeof DOWNTOWN_TORONTO_BOUNDARY_ID;
  status: DowntownGeographyStatus;
  normalizedAddress: string;
  latitude: number | null;
  longitude: number | null;
  coordinateSourceType: DowntownCoordinateSourceType | null;
  coordinateSourceUrl: string | null;
  boundarySourceUrl: typeof DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL;
  boundaryGeometrySha256: string;
  observedOn: string;
  confidence: DowntownGeographyConfidence;
  note: string | null;
};

export type DowntownGeographyValidationIssue = { sourceRecordKey: string; message: string };
export type GtaProspectDowntownGeographyImportPlan = {
  accepted: DowntownGeographyCanonicalRecord[];
  rejected: { sourceRecordKey: string; issues: DowntownGeographyValidationIssue[] }[];
};

const inputKeys = new Set([
  "sourceRecordKey", "boundaryId", "status", "normalizedAddress", "latitude", "longitude",
  "coordinateSourceType", "coordinateSourceUrl", "boundarySourceUrl", "boundaryGeometrySha256",
  "observedOn", "confidence", "note",
]);
const stableKey = /^[a-z0-9][a-z0-9-]{1,159}$/;
const sha256 = /^[a-f0-9]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value: unknown): value is string {
  if (!isText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function project(input: unknown): {
  sourceRecordKey: string;
  record: DowntownGeographyCanonicalRecord | null;
  issues: DowntownGeographyValidationIssue[];
} {
  const sourceRecordKey = isObject(input) && typeof input.sourceRecordKey === "string"
    ? input.sourceRecordKey
    : "<missing-source-record-key>";
  const issues: DowntownGeographyValidationIssue[] = [];
  const fail = (message: string) => issues.push({ sourceRecordKey, message });
  if (!isObject(input)) {
    fail("record must be an object");
    return { sourceRecordKey, record: null, issues };
  }

  const unexpected = Object.keys(input).filter((key) => !inputKeys.has(key));
  if (unexpected.length > 0) fail(`unrecognized fields are forbidden: ${unexpected.join(", ")}`);
  if (!isText(input.sourceRecordKey) || !stableKey.test(input.sourceRecordKey)) fail("sourceRecordKey must be a stable lowercase source key");
  if (input.boundaryId !== DOWNTOWN_TORONTO_BOUNDARY_ID) fail("boundaryId must be the Toronto Downtown Plan (Secondary Plan 41)");
  if (input.status !== "inside" && input.status !== "outside" && input.status !== "needs_manual_review") fail("status is invalid");
  if (!isText(input.normalizedAddress) || input.normalizedAddress.trim().length > 500) fail("normalizedAddress is required and must be at most 500 characters");
  if (input.boundarySourceUrl !== DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL) fail("boundarySourceUrl must be the authoritative Downtown Plan source");
  if (typeof input.boundaryGeometrySha256 !== "string" || !sha256.test(input.boundaryGeometrySha256)) fail("boundaryGeometrySha256 must be a lowercase SHA-256 digest");
  if (!isIsoDate(input.observedOn)) fail("observedOn must be an ISO date");
  if (!DOWNTOWN_GEOGRAPHY_CONFIDENCES.includes(input.confidence as DowntownGeographyConfidence)) fail("confidence is invalid");
  if (input.note !== null && (typeof input.note !== "string" || input.note.length > 1000)) fail("note must be null or at most 1000 characters");

  const noCoordinates = input.latitude === null && input.longitude === null
    && input.coordinateSourceType === null && input.coordinateSourceUrl === null;
  const completeCoordinates = isLatitude(input.latitude) && isLongitude(input.longitude)
    && DOWNTOWN_COORDINATE_SOURCE_TYPES.includes(input.coordinateSourceType as DowntownCoordinateSourceType)
    && isHttpUrl(input.coordinateSourceUrl);
  if (!noCoordinates && !completeCoordinates) fail("coordinates require latitude, longitude, coordinate source type, and coordinate source URL together");
  if ((input.status === "inside" || input.status === "outside") && !completeCoordinates) {
    fail("inside or outside status requires evidence-bearing coordinates");
  }

  if (issues.length > 0) return { sourceRecordKey, record: null, issues };
  return {
    sourceRecordKey,
    issues,
    record: {
      sourceRecordKey: input.sourceRecordKey as string,
      boundaryId: DOWNTOWN_TORONTO_BOUNDARY_ID,
      status: input.status as DowntownGeographyStatus,
      normalizedAddress: (input.normalizedAddress as string).trim(),
      latitude: input.latitude as number | null,
      longitude: input.longitude as number | null,
      coordinateSourceType: input.coordinateSourceType as DowntownCoordinateSourceType | null,
      coordinateSourceUrl: input.coordinateSourceUrl as string | null,
      boundarySourceUrl: DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL,
      boundaryGeometrySha256: input.boundaryGeometrySha256 as string,
      observedOn: input.observedOn as string,
      confidence: input.confidence as DowntownGeographyConfidence,
      note: input.note as string | null,
    },
  };
}

/**
 * Validates the separate, private geography-evidence payload. It neither
 * writes to a database nor alters the core GTA research import contract.
 */
export function buildGtaProspectDowntownGeographyImportPlan(
  inputs: readonly unknown[],
): GtaProspectDowntownGeographyImportPlan {
  const accepted: DowntownGeographyCanonicalRecord[] = [];
  const rejected: GtaProspectDowntownGeographyImportPlan["rejected"] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const result = project(input);
    if (seen.has(result.sourceRecordKey)) {
      result.issues.push({ sourceRecordKey: result.sourceRecordKey, message: "duplicate source record key within batch" });
    }
    seen.add(result.sourceRecordKey);
    if (result.record && result.issues.length === 0) accepted.push(result.record);
    else rejected.push({ sourceRecordKey: result.sourceRecordKey, issues: result.issues });
  }
  return { accepted, rejected };
}
