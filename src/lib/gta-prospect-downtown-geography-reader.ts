import "server-only";

import {
  DOWNTOWN_COORDINATE_SOURCE_TYPES,
  DOWNTOWN_GEOGRAPHY_CONFIDENCES,
  type DowntownCoordinateSourceType,
  type DowntownGeographyConfidence,
} from "@/lib/gta-prospect-downtown-geography-import";
import {
  DOWNTOWN_TORONTO_BOUNDARY_ID,
  DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL,
  type DowntownGeographyStatus,
} from "@/lib/downtown-toronto-cohort";

const RPC_NAME = "list_gta_prospect_downtown_geography_for_operator";
const statuses = new Set<DowntownGeographyStatus>(["inside", "outside", "needs_manual_review"]);
const coordinateSourceTypes = new Set<DowntownCoordinateSourceType>(DOWNTOWN_COORDINATE_SOURCE_TYPES);
const confidences = new Set<DowntownGeographyConfidence>(DOWNTOWN_GEOGRAPHY_CONFIDENCES);
const sourceRecordKey = /^[a-z0-9][a-z0-9-]{1,159}$/;
const sha256 = /^[a-f0-9]{64}$/;

type RpcError = { code?: string; message?: string; details?: string | null; hint?: string | null };
export type GtaProspectDowntownGeographyReaderClient = {
  rpc: (functionName: string) => Promise<{ data: unknown; error: RpcError | null }>;
};

export type GtaProspectDowntownGeographySummary = {
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

export class GtaProspectDowntownGeographyLedgerUnavailableError extends Error {
  constructor() {
    super("The GTA prospect Downtown geography read projection is not available yet.");
    this.name = "GtaProspectDowntownGeographyLedgerUnavailableError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function projectionError(message: string): Error {
  return new Error(`Invalid GTA prospect Downtown geography projection: ${message}`);
}

function parseRecord(value: unknown): GtaProspectDowntownGeographySummary {
  if (!isObject(value)) throw projectionError("row is not an object");
  const expectedKeys = [
    "source_record_key", "boundary_id", "geography_status", "normalized_address", "latitude", "longitude",
    "coordinate_source_type", "coordinate_source_url", "boundary_source_url", "boundary_geometry_sha256",
    "observed_on", "confidence", "note",
  ];
  const unexpected = Object.keys(value).filter((key) => !expectedKeys.includes(key));
  if (unexpected.length > 0) throw projectionError(`unexpected column(s): ${unexpected.join(", ")}`);
  if (typeof value.source_record_key !== "string" || !sourceRecordKey.test(value.source_record_key)) throw projectionError("source_record_key is invalid");
  if (value.boundary_id !== DOWNTOWN_TORONTO_BOUNDARY_ID) throw projectionError("boundary_id is invalid");
  if (typeof value.geography_status !== "string" || !statuses.has(value.geography_status as DowntownGeographyStatus)) throw projectionError("geography_status is invalid");
  if (typeof value.normalized_address !== "string" || value.normalized_address.trim() === "" || value.normalized_address.length > 500) throw projectionError("normalized_address is invalid");
  if (value.boundary_source_url !== DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL || !isHttpUrl(value.boundary_source_url)) throw projectionError("boundary_source_url is invalid");
  if (typeof value.boundary_geometry_sha256 !== "string" || !sha256.test(value.boundary_geometry_sha256)) throw projectionError("boundary_geometry_sha256 is invalid");
  if (!isIsoDate(value.observed_on)) throw projectionError("observed_on is invalid");
  if (typeof value.confidence !== "string" || !confidences.has(value.confidence as DowntownGeographyConfidence)) throw projectionError("confidence is invalid");
  if (value.note !== null && (typeof value.note !== "string" || value.note.length > 1000)) throw projectionError("note is invalid");

  const noCoordinates = value.latitude === null && value.longitude === null
    && value.coordinate_source_type === null && value.coordinate_source_url === null;
  const completeCoordinates = isLatitude(value.latitude) && isLongitude(value.longitude)
    && typeof value.coordinate_source_type === "string"
    && coordinateSourceTypes.has(value.coordinate_source_type as DowntownCoordinateSourceType)
    && isHttpUrl(value.coordinate_source_url);
  if (!noCoordinates && !completeCoordinates) throw projectionError("coordinates are incomplete or invalid");
  if ((value.geography_status === "inside" || value.geography_status === "outside") && !completeCoordinates) {
    throw projectionError("inside or outside geography has no evidence-bearing coordinates");
  }

  return {
    sourceRecordKey: value.source_record_key,
    boundaryId: DOWNTOWN_TORONTO_BOUNDARY_ID,
    status: value.geography_status as DowntownGeographyStatus,
    normalizedAddress: value.normalized_address,
    latitude: value.latitude as number | null,
    longitude: value.longitude as number | null,
    coordinateSourceType: value.coordinate_source_type as DowntownCoordinateSourceType | null,
    coordinateSourceUrl: value.coordinate_source_url as string | null,
    boundarySourceUrl: DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL,
    boundaryGeometrySha256: value.boundary_geometry_sha256,
    observedOn: value.observed_on,
    confidence: value.confidence as DowntownGeographyConfidence,
    note: value.note,
  };
}

function isMissingProjectionRpc(error: RpcError): boolean {
  const text = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  return error.code === "PGRST202"
    || error.code === "42883"
    || text.includes(`function public.${RPC_NAME} does not exist`)
    || text.includes(`could not find the function public.${RPC_NAME}`);
}

export async function listGtaProspectDowntownGeographyForOperator(
  client?: GtaProspectDowntownGeographyReaderClient,
): Promise<readonly GtaProspectDowntownGeographySummary[]> {
  const reader = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectDowntownGeographyReaderClient;
  })();
  const { data, error } = await reader.rpc(RPC_NAME);
  if (error) {
    if (isMissingProjectionRpc(error)) throw new GtaProspectDowntownGeographyLedgerUnavailableError();
    throw new Error(`Could not read GTA prospect Downtown geography research: ${error.message ?? "unknown database error"}`);
  }
  if (!Array.isArray(data)) throw projectionError("RPC did not return an array");
  const records = data.map(parseRecord);
  if (new Set(records.map((record) => record.sourceRecordKey)).size !== records.length) throw projectionError("duplicate source record keys");
  return records;
}
