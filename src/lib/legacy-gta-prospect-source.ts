/**
 * Source-preserving adapter for the historical GTA directory artifact.
 *
 * The artifact is a 5,902-row set of LSO licensee address clusters.  A row is
 * useful research evidence, but it is not a confirmed firm identity: several
 * independent lawyers can share an address and the source did not retain a
 * cluster identifier.  This adapter deliberately emits unresolved source
 * records.  A later reconciliation service may link one to a `firmId`, but
 * must record the reviewed basis for doing so.
 */
import { PROSPECTS_HTML } from "@/app/admin/prospects/prospects-content";

export const LEGACY_GTA_SOURCE_ID = "legacy-gta-directory-2026-07";
export const LEGACY_GTA_LSO_OBSERVED_ON = "2026-07-12";
export const LEGACY_GTA_GBP_OBSERVED_ON = "2026-07-13";

export type LegacyGtaRawField =
  | "business_name"
  | "lawyer_names"
  | "lawyer_count"
  | "phone"
  | "email"
  | "street"
  | "city"
  | "postal_code"
  | "website_url"
  | "website_confidence"
  | "same_business_name"
  | "advertising"
  | "ad_vendors"
  | "main_pa"
  | "practice_areas"
  | "pa_confidence"
  | "outreach_language_tier"
  | "gbp_found"
  | "gbp_reviews_count"
  | "gbp_rating"
  | "gbp_claimed";

export type LegacyGtaRawFields = Readonly<Record<LegacyGtaRawField, string>>;

export interface LegacyGtaSourceRecord {
  /** Deterministic artifact row key. It is provenance, not a firm identifier. */
  sourceRecordKey: string;
  sourceId: typeof LEGACY_GTA_SOURCE_ID;
  sourceRowNumber: number;
  sourceKind: "lso_address_cluster";
  identityStatus: "unresolved";
  firmId: null;
  canonicalDomain: null;
  /** Candidate values are copied from the artifact and may not identify a firm. */
  candidate: Readonly<{
    displayName: string;
    lawyerNames: string;
    lawyerCount: number | null;
    address: string;
    city: string;
    postalCode: string;
    websiteUrl: string | null;
    candidateDomain: string | null;
  }>;
  observations: Readonly<{
    lsoObservedOn: typeof LEGACY_GTA_LSO_OBSERVED_ON;
    gbpObservedOn: typeof LEGACY_GTA_GBP_OBSERVED_ON | null;
  }>;
  raw: LegacyGtaRawFields;
}

export type LegacyGtaArtifactData = {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
};

function candidateDomain(url: string): string | null {
  if (!url.trim()) return null;
  try {
    return new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function parseLawyerCount(value: string): number | null {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

/** Extracts only the JSON payload of the legacy view; no artifact script runs. */
export function extractLegacyGtaArtifactData(html: string): LegacyGtaArtifactData {
  const prefix = "const DATA = ";
  const suffix = ";\n  const COLS = DATA.columns;";
  const start = html.indexOf(prefix);
  const end = start < 0 ? -1 : html.indexOf(suffix, start + prefix.length);
  if (start < 0 || end < 0) throw new Error("Legacy GTA artifact data payload was not found.");

  const parsed: unknown = JSON.parse(html.slice(start + prefix.length, end));
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as LegacyGtaArtifactData).columns) || !Array.isArray((parsed as LegacyGtaArtifactData).rows)) {
    throw new Error("Legacy GTA artifact data payload is invalid.");
  }
  return parsed as LegacyGtaArtifactData;
}

function rawFields(columns: readonly string[], row: readonly string[]): LegacyGtaRawFields {
  const required: LegacyGtaRawField[] = [
    "business_name", "lawyer_names", "lawyer_count", "phone", "email", "street", "city", "postal_code", "website_url",
    "website_confidence", "same_business_name", "advertising", "ad_vendors", "main_pa", "practice_areas", "pa_confidence",
    "outreach_language_tier", "gbp_found", "gbp_reviews_count", "gbp_rating", "gbp_claimed",
  ];
  const index = new Map(columns.map((column, position) => [column, position]));
  const output = {} as Record<LegacyGtaRawField, string>;
  for (const field of required) {
    const position = index.get(field);
    if (position === undefined) throw new Error(`Legacy GTA artifact is missing required column: ${field}`);
    output[field] = row[position] ?? "";
  }
  return Object.freeze(output);
}

export function adaptLegacyGtaRows(data: LegacyGtaArtifactData): readonly LegacyGtaSourceRecord[] {
  return Object.freeze(data.rows.map((row, index) => {
    const raw = rawFields(data.columns, row);
    const websiteUrl = raw.website_url || null;
    return Object.freeze({
      sourceRecordKey: `${LEGACY_GTA_SOURCE_ID}:row-${index + 1}`,
      sourceId: LEGACY_GTA_SOURCE_ID,
      sourceRowNumber: index + 1,
      sourceKind: "lso_address_cluster",
      identityStatus: "unresolved",
      firmId: null,
      canonicalDomain: null,
      candidate: Object.freeze({
        displayName: raw.business_name,
        lawyerNames: raw.lawyer_names,
        lawyerCount: parseLawyerCount(raw.lawyer_count),
        address: raw.street,
        city: raw.city,
        postalCode: raw.postal_code,
        websiteUrl,
        candidateDomain: websiteUrl ? candidateDomain(websiteUrl) : null,
      }),
      observations: Object.freeze({
        lsoObservedOn: LEGACY_GTA_LSO_OBSERVED_ON,
        gbpObservedOn: raw.gbp_found === "yes" ? LEGACY_GTA_GBP_OBSERVED_ON : null,
      }),
      raw,
    });
  }));
}

let cachedRecords: readonly LegacyGtaSourceRecord[] | undefined;

/** The complete legacy corpus, converted without matching or deduplication. */
export function legacyGtaSourceRecords(): readonly LegacyGtaSourceRecord[] {
  cachedRecords ??= adaptLegacyGtaRows(extractLegacyGtaArtifactData(PROSPECTS_HTML));
  return cachedRecords;
}

export function legacyGtaReconciliationSummary(records = legacyGtaSourceRecords()) {
  const withWebsite = records.filter((record) => record.candidate.websiteUrl !== null).length;
  const withGbp = records.filter((record) => record.observations.gbpObservedOn !== null).length;
  return Object.freeze({
    sourceId: LEGACY_GTA_SOURCE_ID,
    sourceRows: records.length,
    unresolvedSourceRecords: records.length,
    confirmedFirmLinks: 0,
    rowsWithCandidateWebsite: withWebsite,
    rowsWithGbpObservation: withGbp,
    limitation: "The source has no stable cluster IDs and represents address clusters, so no row is a confirmed firm until separately reconciled.",
  });
}
