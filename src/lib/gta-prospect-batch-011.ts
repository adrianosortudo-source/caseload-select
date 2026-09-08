import {
  reconcileProspectCandidateAgainstBaseline,
  type ProspectBaselineRecord,
  type ProspectBaselineReviewRecord,
} from "@/lib/gta-prospect-baseline-reconciliation";

export const GTA_PROSPECT_BATCH_011_SCHEMA_VERSION = "2.1" as const;
export const GTA_PROSPECT_BATCH_011_COUNT_QUALIFIERS = ["exact", "at_least", "unknown"] as const;
export type GtaProspectBatch011CountQualifier = (typeof GTA_PROSPECT_BATCH_011_COUNT_QUALIFIERS)[number];
export type GtaProspectBatch011BaselineMatch = Readonly<{ origin: string; record_id: string; fields: readonly string[] }>;

export type GtaProspectBatch011Record = Readonly<{
  record_id: string;
  firm_name: string;
  canonical_domain: string;
  office_cities: readonly string[];
  observed_on: string;
  observed_lawyer_count: number | null;
  count_qualifier: GtaProspectBatch011CountQualifier;
  roster_evidence_state: "present" | "missing_first_party_source";
  stage: "source_observed" | "source_queue" | "held";
  accepted: false;
  import_ready: false;
  reconciliation: Readonly<{
    state: string;
    baseline_review: Readonly<{
      state: "pending_live_ledger" | "review_required" | "clear";
      automatic_merge: false;
      guard: "gta-prospect-baseline-reconciliation";
      loaded_sources: readonly ("fixture" | "import_fixture" | "legacy_source")[];
      live_ledger_state: "offline_pending";
      matches: readonly GtaProspectBatch011BaselineMatch[];
    }>;
    provenance: readonly string[];
  }>;
  access: Readonly<{
    state: "reviewed_first_party" | "queued_no_access_review" | "prior_first_party_source" | "held_access_review";
    scope: "public_first_party_read_only";
  }>;
  evidence: readonly Readonly<{ kind: "roster" | "office" | "leadership"; url: string; observed_on: string; note?: string }>[];
  public_contact_provenance: Readonly<{ status: "not_collected"; rationale: string }>;
}>;

export type GtaProspectBatch011Document = Readonly<{
  schema_version: typeof GTA_PROSPECT_BATCH_011_SCHEMA_VERSION;
  batch_id: "gta-prospect-batch-011";
  lane: "toronto-core" | "west-north";
  records: readonly GtaProspectBatch011Record[];
}>;

export type GtaProspectBatch011RootSummary = Readonly<{
  raw_record_count: number;
  distinct_canonical_domains: number;
  cross_lane_duplicate_domains: readonly string[];
}>;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

export function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** A capped 3–20 band requires a bounded, exact roster count. */
export function isResearchCountInTargetBand(record: Pick<GtaProspectBatch011Record, "observed_lawyer_count" | "count_qualifier">): boolean {
  return record.count_qualifier === "exact"
    && record.observed_lawyer_count !== null
    && record.observed_lawyer_count >= 3
    && record.observed_lawyer_count <= 20;
}

export function reconcileBatch011RecordWithBaseline(
  record: Pick<GtaProspectBatch011Record, "record_id" | "firm_name" | "canonical_domain" | "office_cities">,
  baseline: readonly ProspectBaselineRecord[],
): ProspectBaselineReviewRecord {
  return reconcileProspectCandidateAgainstBaseline({
    candidateId: record.record_id,
    firmName: record.firm_name,
    canonicalDomain: record.canonical_domain,
    city: record.office_cities[0],
  }, baseline);
}

export function deriveGtaProspectBatch011RootSummary(documents: readonly GtaProspectBatch011Document[]): GtaProspectBatch011RootSummary {
  const records = documents.flatMap((document) => document.records);
  const byDomain = new Map<string, GtaProspectBatch011Record[]>();
  for (const record of records) byDomain.set(record.canonical_domain, [...(byDomain.get(record.canonical_domain) ?? []), record]);
  return Object.freeze({
    raw_record_count: records.length,
    distinct_canonical_domains: byDomain.size,
    cross_lane_duplicate_domains: [...byDomain.entries()]
      .filter(([, matchingRecords]) => matchingRecords.length > 1)
      .map(([domain]) => domain)
      .sort(),
  });
}

export function validateGtaProspectBatch011Document(document: GtaProspectBatch011Document): void {
  if (document.schema_version !== GTA_PROSPECT_BATCH_011_SCHEMA_VERSION) throw new Error("Unexpected batch 011 schema version.");
  const ids = new Set<string>();
  const domains = new Set<string>();
  for (const record of document.records) {
    if (!record.record_id || ids.has(record.record_id)) throw new Error(`Duplicate or missing record id: ${record.record_id}`);
    ids.add(record.record_id);
    if (!record.canonical_domain || !record.office_cities.length || !isIsoDate(record.observed_on)) throw new Error(`Record lacks required identity or observation evidence: ${record.record_id}`);
    if (!GTA_PROSPECT_BATCH_011_COUNT_QUALIFIERS.includes(record.count_qualifier)) throw new Error(`Invalid count qualifier: ${record.record_id}`);
    if (record.count_qualifier === "unknown" && record.observed_lawyer_count !== null) throw new Error(`Unknown count must be null: ${record.record_id}`);
    if (record.accepted !== false || record.import_ready !== false) throw new Error(`Research records cannot be accepted or import-ready: ${record.record_id}`);
    if (record.reconciliation.baseline_review.automatic_merge !== false || record.reconciliation.baseline_review.live_ledger_state !== "offline_pending") throw new Error(`Baseline reconciliation gate is invalid: ${record.record_id}`);
    if (record.public_contact_provenance.status !== "not_collected") throw new Error(`Contact data is out of scope: ${record.record_id}`);
    const rosterEvidence = record.evidence.filter((evidence) => evidence.kind === "roster");
    const officeEvidence = record.evidence.filter((evidence) => evidence.kind === "office");
    if (!officeEvidence.length) throw new Error(`Office evidence is required: ${record.record_id}`);
    if (record.roster_evidence_state === "present" && !rosterEvidence.length) throw new Error(`Roster evidence is required: ${record.record_id}`);
    if (record.roster_evidence_state === "missing_first_party_source") {
      if (record.stage !== "held" || record.reconciliation.state !== "held_missing_first_party_roster" || rosterEvidence.length) throw new Error(`Missing roster source must be explicitly held: ${record.record_id}`);
    }
    for (const evidence of record.evidence) {
      if (!isValidHttpsUrl(evidence.url) || !isIsoDate(evidence.observed_on)) throw new Error(`Evidence URL or observation date is invalid: ${record.record_id}`);
    }
    if (domains.has(record.canonical_domain) && record.reconciliation.state !== "held_cross_lane_duplicate") throw new Error(`Unclassified duplicate domain: ${record.canonical_domain}`);
    domains.add(record.canonical_domain);
  }
}

export function validateGtaProspectBatch011Root(documents: readonly GtaProspectBatch011Document[], summary: GtaProspectBatch011RootSummary): void {
  documents.forEach(validateGtaProspectBatch011Document);
  const ids = documents.flatMap((document) => document.records.map((record) => record.record_id));
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate record ids across batch 011 lanes.");
  const derived = deriveGtaProspectBatch011RootSummary(documents);
  if (JSON.stringify(derived) !== JSON.stringify(summary)) throw new Error("Batch 011 root totals are not derived from lane records.");
}
