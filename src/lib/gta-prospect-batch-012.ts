import type { ProspectBaselineMatch } from "@/lib/gta-prospect-baseline-reconciliation";

export const GTA_PROSPECT_BATCH_012_SCHEMA_VERSION = "2.0" as const;
export const GTA_PROSPECT_BATCH_012_LANES = ["west-north", "east-outer"] as const;
export const GTA_PROSPECT_BATCH_012_EVIDENCE_KINDS = ["roster", "office", "practice", "relationship", "public_email"] as const;
export type GtaProspectBatch012Lane = (typeof GTA_PROSPECT_BATCH_012_LANES)[number];
export type GtaProspectBatch012CountQualifier = "exact" | "at_least" | "unknown";
export type GtaProspectBatch012EvidenceKind = (typeof GTA_PROSPECT_BATCH_012_EVIDENCE_KINDS)[number];

export type GtaProspectBatch012Source = Readonly<{
  url: string;
  observed_on: string;
}>;

export type GtaProspectBatch012OfficeAddress = GtaProspectBatch012Source & Readonly<{
  city: string;
  published_address: string;
  comparison_street_address: string | null;
}>;

export type GtaProspectBatch012Leadership = GtaProspectBatch012Source & Readonly<{
  name: string;
  published_title: string;
  relationship: "owner" | "founder" | "managing_partner" | "partner" | "other_leadership";
}>;

export type GtaProspectBatch012PublicEmail = GtaProspectBatch012Source & Readonly<{
  email: string;
  label: string;
}>;

export type GtaProspectBatch012Evidence = GtaProspectBatch012Source & Readonly<{
  kind: GtaProspectBatch012EvidenceKind;
  status: "observed" | "unknown";
  value: unknown;
  note: string | null;
}>;

export type GtaProspectBatch012Record = Readonly<{
  record_id: string;
  source: Readonly<{
    lane: GtaProspectBatch012Lane;
    source_commit: string;
    source_record_id: string;
  }>;
  stage: "source_queue" | "held";
  accepted: false;
  import_ready: false;
  firm_name: string;
  identity_aliases: readonly string[];
  canonical_domain: string;
  office_cities: readonly string[];
  office_addresses: readonly GtaProspectBatch012OfficeAddress[];
  observed_lawyer_count: number | null;
  count_qualifier: GtaProspectBatch012CountQualifier;
  roster_scope: string | null;
  practice_areas_published: readonly string[];
  leadership: readonly GtaProspectBatch012Leadership[];
  public_emails: readonly GtaProspectBatch012PublicEmail[];
  observed_on: string;
  access_review: string;
  source_disposition: string;
  hold_reason: string | null;
  evidence: readonly GtaProspectBatch012Evidence[];
  reconciliation: Readonly<{
    state: "clear" | "review_required" | "held_cross_lane_duplicate";
    automatic_merge: false;
    guard: "gta-prospect-baseline-reconciliation";
    loaded_sources: readonly ["fixture", "ledger_projection", "legacy_source"];
    static_baseline_count: 6025;
    live_ledger_state: "offline_pending";
    matches: readonly Readonly<{
      origin: ProspectBaselineMatch["origin"];
      record_id: string;
      fields: ProspectBaselineMatch["fields"];
    }>[];
    cross_lane_counterpart: string | null;
  }>;
}>;

export type GtaProspectBatch012Document = Readonly<{
  schema_version: typeof GTA_PROSPECT_BATCH_012_SCHEMA_VERSION;
  batch_id: "gta-prospect-batch-012";
  lane: GtaProspectBatch012Lane;
  records: readonly GtaProspectBatch012Record[];
}>;

export type GtaProspectBatch012Summary = Readonly<{
  raw_record_count: number;
  distinct_canonical_domains: number;
  source_queue_count: number;
  held_count: number;
  static_clear_count: number;
  static_review_required_count: number;
  cross_lane_duplicate_domains: readonly string[];
  accepted_count: 0;
  import_ready_count: 0;
  automatic_merge_count: 0;
}>;

export function isBatch012IsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

export function isBatch012HttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isBatch012TargetCount(record: Pick<GtaProspectBatch012Record, "observed_lawyer_count" | "count_qualifier">): boolean {
  return record.count_qualifier === "exact"
    && record.observed_lawyer_count !== null
    && record.observed_lawyer_count >= 3
    && record.observed_lawyer_count <= 20;
}

export function deriveGtaProspectBatch012Summary(documents: readonly GtaProspectBatch012Document[]): GtaProspectBatch012Summary {
  const records = documents.flatMap((document) => document.records);
  const byDomain = new Map<string, GtaProspectBatch012Record[]>();
  for (const record of records) {
    byDomain.set(record.canonical_domain, [...(byDomain.get(record.canonical_domain) ?? []), record]);
  }
  return Object.freeze({
    raw_record_count: records.length,
    distinct_canonical_domains: byDomain.size,
    source_queue_count: records.filter((record) => record.stage === "source_queue").length,
    held_count: records.filter((record) => record.stage === "held").length,
    static_clear_count: records.filter((record) => record.reconciliation.state === "clear").length,
    static_review_required_count: records.filter((record) => record.reconciliation.state !== "clear").length,
    cross_lane_duplicate_domains: [...byDomain.entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([domain]) => domain)
      .sort(),
    accepted_count: 0,
    import_ready_count: 0,
    automatic_merge_count: 0,
  });
}

