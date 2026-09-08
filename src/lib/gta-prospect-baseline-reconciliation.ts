/**
 * Deterministic, read-only reconciliation against the prospect console's
 * complete baseline. A match is a review signal only: this module neither
 * selects a survivor nor authorizes a merge.
 *
 * The baseline may contain reviewed fixtures, ledger projections, and the
 * legacy LSO address-cluster source. Keeping the source on every match makes
 * a future import manifest explainable without promoting a legacy row into a
 * firm identity.
 */

import { normalizeFirmDomain } from "@/lib/firm-identity-reconciliation";
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import type { LegacyGtaSourceRecord } from "@/lib/legacy-gta-prospect-source";

export const PROSPECT_BASELINE_ORIGINS = ["fixture", "ledger_projection", "legacy_source"] as const;
export type ProspectBaselineOrigin = (typeof PROSPECT_BASELINE_ORIGINS)[number];

export type ProspectBaselineRecord = Readonly<{
  origin: ProspectBaselineOrigin;
  recordId: string;
  firmName: string;
  canonicalDomain?: string | null;
  streetAddress?: string | null;
  city?: string | null;
}>;

export type ProspectBaselineCandidate = Readonly<{
  candidateId: string;
  firmName: string;
  canonicalDomain?: string | null;
  streetAddress?: string | null;
  city?: string | null;
}>;

export type ProspectBaselineMatchField = "canonical_domain" | "firm_name" | "street_address";

export type ProspectBaselineMatch = Readonly<{
  origin: ProspectBaselineOrigin;
  recordId: string;
  fields: readonly ProspectBaselineMatchField[];
}>;

/**
 * A manifest-friendly, explicit result. `automaticMerge` is permanently
 * false: callers must record a separate reviewed source decision before a
 * fixture, ledger, or legacy candidate can be treated as the same firm.
 */
export type ProspectBaselineReviewRecord = Readonly<{
  candidateId: string;
  state: "clear" | "review_required";
  automaticMerge: false;
  matches: readonly ProspectBaselineMatch[];
}>;

const LEGAL_SUFFIX = /(?:\s+(?:llp|l\s+l\s+p|llc|l\s+l\s+c|ltd|limited|inc|pc|p\s+c|professional\s+corporation|law\s+corporation|corporation))+$/;

/** Exact normalized-name comparison only; this is intentionally not fuzzy. */
export function normalizeProspectFirmName(value: string | null | undefined): string | null {
  const compact = value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!compact) return null;
  const withoutSuffix = compact.replace(LEGAL_SUFFIX, "").trim();
  return withoutSuffix || null;
}

function normalizeAddressWords(value: string): string {
  const aliases: Record<string, string> = {
    ave: "avenue", blvd: "boulevard", dr: "drive", e: "east", hwy: "highway",
    n: "north", rd: "road", s: "south", st: "street", w: "west",
  };
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => aliases[word] ?? word)
    .join(" ");
}

/**
 * Normalizes street spellings while retaining the suite/unit as a separate
 * identity component. In particular, `200-342 Queen St W` and
 * `100-342 Queen Street West` remain different values.
 */
