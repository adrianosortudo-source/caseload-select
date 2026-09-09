import {
  reconcileProspectCandidateAgainstBaseline,
  type ProspectBaselineMatch,
  type ProspectBaselineRecord,
} from "@/lib/gta-prospect-baseline-reconciliation";
import { normalizeFirmDomain } from "@/lib/firm-identity-reconciliation";
import type { GtaProspectIdentitySnapshot } from "@/lib/gta-prospect-identity-snapshot";

export const GTA_PROSPECT_LIVE_BASELINE_REPORT_SCHEMA = "gta-prospect-live-baseline-reconciliation.v1" as const;

type Candidate = Readonly<{ id: string; firmName: string; canonicalDomain: string; addresses: readonly Readonly<{ street: string; city?: string }>[] }>;
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
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.length || !value.every((entry) => typeof entry === "string" && entry.trim())) throw new Error(`Batch 012 ${field} is invalid.`);
  return value;
}

function westStreetAddresses(record: Record<string, unknown>): Candidate["addresses"] {
  const office = object(record.office, "Batch 012 west/north office is invalid.");
  const cities = strings(office.cities, "office cities");
  const published = text(office.published_address, "published address");
  return cities.flatMap((city) => {
    const cityEscaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const labelled = new RegExp(`(?:^|;\\s*)${cityEscaped}:\\s*(.+?)(?=;|$)`, "i").exec(published)?.[1] ?? published;
    const street = labelled.replace(new RegExp(`,\\s*${cityEscaped}\\s*,\\s*ON\\b.*$`, "i"), "").trim();
    return street === labelled && cities.length > 1 ? [] : [{ street, city }];
  });
}

function eastStreetAddresses(record: Record<string, unknown>): Candidate["addresses"] {
  if (!Array.isArray(record.office_address_evidence)) throw new Error("Batch 012 east/outer address evidence is invalid.");
  return record.office_address_evidence.map((entry) => {
    const address = object(entry, "Batch 012 east/outer address is invalid.");
    return { street: text(address.street_address, "street address"), city: text(address.city, "address city") };
  });
}

export function parseGtaProspectBatch012Document(value: unknown): readonly Candidate[] {
  const root = object(value, "Batch 012 document is missing or invalid.");
  if (root.batch_id !== "gta-prospect-batch-012" || !Array.isArray(root.records)) throw new Error("Unexpected Batch 012 document schema.");
  const west = root.schema_version === "1.1" && root.lane === "west-north";
  const east = root.schema_version === "1.0" && root.lane === "EAST_OUTER";
  if (!west && !east) throw new Error("Unsupported Batch 012 lane schema.");
  return root.records.map((entry) => {
    const record = object(entry, "Batch 012 record is invalid.");
    if (record.accepted !== false || record.import_ready !== false) throw new Error("Batch 012 research record is unexpectedly accepted or import-ready.");
    const domain = text(record.canonical_domain, "canonical domain");
    if (normalizeFirmDomain(domain) !== domain) throw new Error("Batch 012 canonical domain is not normalized.");
    return {
      id: text(record.record_id, "record id"),
      firmName: text(record.firm_name, "firm name"),
      canonicalDomain: domain,
      addresses: west ? westStreetAddresses(record) : eastStreetAddresses(record),
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
    origin: "ledger_projection", recordId: record.record_id, firmName: record.normalized_firm_name, canonicalDomain: record.canonical_domain,
  }));
  const candidates = documents.flatMap(parseGtaProspectBatch012Document);
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) throw new Error("Duplicate Batch 012 candidate ids.");
  const baseline = [...staticBaseline, ...liveBaseline];
  const reviews = candidates.map((candidate) => {
    const inputs = candidate.addresses.length ? candidate.addresses : [{ street: "", city: undefined }];
    const matches = mergeMatches(inputs.map((address) => reconcileProspectCandidateAgainstBaseline({
      candidateId: candidate.id, firmName: candidate.firmName, canonicalDomain: candidate.canonicalDomain,
      streetAddress: address.street || null, city: address.city ?? null,
    }, baseline).matches));
    return { candidate_id: candidate.id, state: matches.length ? "review_required" as const : "clear" as const, automatic_merge: false as const, matches };
  });
  return {
    schema_version: GTA_PROSPECT_LIVE_BASELINE_REPORT_SCHEMA,
    batch_id: "gta-prospect-batch-012",
    snapshot: { generated_at: snapshot.generated_at, generated_on: snapshot.generated_on, record_count: snapshot.record_count, records_sha256: snapshot.records_sha256 },
    candidate_count: candidates.length,
    reviews,
  };
}
