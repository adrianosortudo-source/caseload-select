import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { RECONCILED_GTA_PROSPECTS } from "../src/app/admin/prospects/reconciled-prospects";
import {
  buildOperatorProspectBaseline,
  type ProspectBaselineRecord,
} from "../src/lib/gta-prospect-baseline-reconciliation";
import {
  GTA_PROSPECT_BATCH_011_SCHEMA_VERSION,
  deriveGtaProspectBatch011RootSummary,
  reconcileBatch011RecordWithBaseline,
  validateGtaProspectBatch011Root,
  type GtaProspectBatch011Document,
  type GtaProspectBatch011Record,
} from "../src/lib/gta-prospect-batch-011";
import type { ReconciledGtaProspect } from "../src/lib/gta-prospect-records";
import { legacyGtaSourceRecords } from "../src/lib/legacy-gta-prospect-source";

const TORONTO_SOURCE = "e792cb2b5cad33c487a6cd6761e9a1ae4cafa9fd:docs/research/gta-prospect-batch-011/gta-prospect-batch-011.json";
const WEST_NORTH_SOURCE = "ace4694b41215b7691f3ee35930387545a433a44:docs/research/gta-prospect-batch-011/lanes/west-north.json";
const OFFLINE_IMPORT_FIXTURE = "docs/prospecting/import-manifests/gta-prospect-research-accepted-001-009.dry-run.json";
const OUTPUT_ROOT = resolve(process.cwd(), "docs/research/gta-prospect-batch-011");
const CROSS_LANE_DOMAINS = new Set(["blacksutherland.com", "loopstranixon.com", "millerthomson.com", "mccagueborlack.com"]);

type RawRecord = Record<string, unknown>;

function readCommittedJson(source: string): { records: RawRecord[] } {
  return JSON.parse(execFileSync("git", ["show", source], { cwd: process.cwd(), encoding: "utf8" })) as { records: RawRecord[] };
}

function asString(value: unknown): string { return typeof value === "string" ? value : ""; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function isIsoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function domainFromUrl(value: string): string | null {
  try { return new URL(value).hostname.toLocaleLowerCase().replace(/^www\./, "") || null; } catch { return null; }
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
function leadershipEvidence(record: RawRecord, observedOn: string): GtaProspectBatch011Record["evidence"] {
  const observations = Array.isArray(record.leadership_evidence) ? record.leadership_evidence : [record.leadership_evidence];
  return observations.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const observation = value as Record<string, unknown>;
    const url = asString(observation.source_url);
    const role = asString(observation.role) || asString(observation.title);
    return url ? [{ kind: "leadership" as const, url, observed_on: observedOn, note: sourceNote(role) }] : [];
  });
}

function offlineImportFixtureRecords(): readonly ReconciledGtaProspect[] {
  const payload = JSON.parse(readFileSync(resolve(process.cwd(), OFFLINE_IMPORT_FIXTURE), "utf8")) as { importRecords?: unknown };
  if (!Array.isArray(payload.importRecords)) throw new Error("Offline import fixture has no importRecords array.");
  return payload.importRecords.flatMap((value): ReconciledGtaProspect[] => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const roster = record.roster as Record<string, unknown> | undefined;
    const sourceUrl = asString(roster?.sourceUrl);
    const observedOn = asString(roster?.observedOn);
    const qualifier = roster?.qualifier;
    const count = roster?.lawyerCount;
    const id = asString(record.sourceRecordKey);
    const firmName = asString(record.firmName);
    const city = asString(record.city);
    if (!id || !firmName || !city || !sourceUrl || !isIsoDate(observedOn) || !Number.isInteger(count)
      || (qualifier !== "exact" && qualifier !== "at_least" && qualifier !== "unknown")) return [];
    return [{
      id: `offline-import:${id}`, recordOrigin: "shared_registry", canonicalDomain: domainFromUrl(asString(record.websiteUrl)) ?? domainFromUrl(sourceUrl),
      firmName, city, officeCities: stringArray(record.officeCities), websiteUrl: asString(record.websiteUrl) || null,
      practiceAreas: stringArray(record.practiceAreas), observedLawyerCount: count as number, observedLawyerCountQualifier: qualifier,
      observedLawyerCountDisplay: asString(roster?.display) || null, rosterSourceUrl: sourceUrl, rosterCheckedAt: observedOn,
      reconciliationStatus: "provisional_new", legacyClusterLawyerCount: null, legacyCrosswalk: null, reconciliationNote: "Offline import fixture; no live-ledger read was attempted.",
      advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null,
    }];
  });
}

const offlineImportRecords = offlineImportFixtureRecords();
const staticBaseline: readonly ProspectBaselineRecord[] = buildOperatorProspectBaseline({
  fixtures: RECONCILED_GTA_PROSPECTS,
  ledgerProjection: offlineImportRecords,
  legacySource: legacyGtaSourceRecords(),
});