export function normalizeProspectStreetAddress(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  let unit: string | null = null;
  let remainder = raw;
  const namedUnit = raw.match(/^\s*(?:suite|unit|ste\.?|#)\s*([a-z0-9]+)\s*[,\-]\s*(.+)$/i);
  const hyphenatedUnit = raw.match(/^\s*([a-z0-9]+)\s*-\s*(\d+[a-z0-9\s.,'-]*)$/i);
  if (namedUnit) {
    unit = namedUnit[1];
    remainder = namedUnit[2];
  } else if (hyphenatedUnit) {
    unit = hyphenatedUnit[1];
    remainder = hyphenatedUnit[2];
  }

  const normalizedRemainder = normalizeAddressWords(remainder);
  if (!normalizedRemainder) return null;
  const normalizedUnit = unit ? normalizeAddressWords(unit) : "";
  return `unit=${normalizedUnit};street=${normalizedRemainder}`;
}

function normalizeCity(value: string | null | undefined): string | null {
  const normalized = normalizeAddressWords(value ?? "");
  return normalized || null;
}

function baselineKey(record: Pick<ProspectBaselineRecord, "origin" | "recordId">): string {
  if (!record.recordId.trim()) throw new Error("Baseline records require a stable recordId.");
  return `${record.origin}:${record.recordId}`;
}

/**
 * Adapts every source the operator console can display into one comparison
 * baseline. `legacySource` is optional only for callers that do not have the
 * preserved artifact available; it must be supplied by batch tooling whenever
 * that source exists locally.
 */
export function buildOperatorProspectBaseline({
  fixtures,
  ledgerProjection,
  legacySource = [],
}: Readonly<{
  fixtures: readonly ReconciledGtaProspect[];
  ledgerProjection: readonly ReconciledGtaProspect[];
  legacySource?: readonly LegacyGtaSourceRecord[];
}>): readonly ProspectBaselineRecord[] {
  const records: ProspectBaselineRecord[] = [
    ...fixtures.map((record) => ({
      origin: "fixture" as const,
      recordId: record.id,
      firmName: record.firmName,
      canonicalDomain: record.canonicalDomain ?? record.websiteUrl,
      city: record.city,
    })),
    ...ledgerProjection.map((record) => ({
      origin: "ledger_projection" as const,
      recordId: record.id,
      firmName: record.firmName,
      canonicalDomain: record.canonicalDomain ?? record.websiteUrl,
      city: record.city,
    })),
    ...legacySource.map((record) => ({
      origin: "legacy_source" as const,
      recordId: record.sourceRecordKey,
      firmName: record.candidate.displayName,
      canonicalDomain: record.candidate.candidateDomain,
      streetAddress: record.candidate.address,
      city: record.candidate.city,
    })),
  ];
  const keys = new Set<string>();
  for (const record of records) {
    const key = baselineKey(record);
    if (keys.has(key)) throw new Error(`Duplicate operator prospect baseline record: ${key}`);
    keys.add(key);
  }
  return Object.freeze(records.map((record) => Object.freeze(record)));
}

/**
 * Produces a review record for every candidate. A matching domain, normalized
 * firm name, or complete address is never an automatic merge instruction.
 */
export function reconcileProspectCandidateAgainstBaseline(
  candidate: ProspectBaselineCandidate,
  baseline: readonly ProspectBaselineRecord[],
): ProspectBaselineReviewRecord {
  if (!candidate.candidateId.trim()) throw new Error("Prospect candidates require a stable candidateId.");
  const candidateName = normalizeProspectFirmName(candidate.firmName);
  const candidateDomain = normalizeFirmDomain(candidate.canonicalDomain);
  const candidateAddress = normalizeProspectStreetAddress(candidate.streetAddress);
  const candidateCity = normalizeCity(candidate.city);

  const matches = baseline.map((record) => {
    baselineKey(record);
    const fields: ProspectBaselineMatchField[] = [];
    const domain = normalizeFirmDomain(record.canonicalDomain);
    const name = normalizeProspectFirmName(record.firmName);
    const address = normalizeProspectStreetAddress(record.streetAddress);
    const city = normalizeCity(record.city);
    if (candidateDomain && domain === candidateDomain) fields.push("canonical_domain");
    if (candidateName && name === candidateName) fields.push("firm_name");
    if (candidateAddress && address === candidateAddress && (!candidateCity || !city || candidateCity === city)) {
      fields.push("street_address");
    }
    return fields.length === 0 ? null : { origin: record.origin, recordId: record.recordId, fields };
  }).filter((match): match is ProspectBaselineMatch => match !== null)
    .sort((left, right) => left.origin.localeCompare(right.origin, "en-CA") || left.recordId.localeCompare(right.recordId, "en-CA"));

  return Object.freeze({
    candidateId: candidate.candidateId,
    state: matches.length ? "review_required" : "clear",
    automaticMerge: false,
    matches: Object.freeze(matches.map((match) => Object.freeze({ ...match, fields: Object.freeze([...match.fields].sort()) }))),
  });
}
