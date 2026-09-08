import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  GTA_PROSPECT_BATCH_011_SCHEMA_VERSION,
  reconcileBatch011RecordWithBaseline,
  validateGtaProspectBatch011Document,
  type GtaProspectBatch011Document,
  type GtaProspectBatch011Record,
} from "../src/lib/gta-prospect-batch-011";

const TORONTO_SOURCE = "e792cb2b5cad33c487a6cd6761e9a1ae4cafa9fd:docs/research/gta-prospect-batch-011/gta-prospect-batch-011.json";
const WEST_NORTH_SOURCE = "ace4694b41215b7691f3ee35930387545a433a44:docs/research/gta-prospect-batch-011/lanes/west-north.json";
const OUTPUT_ROOT = resolve(process.cwd(), "docs/research/gta-prospect-batch-011");
const CROSS_LANE_DOMAINS = new Set(["blacksutherland.com", "loopstranixon.com", "millerthomson.com", "mccagueborlack.com"]);

type RawRecord = Record<string, unknown>;

function readCommittedJson(source: string): { records: RawRecord[] } {
  return JSON.parse(execFileSync("git", ["show", source], { cwd: process.cwd(), encoding: "utf8" })) as { records: RawRecord[] };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sourceNote(value: unknown): string | undefined {
  const note = asString(value)
    .replace(/\bemails?\b/gi, "source entries")
    .replace(/\b(?:phones?|telephones?|tel)\b/gi, "source details")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]");
  return note || undefined;
}

function sourceStage(record: RawRecord): GtaProspectBatch011Record["stage"] {
  if (record.workflow_status === "held_below_floor" || record.workflow_status === "held_baseline_collision") return "held";
  return record.research_stage === "source_queue" ? "source_queue" : "source_observed";
}

function accessState(record: RawRecord): GtaProspectBatch011Record["access"]["state"] {
  if (record.access_review === "prior_batch_source") return "prior_first_party_source";
  if (sourceStage(record) === "source_queue") return "queued_no_access_review";
  if (record.workflow_status === "held_below_floor") return "held_access_review";
  return "reviewed_first_party";
}

function countQualifier(record: RawRecord): GtaProspectBatch011Record["count_qualifier"] {
  return record.count_qualifier === "exact" || record.count_qualifier === "at_least" ? record.count_qualifier : "unknown";
}

function leadershipEvidence(record: RawRecord): GtaProspectBatch011Record["evidence"] {
  const observations = Array.isArray(record.leadership_evidence) ? record.leadership_evidence : [record.leadership_evidence];
  return observations.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const observation = value as Record<string, unknown>;
    const url = asString(observation.source_url);
    const role = asString(observation.role) || asString(observation.title);
    return url ? [{ kind: "leadership" as const, url, note: sourceNote(role) }] : [];
  });
}