function normalizedRecord(record: RawRecord, lane: GtaProspectBatch011Document["lane"], peerRecords: readonly RawRecord[]): GtaProspectBatch011Record {
  const canonicalDomain = asString(record.canonical_domain);
  const observedOn = asString(record.observation_date);
  if (!isIsoDate(observedOn)) throw new Error(`Source record has no ISO observation date: ${asString(record.record_id)}`);
  const rawRosterUrl = asString(record.first_party_roster_url);
  const missingRoster = !rawRosterUrl;
  const isCrossLaneDuplicate = lane === "west-north" && CROSS_LANE_DOMAINS.has(canonicalDomain);
  const counterpart = peerRecords.find((peer) => asString(peer.canonical_domain) === canonicalDomain);
  const identity = { record_id: asString(record.record_id), firm_name: asString(record.firm_name), canonical_domain: canonicalDomain, office_cities: stringArray(record.office_cities) };
  const review = reconcileBatch011RecordWithBaseline(identity, staticBaseline);
  const qualifier = countQualifier(record);
  const count = qualifier === "unknown" ? null : (typeof record.observed_lawyer_count === "number" ? record.observed_lawyer_count : null);
  const baselineState = review.matches.length ? "review_required" : "clear";
  return {
    ...identity, observed_on: observedOn, observed_lawyer_count: count, count_qualifier: qualifier,
    roster_evidence_state: missingRoster ? "missing_first_party_source" : "present",
    stage: missingRoster ? "held" : sourceStage(record), accepted: false, import_ready: false,
    reconciliation: {
      state: missingRoster ? "held_missing_first_party_roster" : isCrossLaneDuplicate ? "held_cross_lane_duplicate" : (asString(record.reconciliation).includes("collision") ? "held_baseline_collision" : "pending_operator_baseline"),
      baseline_review: {
        state: baselineState, automatic_merge: review.automaticMerge, guard: "gta-prospect-baseline-reconciliation",
        loaded_sources: ["fixture", "import_fixture", "legacy_source"], live_ledger_state: "offline_pending",
        matches: review.matches.map((match) => ({ origin: match.origin, record_id: match.recordId, fields: match.fields })),
      },
      provenance: [
        `source_record=${identity.record_id}`,
        `source_commit=${lane === "toronto-core" ? TORONTO_SOURCE.split(":")[0] : WEST_NORTH_SOURCE.split(":")[0]}`,
        `static_baseline_records=${staticBaseline.length}`,
        `live_ledger=offline_pending`,
        ...(counterpart ? [`cross_lane_counterpart=${asString(counterpart.record_id)}`] : []),
        ...(asString(record.reconciliation) ? [`source_reconciliation=${asString(record.reconciliation)}`] : []),
      ],
    },
    access: { state: missingRoster ? "held_access_review" : accessState(record), scope: "public_first_party_read_only" },
    evidence: [
      ...(rawRosterUrl ? [{ kind: "roster" as const, url: rawRosterUrl, observed_on: observedOn, note: sourceNote(record.count_scope) }] : []),
      { kind: "office" as const, url: asString(record.office_source_url), observed_on: observedOn, note: sourceNote(record.evidence_note) },
      ...leadershipEvidence(record, observedOn),
    ],
    public_contact_provenance: { status: "not_collected", rationale: "Public contact details were intentionally excluded; this research artifact keeps only source provenance." },
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
const toronto: GtaProspectBatch011Document = { schema_version: GTA_PROSPECT_BATCH_011_SCHEMA_VERSION, batch_id: "gta-prospect-batch-011", lane: "toronto-core", records: torontoSource.records.map((record) => normalizedRecord(record, "toronto-core", westNorthSource.records)) };
const westNorth: GtaProspectBatch011Document = { schema_version: GTA_PROSPECT_BATCH_011_SCHEMA_VERSION, batch_id: "gta-prospect-batch-011", lane: "west-north", records: westNorthSource.records.map((record) => normalizedRecord(record, "west-north", torontoSource.records)) };
const documents = [toronto, westNorth] as const;
const summary = deriveGtaProspectBatch011RootSummary(documents);
validateGtaProspectBatch011Root(documents, summary);
writeJson(resolve(OUTPUT_ROOT, "lanes/toronto-core.json"), toronto);
writeJson(resolve(OUTPUT_ROOT, "lanes/west-north.json"), westNorth);
writeJson(resolve(OUTPUT_ROOT, "gta-prospect-batch-011.json"), {
  schema_version: GTA_PROSPECT_BATCH_011_SCHEMA_VERSION, batch_id: "gta-prospect-batch-011", stage: "research_only", accepted: false, import_ready: false,
  source_commits: [TORONTO_SOURCE.split(":")[0], WEST_NORTH_SOURCE.split(":")[0]], lane_files: ["lanes/toronto-core.json", "lanes/west-north.json"],
  ...summary,
  baseline_sources: { fixture_records: RECONCILED_GTA_PROSPECTS.length, offline_import_fixture_records: offlineImportRecords.length, legacy_source_records: legacyGtaSourceRecords().length, live_ledger_state: "offline_pending" },
});