function validateSource(source: GtaProspectBatch012Source, id: string): void {
  if (!isBatch012HttpsUrl(source.url) || !isBatch012IsoDate(source.observed_on)) {
    throw new Error(`Invalid evidence source/date: ${id}`);
  }
}

export function validateGtaProspectBatch012Document(document: GtaProspectBatch012Document): void {
  if (document.schema_version !== GTA_PROSPECT_BATCH_012_SCHEMA_VERSION || document.batch_id !== "gta-prospect-batch-012") {
    throw new Error("Unexpected Batch 012 document identity.");
  }
  if (!GTA_PROSPECT_BATCH_012_LANES.includes(document.lane)) throw new Error("Unexpected Batch 012 lane.");
  const ids = new Set<string>();
  for (const record of document.records) {
    if (!record.record_id || ids.has(record.record_id)) throw new Error(`Duplicate or missing record id: ${record.record_id}`);
    ids.add(record.record_id);
    if (record.source.lane !== document.lane || !/^[0-9a-f]{40}$/.test(record.source.source_commit)) throw new Error(`Invalid source provenance: ${record.record_id}`);
    if (!record.firm_name || !record.canonical_domain || !record.office_cities.length || !isBatch012IsoDate(record.observed_on)) throw new Error(`Missing identity evidence: ${record.record_id}`);
    if (record.accepted !== false || record.import_ready !== false || record.reconciliation.automatic_merge !== false) throw new Error(`Research-only gate crossed: ${record.record_id}`);
    if (record.reconciliation.static_baseline_count !== 6025 || record.reconciliation.live_ledger_state !== "offline_pending") throw new Error(`Invalid baseline gate: ${record.record_id}`);
    if (record.count_qualifier === "unknown" && record.observed_lawyer_count !== null) throw new Error(`Unknown count must be null: ${record.record_id}`);
    if (record.count_qualifier !== "unknown" && (!Number.isInteger(record.observed_lawyer_count) || Number(record.observed_lawyer_count) < 1)) throw new Error(`Observed count is invalid: ${record.record_id}`);
    const kinds = record.evidence.map((item) => item.kind).sort();
    if (JSON.stringify(kinds) !== JSON.stringify([...GTA_PROSPECT_BATCH_012_EVIDENCE_KINDS].sort())) throw new Error(`Canonical evidence set is incomplete: ${record.record_id}`);
    for (const evidence of record.evidence) validateSource(evidence, record.record_id);
    for (const address of record.office_addresses) {
      validateSource(address, record.record_id);
      if (!address.city || !address.published_address) throw new Error(`Invalid office address evidence: ${record.record_id}`);
    }
    for (const leader of record.leadership) {
      validateSource(leader, record.record_id);
      if (!leader.name || !leader.published_title) throw new Error(`Invalid leadership evidence: ${record.record_id}`);
    }
    for (const email of record.public_emails) {
      validateSource(email, record.record_id);
      if (!email.label || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.email)) throw new Error(`Invalid published email evidence: ${record.record_id}`);
    }
    const relationshipEvidence = record.evidence.find((item) => item.kind === "relationship")!;
    const emailEvidence = record.evidence.find((item) => item.kind === "public_email")!;
    if ((record.leadership.length > 0) !== (relationshipEvidence.status === "observed")) throw new Error(`Contradictory leadership evidence: ${record.record_id}`);
    if ((record.public_emails.length > 0) !== (emailEvidence.status === "observed")) throw new Error(`Contradictory public email evidence: ${record.record_id}`);
  }
}

export function validateGtaProspectBatch012Root(documents: readonly GtaProspectBatch012Document[], summary: GtaProspectBatch012Summary): void {
  documents.forEach(validateGtaProspectBatch012Document);
  const ids = documents.flatMap((document) => document.records.map((record) => record.record_id));
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate record ids across Batch 012 lanes.");
  const derived = deriveGtaProspectBatch012Summary(documents);
  if (JSON.stringify(derived) !== JSON.stringify(summary)) throw new Error("Batch 012 root totals are not derived from lane records.");
  const records = documents.flatMap((document) => document.records);
  for (const domain of derived.cross_lane_duplicate_domains) {
    const duplicates = records.filter((record) => record.canonical_domain === domain);
    if (duplicates.filter((record) => record.reconciliation.state === "held_cross_lane_duplicate").length !== duplicates.length - 1) {
      throw new Error(`Cross-lane duplicate has no single canonical source record: ${domain}`);
    }
  }
}
