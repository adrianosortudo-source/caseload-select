import { createHash } from "node:crypto";

import {
  reconcileProspectCandidateAgainstBaseline,
  type ProspectBaselineMatch,
  type ProspectBaselineRecord,
} from "@/lib/gta-prospect-baseline-reconciliation";
import { normalizeFirmDomain } from "@/lib/firm-identity-reconciliation";
import {
  GTA_PROSPECT_SAFE_SLUG_PATTERN,
  type GtaProspectIdentitySnapshot,
} from "@/lib/gta-prospect-identity-snapshot";

export const GTA_PROSPECT_LIVE_BASELINE_REPORT_SCHEMA = "gta-prospect-live-baseline-reconciliation.v1" as const;

type Candidate = Readonly<{ id: string; firmName: string; canonicalDomain: string; addresses: readonly Readonly<{ street: string; city?: string }>[] }>;
const BATCH_012_RECORD_ID_PATTERN = /^B012-(?:WN|EAST)-(?:H)?(?:0[1-9]|[1-9][0-9])$/;
export type GtaProspectLiveBaselineReport = Readonly<{
  schema_version: typeof GTA_PROSPECT_LIVE_BASELINE_REPORT_SCHEMA;
  batch_id: "gta-prospect-batch-012";
  snapshot: Readonly<{ generated_at: string; generated_on: string; record_count: number; records_sha256: string }>;
  candidate_count: number;
  reviews: readonly Readonly<{ candidate_id: string; state: "clear" | "review_required"; automatic_merge: false; matches: readonly ProspectBaselineMatch[] }>[];
}>;

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Batch 012 ${field} is invalid.`);
  return value;
}
function safeReportId(value: string): string {
  if (GTA_PROSPECT_SAFE_SLUG_PATTERN.test(value)) return value;
  const hash = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
  const base = value.normalize("NFKD").toLocaleLowerCase("en-CA")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 146) || "record";
  const slug = `${base}-${hash}`;
  if (!GTA_PROSPECT_SAFE_SLUG_PATTERN.test(slug)) throw new Error("Could not derive a safe baseline report id.");
  return slug;
}

function officeStreetAddresses(record: Record<string, unknown>, lane: "west/north" | "east/outer"): Candidate["addresses"] {
  if (!Array.isArray(record.office_addresses)) throw new Error(`Batch 012 ${lane} address evidence is invalid.`);
  return record.office_addresses.map((entry) => {
    const address = object(entry, `Batch 012 ${lane} address is invalid.`);
    const city = text(address.city, "address city");
    const published = text(address.published_address, "published address");
    const cityEscaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const street = published.replace(new RegExp(`,\\s*${cityEscaped}\\s*,\\s*ON\\b.*$`, "i"), "").trim();
    if (!street || street === published) throw new Error(`Batch 012 ${lane} published address is malformed.`);
    return { street, city };
  });
}

export function parseGtaProspectBatch012Document(value: unknown): readonly Candidate[] {
  const root = object(value, "Batch 012 document is missing or invalid.");
  if (root.batch_id !== "gta-prospect-batch-012" || !Array.isArray(root.records)) throw new Error("Unexpected Batch 012 document schema.");
  const west = root.schema_version === "2.0" && root.lane === "west-north";
  const east = root.schema_version === "2.0" && root.lane === "east-outer";
  if (!west && !east) throw new Error("Unsupported Batch 012 lane schema.");
  return root.records.map((entry) => {
    const record = object(entry, "Batch 012 record is invalid.");
    if (record.accepted !== false || record.import_ready !== false) throw new Error("Batch 012 research record is unexpectedly accepted or import-ready.");
    const domain = text(record.canonical_domain, "canonical domain");
    if (normalizeFirmDomain(domain) !== domain) throw new Error("Batch 012 canonical domain is not normalized.");
    const id = text(record.record_id, "record id");
    if (!BATCH_012_RECORD_ID_PATTERN.test(id)) throw new Error("Batch 012 record id does not match the bounded grammar.");
    return {
      id,
      firmName: text(record.firm_name, "firm name"),
      canonicalDomain: domain,
      addresses: officeStreetAddresses(record, west ? "west/north" : "east/outer"),
    };
  });
}

function mergeMatches(groups: readonly (readonly ProspectBaselineMatch[])[]): readonly ProspectBaselineMatch[] {
  const merged = new Map<string, { origin: ProspectBaselineMatch["origin"]; recordId: string; fields: Set<ProspectBaselineMatch["fields"][number]> }>();
  for (const match of groups.flat()) {
    const key = `${match.origin}:${match.recordId}`;
    const current = merged.get(key) ?? { origin: match.origin, recordId: match.recordId, fields: new Set() };
    match.fields.forEach((field) => current.fields.add(field));
    merged.set(key, current);
  }
  return [...merged.values()].map((match) => ({ origin: match.origin, recordId: match.recordId, fields: [...match.fields].sort() }))
    .sort((left, right) => left.origin.localeCompare(right.origin, "en-CA") || left.recordId.localeCompare(right.recordId, "en-CA"));
}

export function reconcileGtaProspectBatch012(
  snapshot: GtaProspectIdentitySnapshot,
  documents: readonly unknown[],
  staticBaseline: readonly ProspectBaselineRecord[],
): GtaProspectLiveBaselineReport {
  const liveBaseline: ProspectBaselineRecord[] = snapshot.records.map((record) => ({
    origin: "ledger_projection", recordId: safeReportId(record.record_id), firmName: record.normalized_firm_name, canonicalDomain: record.canonical_domain,
  }));
  const candidates = documents.flatMap(parseGtaProspectBatch012Document);
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) throw new Error("Duplicate Batch 012 candidate ids.");
  const baseline = [...staticBaseline, ...liveBaseline].map((record) => ({ ...record, recordId: safeReportId(record.recordId) }));
  const reviews = candidates.map((candidate) => {
    const inputs = candidate.addresses.length ? candidate.addresses : [{ street: "", city: undefined }];
    const matches = mergeMatches(inputs.map((address) => reconcileProspectCandidateAgainstBaseline({
      candidateId: candidate.id, firmName: candidate.firmName, canonicalDomain: candidate.canonicalDomain,
      streetAddress: address.street || null, city: address.city ?? null,
    }, baseline).matches));
    const candidateId = safeReportId(candidate.id.toLocaleLowerCase("en-CA"));
    if (!matches.every((match) => GTA_PROSPECT_SAFE_SLUG_PATTERN.test(match.recordId))) {
      throw new Error("Unsafe baseline id reached the report boundary.");
    }
    return { candidate_id: candidateId, state: matches.length ? "review_required" as const : "clear" as const, automatic_merge: false as const, matches };
  });
  return {
    schema_version: GTA_PROSPECT_LIVE_BASELINE_REPORT_SCHEMA,
    batch_id: "gta-prospect-batch-012",
    snapshot: { generated_at: snapshot.generated_at, generated_on: snapshot.generated_on, record_count: snapshot.record_count, records_sha256: snapshot.records_sha256 },
    candidate_count: candidates.length,
    reviews,
  };
}
