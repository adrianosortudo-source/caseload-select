import { createHash } from "node:crypto";
import { parseProspectEnrichmentEnvelope, type ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import type { CompiledPackage } from "./compiler";
import { selectPilot } from "./reconciliation";
import { canonicalJson, displayCategory, object, protocolHash } from "./model";
import { compileWholeFirmSnapshot, verifyWholeFirmManifest, type WholeFirmSourceManifest } from "./whole-firm";

const HASH = /^[a-f0-9]{64}$/;
const PARTITIONS = ["Identity", "Qualified", "Held", "Rejected", "Incomplete"] as const;
const FROZEN_FIVE_CATEGORIES = ["qualified-source", "held", "rejected", "identity-uncertain", "package-less-schema-held"] as const;
export const FROZEN_FIVE_CASE_FILE_SHA256 = "962810e1ef6180c28fd5d77f0dd325537e834bf23fa861b7090bec0768500def";
type Partition = typeof PARTITIONS[number];
type NormalizedPackage = CompiledPackage;
export type AcceptanceCase = { caseId: string; researchKey: string; partition: Partition; packageIds: string[]; payloadHashes: string[] };
export type AcceptanceGate = { status: "pending"; reason: string[] };
export type FrozenFiveCaseReport = {
  status: "pass" | "fail";
  fileSha256: string;
  sourceIndexSha256: string | null;
  rowCount: number;
  caseCount: number;
  categories: string[];
  errors: string[];
};
export type AcceptanceReport = {
  schemaVersion: "prospect-enrichment-acceptance-report/v1";
  createdAt: string;
  sourceManifestFileSha256: string;
  sourceManifestSha256: string;
  runIds: string[];
  canonicalInput: { status: "pass" | "fail"; errors: string[] };
  frozenFiveCase: FrozenFiveCaseReport;
  sourceAccounting: { expectedRevisionCount: number; accountedRevisionCount: number; packageBackedRevisionCount: number; packageLessRevisionCount: number };
  sourceRevisionDispositionCounts: Record<"Qualified" | "Held" | "Rejected" | "Incomplete", number>;
  packageBackedResearchKeyCount: number;
  pilotPartitionAvailability: Record<Partition, { availableResearchKeyCount: number; exact: boolean; selectedByRuleCount: number }>;
  pilot10: { status: "pass" | "fail" | "pending"; requiredPerPartition: 2; cases: AcceptanceCase[]; errors: string[] };
  liveGates: Record<string, AcceptanceGate>;
  acceptanceStatus: "offline_fail" | "offline_pilot_pending_live_pending" | "offline_evidence_validated_live_pending";
  syncStatus: "not_verified";
  synced: false;
};

const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sortedUnique = (values: string[]) => [...new Set(values)].sort(ordinal);
const exactArray = (actual: unknown, expected: string[]) => Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
const validHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const pendingGates = (): Record<string, AcceptanceGate> => Object.fromEntries([
  "candidate_reader", "run_reader", "package_reader", "detail_reader", "history_reader", "registry_reader", "operator_reader",
  "signed_comparison_identity", "package_receipts", "same_firm_fact_readback", "search_and_filters", "classification_visibility",
  "exact_replay", "whole_manifest_accounting", "two_future_producer_deltas",
].map(key => [key, { status: "pending" as const, reason: ["This offline runner performs no Admin or database reads; capture this assertion through the protected live acceptance procedure after service recovery"] }]));

export function sha256Bytes(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function jsonObject(value: unknown, name: string): Record<string, unknown> {
  if (!object(value)) throw Error(name + "_must_be_object");
  return value;
}
export function parseNormalizedPackagesJsonl(text: string): NormalizedPackage[] {
  const lines = text.split(/\r?\n/), result: NormalizedPackage[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    try { result.push(JSON.parse(lines[index]) as NormalizedPackage); }
    catch { throw Error("normalized_packages_jsonl_invalid_line_" + (index + 1)); }
  }
  return result;
}
function validatePackage(value: unknown, expected: CompiledPackage, source: WholeFirmSourceManifest): NormalizedPackage {
  const raw = jsonObject(value, "normalized_package");
  if (!object(raw.envelope) || typeof raw.payloadSha256 !== "string" || !Array.isArray(raw.issues) ||
      typeof raw.state !== "string" || typeof raw.displayCategory !== "string" || !Object.hasOwn(raw, "originalStatus")) throw Error("normalized_package_shape_invalid");
  const parsed = parseProspectEnrichmentEnvelope(raw.envelope);
  if (!parsed.ok) throw Error("normalized_package_envelope_invalid");
  const envelope = parsed.envelope;
  if (protocolHash(envelope) !== raw.payloadSha256) throw Error("normalized_package_payload_hash_mismatch");
  if (!["ready_for_review", "identity_hold", "evidence_hold"].includes(raw.state)) throw Error("normalized_package_state_invalid");
  if (envelope.mode !== expected.envelope.mode) throw Error("normalized_package_mode_unverified_without_signed_comparison");
  if (canonicalJson(envelope.subject) !== canonicalJson(expected.envelope.subject)) throw Error("normalized_package_identity_unverified_without_signed_comparison");
  const existingRecordLinks = (value: ProspectEnrichmentEnvelope) => ({
    observations: value.observations.map(observation => observation.existingRecord),
    assessment: value.assessment?.existingRecord ?? null,
  });
  if (canonicalJson(existingRecordLinks(envelope)) !== canonicalJson(existingRecordLinks(expected.envelope))) throw Error("normalized_package_existing_record_unverified_without_signed_comparison");
  if (envelope.runId !== expected.envelope.runId || envelope.packageId !== expected.envelope.packageId ||
      envelope.sourceSystem !== expected.envelope.sourceSystem || envelope.sourceName !== expected.envelope.sourceName ||
      envelope.generatedAt !== source.snapshotAt || envelope.subject.researchKey !== expected.envelope.subject.researchKey) throw Error("normalized_package_source_identity_mismatch");
  if (canonicalJson(envelope.originalResearch) !== canonicalJson(expected.envelope.originalResearch) || canonicalJson(envelope) !== canonicalJson(expected.envelope)) throw Error("normalized_package_source_evidence_mismatch");
  if (raw.state !== expected.state || canonicalJson(raw.legacyAssessmentProjectionClaims ?? []) !== canonicalJson(expected.legacyAssessmentProjectionClaims ?? [])) throw Error("normalized_package_compiler_metadata_mismatch");
  if (raw.displayCategory !== expected.displayCategory || canonicalJson(raw.originalStatus) !== canonicalJson(expected.originalStatus) || canonicalJson(raw.issues) !== canonicalJson(expected.issues)) throw Error("normalized_package_category_or_source_status_mismatch");
  return { envelope, payloadSha256: raw.payloadSha256, state: raw.state as NormalizedPackage["state"], displayCategory: raw.displayCategory,
    originalStatus: raw.originalStatus, issues: raw.issues as NormalizedPackage["issues"],
    ...(Array.isArray(raw.legacyAssessmentProjectionClaims) ? { legacyAssessmentProjectionClaims: raw.legacyAssessmentProjectionClaims as NormalizedPackage["legacyAssessmentProjectionClaims"] } : {}) };
}

type FrozenSelection = {
  schemaVersion: string; status: string; capturedAtUtc: string;
  source: { path: string; sha256: string; rows: number };
  cases: { category: string; line: number; revisionId: string; researchKey: string; packageId: string | null; sourcePointer: string; sourceSha256: string; lineSha256: string; decision: string; issues?: string[] }[];
  productionWrites: number; adminImports: number; canonicalLinks: number; qualificationChanges: number; receipts: number; renderedReadbacks: number;
};
function verifyFrozenCaseRow(row: FrozenSelection["cases"][number], index: Record<string, unknown>, exactLine: string): void {
  if (sha256Bytes(Buffer.from(exactLine, "utf8")) !== row.lineSha256) throw Error("frozen_case_line_hash_mismatch");
  if (index.revisionId !== row.revisionId || index.researchKey !== row.researchKey || index.sourcePointer !== row.sourcePointer || index.sourceSha256 !== row.sourceSha256) throw Error("frozen_case_source_identity_mismatch");
  const packageIds = Array.isArray(index.packageIds) ? index.packageIds : null;
  if (row.packageId === null ? packageIds?.length !== 0 : !packageIds?.includes(row.packageId)) throw Error("frozen_case_package_binding_mismatch");
  if (row.category === "qualified-source" && (row.decision !== "qualified" || !row.packageId)) throw Error("frozen_qualified_category_invalid");
  if (row.category === "held" && (row.decision !== "held" || !row.packageId)) throw Error("frozen_held_category_invalid");
  if (row.category === "rejected" && (row.decision !== "rejected" || !row.packageId)) throw Error("frozen_rejected_category_invalid");
  if (row.category === "identity-uncertain" && (row.decision !== "qualified" || !row.packageId)) throw Error("frozen_identity_uncertain_category_invalid");
  if (row.category === "package-less-schema-held" && (row.decision !== "held" || row.packageId !== null || !Array.isArray(row.issues) ||
      !row.issues.includes("producer_envelope_schema_invalid") || !row.issues.includes("whole_firm_standard_envelope_missing") ||
      !Array.isArray(index.issues) || !index.issues.some(issue => object(issue) && issue.code === "producer_envelope_schema_invalid") ||
      !index.issues.some(issue => object(issue) && issue.code === "whole_firm_standard_envelope_missing"))) throw Error("frozen_package_less_category_invalid");
}

/** Validate the exact frozen five-case file and its separately supplied source index. */
export function validateFrozenFiveCaseSelection(
  frozenBytes: Uint8Array,
  sourceIndexBytes: Uint8Array,
  expectedFrozenFileSha256 = FROZEN_FIVE_CASE_FILE_SHA256,
): FrozenFiveCaseReport {
  const fileSha256 = sha256Bytes(frozenBytes), sourceIndexSha256 = sha256Bytes(sourceIndexBytes), errors: string[] = [];
  let frozen: FrozenSelection | null = null, lines: string[] = [], indexRows: Record<string, unknown>[] = [];
  try { frozen = JSON.parse(Buffer.from(frozenBytes).toString("utf8")) as FrozenSelection; } catch { errors.push("frozen_selection_json_invalid"); }
  if (fileSha256 !== expectedFrozenFileSha256) errors.push("frozen_selection_file_hash_mismatch");
  if (!frozen || frozen.schemaVersion !== "prospect-a4-frozen-case-selection/v1" || frozen.status !== "prepared_unapplied" ||
      !frozen.source || frozen.source.sha256 !== sourceIndexSha256 || !validHash(frozen.source.sha256) ||
      !Number.isInteger(frozen.source.rows) || !Array.isArray(frozen.cases) || !Number.isFinite(Date.parse(frozen.capturedAtUtc))) {
    errors.push("frozen_selection_source_binding_invalid");
  }
  try {
    lines = Buffer.from(sourceIndexBytes).toString("utf8").split(/\r?\n/).filter(line => line.length > 0);
    indexRows = lines.map((line, i) => {
      try { return JSON.parse(line) as Record<string, unknown>; }
      catch { throw Error("source_index_jsonl_invalid_line_" + (i + 1)); }
    });
  } catch (error) { errors.push(error instanceof Error ? error.message.split(/[^a-zA-Z0-9_-]/, 1)[0] : "source_index_invalid"); }
  if (frozen && (frozen.source.rows !== lines.length || indexRows.length !== lines.length)) errors.push("frozen_source_index_row_count_mismatch");
  const categories = frozen?.cases?.map(row => row.category) ?? [];
  if (categories.length !== FROZEN_FIVE_CATEGORIES.length || FROZEN_FIVE_CATEGORIES.some(category => categories.filter(value => value === category).length !== 1)) errors.push("frozen_five_case_categories_mismatch");
  if (frozen?.cases) {
    const seenLines = new Set<number>();
    for (const row of frozen.cases) {
      if (!Number.isInteger(row.line) || row.line < 1 || row.line > indexRows.length || seenLines.has(row.line) ||
          typeof row.revisionId !== "string" || typeof row.researchKey !== "string" || typeof row.sourcePointer !== "string" ||
          !validHash(row.sourceSha256) || !validHash(row.lineSha256) || !FROZEN_FIVE_CATEGORIES.includes(row.category as typeof FROZEN_FIVE_CATEGORIES[number])) {
        errors.push("frozen_case_row_shape_or_position_invalid"); continue;
      }
      seenLines.add(row.line);
      try { verifyFrozenCaseRow(row, indexRows[row.line - 1], lines[row.line - 1]); }
      catch (error) { errors.push(error instanceof Error ? error.message : "frozen_case_source_verification_failed"); }
    }
    if ([frozen.productionWrites, frozen.adminImports, frozen.canonicalLinks, frozen.qualificationChanges, frozen.receipts, frozen.renderedReadbacks].some(value => value !== 0)) errors.push("frozen_selection_records_production_action");
  }
  return { status: errors.length ? "fail" : "pass", fileSha256, sourceIndexSha256, rowCount: lines.length,
    caseCount: frozen?.cases?.length ?? 0, categories: sortedUnique(categories), errors: sortedUnique(errors) };
}

export function buildOfflineAcceptance(sourceValue: unknown, sourceManifestBytes: Uint8Array, normalizedPackages: unknown[], frozenFiveCase: FrozenFiveCaseReport): AcceptanceReport {
  let parsedSource: unknown;
  try { parsedSource = JSON.parse(Buffer.from(sourceManifestBytes).toString("utf8")) as unknown; }
  catch { throw Error("source_manifest_json_invalid"); }
  if (canonicalJson(parsedSource) !== canonicalJson(sourceValue)) throw Error("source_manifest_bytes_object_mismatch");
  const source = sourceValue as WholeFirmSourceManifest;
  if (!object(source) || source.schemaVersion !== "prospect-whole-firm-source-manifest/v1") throw Error("acceptance_requires_whole_firm_source_manifest");
  verifyWholeFirmManifest(source);
  const prepared = compileWholeFirmSnapshot(source), expectedById = new Map(prepared.packages.map(pkg => [pkg.envelope.packageId, pkg]));
  if (prepared.candidates.length !== source.expectedRevisionCount || prepared.expected.entries.length !== source.expectedRevisionCount) throw Error("source_revision_accounting_mismatch");
  const normalized: NormalizedPackage[] = [], seen = new Set<string>();
  for (const value of normalizedPackages) {
    if (!object(value) || !object(value.envelope) || typeof value.envelope.packageId !== "string") throw Error("normalized_package_missing_package_id");
    const packageId = value.envelope.packageId, expected = expectedById.get(packageId);
    if (!expected) throw Error("normalized_package_not_in_source_manifest");
    if (seen.has(packageId)) throw Error("normalized_package_duplicate_id");
    seen.add(packageId);
    normalized.push(validatePackage(value, expected, source));
  }
  const expectedPackageIds = [...expectedById.keys()].sort(ordinal);
  if (!exactArray([...seen].sort(ordinal), expectedPackageIds)) throw Error("normalized_package_source_coverage_mismatch");
  const uuidOwners = new Map<string, string>();
  for (const pkg of normalized) {
    const id = pkg.envelope.subject.databaseFirmId;
    if (!id) continue;
    const previous = uuidOwners.get(id);
    if (previous && previous !== pkg.envelope.subject.researchKey) throw Error("normalized_package_firm_uuid_alias_conflict");
    uuidOwners.set(id, pkg.envelope.subject.researchKey);
  }
  const pilot = selectPilot(normalized), cases: AcceptanceCase[] = pilot.selected.map((selection, index) => ({
    caseId: selection.partition + "-" + (pilot.selected.slice(0, index).filter(row => row.partition === selection.partition).length + 1),
    researchKey: selection.researchKey, partition: selection.partition as Partition,
    packageIds: selection.packageIds, payloadHashes: selection.payloadHashes,
  }));
  const pilotErrors = [...pilot.issues.map(issue => issue.code + ":" + issue.path)];
  for (const partition of PARTITIONS) if (cases.filter(item => item.partition === partition).length !== 2) pilotErrors.push("pilot_partition_count_invalid:" + partition);
  if (cases.length !== 10) pilotErrors.push("pilot_total_case_count_invalid");
  const onlyShortfalls = pilotErrors.length > 0 && pilotErrors.every(issue => issue.startsWith("pilot_partition_shortfall:") || issue.startsWith("pilot_partition_count_invalid:") || issue === "pilot_total_case_count_invalid");
  const pilotStatus: "pass" | "fail" | "pending" = pilotErrors.length ? onlyShortfalls ? "pending" : "fail" : "pass";
  const candidateRows = prepared.candidates;
  const packageBackedRevisionCount = candidateRows.filter(candidate => candidate.packageIds.length > 0).length;
  const sourceRevisionDispositionCounts = {
    Qualified: candidateRows.filter(candidate => displayCategory(candidate.originalStatus) === "Qualified").length,
    Held: candidateRows.filter(candidate => displayCategory(candidate.originalStatus) === "Held").length,
    Rejected: candidateRows.filter(candidate => displayCategory(candidate.originalStatus) === "Rejected").length,
    Incomplete: candidateRows.filter(candidate => displayCategory(candidate.originalStatus) === "Incomplete").length,
  };
  const pilotPartitionAvailability = Object.fromEntries(PARTITIONS.map(partition => {
    const shortfall = pilot.issues.find(issue => issue.code === "pilot_partition_shortfall" && issue.path === partition);
    const selectedByRuleCount = pilot.selected.filter(selection => selection.partition === partition).length;
    if (shortfall) {
      try {
        const proof = JSON.parse(shortfall.reason) as { available?: unknown };
        if (!Array.isArray(proof.available) || proof.available.some(key => typeof key !== "string")) throw Error();
        return [partition, { availableResearchKeyCount: proof.available.length, exact: true, selectedByRuleCount }];
      } catch { throw Error("pilot_partition_availability_evidence_invalid"); }
    }
    // selectPilot emits the first two ordinal keys for every non-shortfall partition.
    return [partition, { availableResearchKeyCount: selectedByRuleCount, exact: false, selectedByRuleCount }];
  })) as Record<Partition, { availableResearchKeyCount: number; exact: boolean; selectedByRuleCount: number }>;
  return {
    schemaVersion: "prospect-enrichment-acceptance-report/v1", createdAt: new Date().toISOString(),
    sourceManifestFileSha256: sha256Bytes(sourceManifestBytes), sourceManifestSha256: source.manifestSha256,
    runIds: sortedUnique(prepared.packages.map(pkg => pkg.envelope.runId)), canonicalInput: { status: "pass", errors: [] },
    frozenFiveCase,
    sourceAccounting: { expectedRevisionCount: source.expectedRevisionCount, accountedRevisionCount: candidateRows.length,
      packageBackedRevisionCount, packageLessRevisionCount: candidateRows.length - packageBackedRevisionCount },
    sourceRevisionDispositionCounts, packageBackedResearchKeyCount: new Set(normalized.map(pkg => pkg.envelope.subject.researchKey)).size,
    pilotPartitionAvailability, pilot10: { status: pilotStatus, requiredPerPartition: 2, cases, errors: sortedUnique(pilotErrors) },
    liveGates: pendingGates(),
    acceptanceStatus: pilotStatus === "fail" || frozenFiveCase.status === "fail" ? "offline_fail" : pilotStatus === "pending" ? "offline_pilot_pending_live_pending" : "offline_evidence_validated_live_pending",
    syncStatus: "not_verified", synced: false,
  };
}

export function failedAcceptanceReport(sourceBytes: Uint8Array, frozenFiveCase: FrozenFiveCaseReport, error: unknown): AcceptanceReport {
  const raw = error instanceof Error ? error.message : "unknown", code = raw.split(/[^a-zA-Z0-9_-]/, 1)[0].slice(0, 80) || "unknown";
  return {
    schemaVersion: "prospect-enrichment-acceptance-report/v1", createdAt: new Date().toISOString(),
    sourceManifestFileSha256: sha256Bytes(sourceBytes), sourceManifestSha256: "", runIds: [],
    canonicalInput: { status: "fail", errors: ["acceptance_input_invalid:" + code] }, frozenFiveCase,
    sourceAccounting: { expectedRevisionCount: 0, accountedRevisionCount: 0, packageBackedRevisionCount: 0, packageLessRevisionCount: 0 },
    sourceRevisionDispositionCounts: { Qualified: 0, Held: 0, Rejected: 0, Incomplete: 0 },
    packageBackedResearchKeyCount: 0,
    pilotPartitionAvailability: Object.fromEntries(PARTITIONS.map(partition => [partition, { availableResearchKeyCount: 0, exact: false, selectedByRuleCount: 0 }])) as Record<Partition, { availableResearchKeyCount: number; exact: boolean; selectedByRuleCount: number }>,
    pilot10: { status: "fail", requiredPerPartition: 2, cases: [], errors: ["canonical source/packages validation failed"] },
    liveGates: pendingGates(), acceptanceStatus: "offline_fail", syncStatus: "not_verified", synced: false,
  };
}
