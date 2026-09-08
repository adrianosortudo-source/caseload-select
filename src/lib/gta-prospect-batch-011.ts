import {
  reconcileProspectCandidateAgainstBaseline,
  type ProspectBaselineRecord,
  type ProspectBaselineReviewRecord,
} from "@/lib/gta-prospect-baseline-reconciliation";

export const GTA_PROSPECT_BATCH_011_SCHEMA_VERSION = "2.0" as const;
export const GTA_PROSPECT_BATCH_011_COUNT_QUALIFIERS = ["exact", "at_least", "unknown"] as const;
export type GtaProspectBatch011CountQualifier = (typeof GTA_PROSPECT_BATCH_011_COUNT_QUALIFIERS)[number];

export type GtaProspectBatch011Record = Readonly<{
  record_id: string;
  firm_name: string;
  canonical_domain: string;
  office_cities: readonly string[];
  observed_lawyer_count: number | null;
  count_qualifier: GtaProspectBatch011CountQualifier;
  stage: "source_observed" | "source_queue" | "held";
  accepted: false;
  import_ready: false;
  reconciliation: Readonly<{
    state: string;
    baseline_review: Readonly<{
      state: "pending_operator_baseline" | "review_required" | "clear";
      automatic_merge: false;
      guard: "gta-prospect-baseline-reconciliation";
      matches: readonly unknown[];
    }>;
    provenance: readonly string[];
  }>;
  access: Readonly<{
    state: "reviewed_first_party" | "queued_no_access_review" | "prior_first_party_source" | "held_access_review";
    scope: "public_first_party_read_only";
  }>;
  evidence: readonly Readonly<{ kind: "roster" | "office" | "leadership"; url: string; note?: string }>[];
  public_contact_provenance: Readonly<{
    status: "not_collected";
    rationale: string;
  }>;
}>;

export type GtaProspectBatch011Document = Readonly<{
  schema_version: typeof GTA_PROSPECT_BATCH_011_SCHEMA_VERSION;
  batch_id: "gta-prospect-batch-011";
  lane: "toronto-core" | "west-north";
  records: readonly GtaProspectBatch011Record[];
}>;

export function isResearchCountInTargetBand(record: Pick<GtaProspectBatch011Record, "observed_lawyer_count" | "count_qualifier">): boolean {
  return record.count_qualifier !== "unknown"
    && record.observed_lawyer_count !== null
    && record.observed_lawyer_count >= 3
    && record.observed_lawyer_count <= 20;
}

/**
 * Reuses the complete baseline guard for later reconciliation. A match remains
 * a review signal; callers cannot turn it into an automatic survivor choice.
 */
export function reconcileBatch011RecordWithBaseline(
  record: GtaProspectBatch011Record,
  baseline: readonly ProspectBaselineRecord[],
): ProspectBaselineReviewRecord {
  return reconcileProspectCandidateAgainstBaseline({
    candidateId: record.record_id,
    firmName: record.firm_name,
    canonicalDomain: record.canonical_domain,
    city: record.office_cities[0],
  }, baseline);
}

export function validateGtaProspectBatch011Document(document: GtaProspectBatch011Document): void {
  if (document.schema_version !== GTA_PROSPECT_BATCH_011_SCHEMA_VERSION) throw new Error("Unexpected batch 011 schema version.");
  const ids = new Set<string>();
  const domains = new Set<string>();
  for (const record of document.records) {
    if (!record.record_id || ids.has(record.record_id)) throw new Error(`Duplicate or missing record id: ${record.record_id}`);
    ids.add(record.record_id);
    if (!record.canonical_domain || !record.office_cities.length) throw new Error(`Record lacks required identity evidence: ${record.record_id}`);
    if (!GTA_PROSPECT_BATCH_011_COUNT_QUALIFIERS.includes(record.count_qualifier)) throw new Error(`Invalid count qualifier: ${record.record_id}`);
    if (record.count_qualifier === "unknown" && record.observed_lawyer_count !== null) throw new Error(`Unknown count must be null: ${record.record_id}`);
    if (record.accepted !== false || record.import_ready !== false) throw new Error(`Research records cannot be accepted or import-ready: ${record.record_id}`);
    if (record.reconciliation.baseline_review.automatic_merge !== false) throw new Error(`Automatic merge is prohibited: ${record.record_id}`);
    if (record.public_contact_provenance.status !== "not_collected") throw new Error(`Contact data is out of scope: ${record.record_id}`);
    if (!record.evidence.some((evidence) => evidence.kind === "roster") || !record.evidence.some((evidence) => evidence.kind === "office")) {
      throw new Error(`Roster and office evidence are both required: ${record.record_id}`);
    }
    if (domains.has(record.canonical_domain) && record.reconciliation.state !== "held_cross_lane_duplicate") {
      throw new Error(`Unclassified duplicate domain: ${record.canonical_domain}`);
    }
    domains.add(record.canonical_domain);
  }
}