function normalizedRecord(record: RawRecord, lane: GtaProspectBatch011Document["lane"], peerRecords: readonly RawRecord[]): GtaProspectBatch011Record {
  const canonicalDomain = asString(record.canonical_domain);
  const isCrossLaneDuplicate = lane === "west-north" && CROSS_LANE_DOMAINS.has(canonicalDomain);
  const counterpart = peerRecords.find((peer) => asString(peer.canonical_domain) === canonicalDomain);
  const guard = reconcileBatch011RecordWithBaseline({
    record_id: asString(record.record_id), firm_name: asString(record.firm_name), canonical_domain: canonicalDomain,
    office_cities: stringArray(record.office_cities), observed_lawyer_count: null, count_qualifier: "unknown",
    stage: "source_queue", accepted: false, import_ready: false,
    reconciliation: { state: "pending", baseline_review: { state: "pending_operator_baseline", automatic_merge: false, guard: "gta-prospect-baseline-reconciliation", matches: [] }, provenance: [] },
    access: { state: "queued_no_access_review", scope: "public_first_party_read_only" }, evidence: [],
    public_contact_provenance: { status: "not_collected", rationale: "Generator guard invocation only." },
  }, []);
  const qualifier = countQualifier(record);
  const count = qualifier === "unknown" ? null : (typeof record.observed_lawyer_count === "number" ? record.observed_lawyer_count : null);
  return {
    record_id: asString(record.record_id), firm_name: asString(record.firm_name), canonical_domain: canonicalDomain,
    office_cities: stringArray(record.office_cities), observed_lawyer_count: count, count_qualifier: qualifier,
    stage: sourceStage(record), accepted: false, import_ready: false,
    reconciliation: {
      state: isCrossLaneDuplicate ? "held_cross_lane_duplicate" : (asString(record.reconciliation).includes("collision") ? "held_baseline_collision" : "pending_operator_baseline"),
      baseline_review: { state: "pending_operator_baseline", automatic_merge: guard.automaticMerge, guard: "gta-prospect-baseline-reconciliation", matches: [] },
      provenance: [
        `source_record=${asString(record.record_id)}`,
        `source_commit=${lane === "toronto-core" ? TORONTO_SOURCE.split(":")[0] : WEST_NORTH_SOURCE.split(":")[0]}`,
        ...(counterpart ? [`cross_lane_counterpart=${asString(counterpart.record_id)}`] : []),
        ...(asString(record.reconciliation) ? [`source_reconciliation=${asString(record.reconciliation)}`] : []),
      ],
    },
    access: { state: accessState(record), scope: "public_first_party_read_only" },
    evidence: [
      { kind: "roster", url: asString(record.first_party_roster_url), note: sourceNote(record.count_scope) },
      { kind: "office", url: asString(record.office_source_url), note: sourceNote(record.evidence_note) },
      ...leadershipEvidence(record),
    ],
    public_contact_provenance: {
      status: "not_collected",
      rationale: "Public contact details were intentionally excluded; this research artifact keeps only source provenance.",
    },
  };
}

function writeJson(path: string, value: unknown): void {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== rendered) throw new Error(`Generated artifact is stale: ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rendered, "utf8");
}

const torontoSource = readCommittedJson(TORONTO_SOURCE);
const westNorthSource = readCommittedJson(WEST_NORTH_SOURCE);
const toronto: GtaProspectBatch011Document = {
  schema_version: GTA_PROSPECT_BATCH_011_SCHEMA_VERSION, batch_id: "gta-prospect-batch-011", lane: "toronto-core",
  records: torontoSource.records.map((record) => normalizedRecord(record, "toronto-core", westNorthSource.records)),
};
const westNorth: GtaProspectBatch011Document = {
  schema_version: GTA_PROSPECT_BATCH_011_SCHEMA_VERSION, batch_id: "gta-prospect-batch-011", lane: "west-north",
  records: westNorthSource.records.map((record) => normalizedRecord(record, "west-north", torontoSource.records)),
};
validateGtaProspectBatch011Document(toronto);
validateGtaProspectBatch011Document(westNorth);
writeJson(resolve(OUTPUT_ROOT, "lanes/toronto-core.json"), toronto);
writeJson(resolve(OUTPUT_ROOT, "lanes/west-north.json"), westNorth);
writeJson(resolve(OUTPUT_ROOT, "gta-prospect-batch-011.json"), {
  schema_version: GTA_PROSPECT_BATCH_011_SCHEMA_VERSION, batch_id: "gta-prospect-batch-011", stage: "research_only",
  accepted: false, import_ready: false, source_commits: [TORONTO_SOURCE.split(":")[0], WEST_NORTH_SOURCE.split(":")[0]],
  lane_files: ["lanes/toronto-core.json", "lanes/west-north.json"], raw_record_count: 100, distinct_canonical_domains: 96,
  cross_lane_duplicate_domains: [...CROSS_LANE_DOMAINS].sort(),
});
