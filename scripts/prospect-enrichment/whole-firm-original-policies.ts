import type { JsonValue, ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { encodeBoundedProspectEnvelope } from "../../src/lib/prospect-enrichment-original-content";
import { canonicalJson, getPointer, leafPointers, object, ordinal, protocolHash, recordedDate } from "./model";
import { WHOLE_FIRM_PROFILE, wholeFirmPackageId, wholeFirmRunId } from "./profiles";
import type { WholeFirmSourceManifest } from "./whole-firm";

export type WholeFirmOriginalPolicyProvenance = {
  parentSourceManifestSha256: string; parentSourceExportSha256: string;
  compilerCommit: string; compilerFileSha256: string; baselineLedgerSha256: string;
};
export type OriginalRevisionBinding = {
  revisionId: string; sourcePointer: string; wrapperSha256: string; originalRevisionSha256: string | null;
};
export type WholeFirmOriginalRepresentationPolicy = WholeFirmOriginalPolicyProvenance & {
  schemaVersion: "prospect-whole-firm-original-representation-policy/v1";
  policyVersion: "bounded-original-nodes/v1"; revisions: OriginalRevisionBinding[];
};
export type CompletionTelemetry = {
  sourcePointer: string; value: JsonValue; semantics: "researcher_recorded_package_completion"; historicalSemanticsVerified: false;
};
export type OriginalResultSource = { sourcePath: string; sourcePointer: string; sourceSha256: string; sourceKind: "retained-standard-envelope" | "frozen-coordinator-result" };
export type UnknownCompletionBinding = OriginalRevisionBinding & {
  originalSource: OriginalResultSource;
  resultSha256: string; resultCompletedAt: null; completionState: "unknown";
  issueCode: "result_completed_at_not_recorded"; telemetry: CompletionTelemetry[];
};
export type WholeFirmUnknownCompletionRetentionPolicy = WholeFirmOriginalPolicyProvenance & {
  schemaVersion: "prospect-whole-firm-unknown-completion-retention-policy/v1";
  policyVersion: "original-only-evidence-hold/v1"; revisions: UnknownCompletionBinding[];
};
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v,key));
const provenanceKeys = ["parentSourceManifestSha256", "parentSourceExportSha256", "compilerCommit", "compilerFileSha256", "baselineLedgerSha256"];
const bindingKeys = ["revisionId", "sourcePointer", "wrapperSha256", "originalRevisionSha256"];
function validProvenance(v: Record<string, unknown>): boolean {
  return sha(v.parentSourceManifestSha256) && sha(v.parentSourceExportSha256) && typeof v.compilerCommit === "string" && /^[a-f0-9]{40}$/.test(v.compilerCommit) && sha(v.compilerFileSha256) && sha(v.baselineLedgerSha256);
}
function validBinding(v: Record<string, unknown>): boolean {
  return typeof v.revisionId === "string" && v.revisionId.length > 0 && typeof v.sourcePointer === "string" && /^\/originalExport\/revisions\/(0|[1-9][0-9]*)$/.test(v.sourcePointer) && sha(v.wrapperSha256) && (v.originalRevisionSha256 === null || sha(v.originalRevisionSha256));
}
export function originalRevisionBinding(source: WholeFirmSourceManifest, index: number): OriginalRevisionBinding {
  const wrapper = source.originalExport.revisions[index];
  return { revisionId: source.originalExport.expectedRevisions[index].revisionId, sourcePointer: "/originalExport/revisions/" + index,
    wrapperSha256: protocolHash(wrapper), originalRevisionSha256: object(wrapper) && Object.hasOwn(wrapper,"originalRevision") ? protocolHash(wrapper.originalRevision) : null };
}
export function validWholeFirmOriginalRepresentationPolicy(v: unknown): v is WholeFirmOriginalRepresentationPolicy {
  return exact(v,[...provenanceKeys,"schemaVersion","policyVersion","revisions"]) && validProvenance(v) && v.schemaVersion === "prospect-whole-firm-original-representation-policy/v1" && v.policyVersion === "bounded-original-nodes/v1" && Array.isArray(v.revisions) && v.revisions.length <= 10000 && v.revisions.every(entry => exact(entry,bindingKeys) && validBinding(entry)) && new Set(v.revisions.map(entry => entry.revisionId)).size === v.revisions.length;
}
/** Preserve direct frozen source references; a missing standard envelope needs one exact archived result match. */
export function originalResultSource(source: WholeFirmSourceManifest, index: number): OriginalResultSource {
  const wrapper = source.originalExport.revisions[index];
  if (!object(wrapper) || !object(wrapper.originalRevision) || !object(wrapper.originalRevision.result)) throw Error("unknown_completion_retention_source_invalid");
  if (object(wrapper.standardEnvelope) && object(wrapper.standardEnvelope.originalResearch)) {
    const original = wrapper.standardEnvelope.originalResearch;
    if (typeof original.sourcePath !== "string" || !original.sourcePath || typeof original.sourcePointer !== "string" || (original.sourcePointer !== "" && !original.sourcePointer.startsWith("/")) || !sha(original.sourceSha256) || original.contentSha256 !== protocolHash(wrapper.originalRevision)) throw Error("unknown_completion_retention_source_invalid");
    return { sourcePath: original.sourcePath, sourcePointer: original.sourcePointer, sourceSha256: original.sourceSha256, sourceKind: "retained-standard-envelope" };
  }
  const inventory = source.originalExport.sourceInventory;
  if (!object(inventory) || !object(inventory.provenance) || typeof inventory.provenance.sourcePath !== "string" || !inventory.provenance.sourcePath || !sha(inventory.provenance.sourceSha256) || !object(inventory.state) || inventory.state.schemaVersion !== "whole-firm-coordinator-v1" || !Array.isArray(inventory.state.candidates) || !object(wrapper.originalRevision.candidateContext)) throw Error("unknown_completion_retention_source_invalid");
  const contextSha = protocolHash(wrapper.originalRevision.candidateContext), resultSha = protocolHash(wrapper.originalRevision.result);
  const matches = inventory.state.candidates.flatMap((candidate,index) => {
    if (!object(candidate) || !Array.isArray(candidate.results) || protocolHash(Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "results"))) !== contextSha) return [];
    return candidate.results.flatMap((result,resultIndex) => protocolHash(result) === resultSha ? ["/candidates/" + index + "/results/" + resultIndex] : []);
  });
  if (matches.length !== 1) throw Error("unknown_completion_retention_source_ambiguous");
  return { sourcePath: inventory.provenance.sourcePath, sourcePointer: matches[0], sourceSha256: inventory.provenance.sourceSha256, sourceKind: "frozen-coordinator-result" };
}
/** The nested researcher telemetry is preserved as a claim, never promoted to result completion. */
export function unknownCompletionBinding(source: WholeFirmSourceManifest, index: number): UnknownCompletionBinding {
  const wrapper = source.originalExport.revisions[index];
  const revision = object(wrapper) ? wrapper.originalRevision : null;
  if (!object(revision) || !object(revision.result) || recordedDate(revision.result.completedAt).missingProvenanceReason !== "not_recorded_in_source") throw Error("unknown_completion_retention_scope_invalid");
  const telemetry: CompletionTelemetry[] = [];
  for (const suffix of ["/originalRevision/result/record/researchTiming/packageCompletedAt", "/originalRevision/result/researchTiming/packageCompletedAt"]) {
    const value = getPointer(wrapper,suffix);
    if (value !== undefined) telemetry.push({ sourcePointer: "/originalExport/revisions/" + index + suffix, value: JSON.parse(canonicalJson(value)) as JsonValue,
      semantics: "researcher_recorded_package_completion", historicalSemanticsVerified: false });
  }
  return { ...originalRevisionBinding(source,index), originalSource: originalResultSource(source,index), resultSha256: protocolHash(revision.result), resultCompletedAt: null, completionState: "unknown", issueCode: "result_completed_at_not_recorded", telemetry };
}
export function validWholeFirmUnknownCompletionRetentionPolicy(v: unknown): v is WholeFirmUnknownCompletionRetentionPolicy {
  return exact(v,[...provenanceKeys,"schemaVersion","policyVersion","revisions"]) && validProvenance(v) && v.schemaVersion === "prospect-whole-firm-unknown-completion-retention-policy/v1" && v.policyVersion === "original-only-evidence-hold/v1" && Array.isArray(v.revisions) && v.revisions.length <= 10000 && v.revisions.every(entry => exact(entry,[...bindingKeys,"originalSource","resultSha256","resultCompletedAt","completionState","issueCode","telemetry"]) && validBinding(entry) && exact(entry.originalSource,["sourcePath","sourcePointer","sourceSha256","sourceKind"]) && typeof entry.originalSource.sourcePath === "string" && entry.originalSource.sourcePath.length > 0 && typeof entry.originalSource.sourcePointer === "string" && (entry.originalSource.sourcePointer === "" || entry.originalSource.sourcePointer.startsWith("/")) && sha(entry.originalSource.sourceSha256) && ["retained-standard-envelope","frozen-coordinator-result"].includes(String(entry.originalSource.sourceKind)) && sha(entry.resultSha256) && entry.originalRevisionSha256 !== null && entry.resultCompletedAt === null && entry.completionState === "unknown" && entry.issueCode === "result_completed_at_not_recorded" && Array.isArray(entry.telemetry) && entry.telemetry.length <= 2 && entry.telemetry.every(t => exact(t,["sourcePointer","value","semantics","historicalSemanticsVerified"]) && typeof t.sourcePointer === "string" && t.semantics === "researcher_recorded_package_completion" && t.historicalSemanticsVerified === false)) && new Set(v.revisions.map(entry => entry.revisionId)).size === v.revisions.length;
}
/** Complete raw revisions only: no typed evidence, qualification, identity decision or fabricated date. */
export function unknownCompletionOriginalOnlyEnvelope(source: WholeFirmSourceManifest, index: number): ProspectEnrichmentEnvelope {
  const wrapper = source.originalExport.revisions[index] as Record<string, unknown>;
  const revision = wrapper.originalRevision as Record<string, unknown>;
  const expected = source.originalExport.expectedRevisions[index], runId = wholeFirmRunId(source.manifestSha256);
  const originalSource = originalResultSource(source,index);
  const savedSubject = object(wrapper.standardEnvelope) && object(wrapper.standardEnvelope.subject) ? wrapper.standardEnvelope.subject : null;
  const context = object(revision.candidateContext) ? revision.candidateContext : null;
  const conflict = savedSubject?.identityState === "conflict" || (context && Array.isArray(context.identityConflicts) && context.identityConflicts.length > 0);
  const displayName = typeof savedSubject?.displayName === "string" ? savedSubject.displayName
    : context && typeof context.name === "string" ? context.name : expected.researchKey;
  return encodeBoundedProspectEnvelope({ schemaVersion: "prospect-enrichment/v1", runId,
    packageId: wholeFirmPackageId(runId,expected.researchKey,revision), supersedesPackageId: null,
    sourceSystem: WHOLE_FIRM_PROFILE.sourceSystem, sourceName: WHOLE_FIRM_PROFILE.sourceName, generatedAt: source.snapshotAt, mode: "propose",
    subject: { researchKey: expected.researchKey, displayName, databaseFirmId: null, stableFirmId: null, sourceRecordKey: null,
      canonicalDomain: typeof savedSubject?.canonicalDomain === "string" ? savedSubject.canonicalDomain : null, identityState: conflict ? "conflict" : "unresolved" },
    sources: [], observations: [], assessment: null,
    originalResearch: { sourcePath: originalSource.sourcePath, sourcePointer: originalSource.sourcePointer,
      sourceSha256: originalSource.sourceSha256, content: revision as JsonValue, contentSha256: protocolHash(revision), unmappedPaths: [...new Set(leafPointers(revision))].sort(ordinal) },
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false } });
}

