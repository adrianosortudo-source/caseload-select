import { buildProspectEnrichmentClientItems, type ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { compileCandidate, type CompiledPackage } from "./compiler";
import { produceWholeFirmExport } from "./whole-firm-producer";
import { canonicalJson, object } from "./model";
import { selectOwnJsonPointer, validateLegacyAssessmentProjectionClaims, type LegacyAssessmentProjectionClaim } from "./legacy-projections";
export type { LegacyAssessmentProjectionClaim } from "./legacy-projections";
export type DerivedLegacyAssessmentProjection = {
  observationSourceEventKey: string;
  observationSemanticSha256: string;
  parentAssessmentClientId: string;
  criteriaSelector: string;
  selectedValueSha256: string;
};
type Mapped = Pick<CompiledPackage, "envelope" | "legacyAssessmentProjectionClaims">;
function remap(envelope: ProspectEnrichmentEnvelope, content: unknown): Mapped[] {
  if (!object(content)) return [];
  if (envelope.sourceSystem === "caseload-qualification-legacy-v1") {
    const split = envelope.originalResearch.sourcePath.indexOf("/");
    if (split <= 0) return [];
    const wrapped = object(content.candidate) && object(content.parentMetadata);
    const original = wrapped ? content.candidate : content;
    if (!object(original)) return [];
    return compileCandidate({
      original, parentMetadata: wrapped ? content.parentMetadata as Record<string, unknown> : {}, pointer: envelope.originalResearch.sourcePointer,
      artifact: {sourceRoot:envelope.originalResearch.sourcePath.slice(0,split),relativePath:envelope.originalResearch.sourcePath.slice(split+1),sourcePointer:"",snapshotAt:envelope.generatedAt,size:0,fileSha256:envelope.originalResearch.sourceSha256,archivePath:"",classification:"research",status:"snapshotted"}
    }, {manifestSha256:"0".repeat(64),snapshotAt:envelope.generatedAt}).packages;
  }
  if (envelope.sourceSystem === "caseload-whole-firm-v1" && content.schemaVersion === "whole-firm-producer-revision/v1" && object(content.candidateContext) && object(content.result)) {
    const produced = produceWholeFirmExport({schemaVersion:"whole-firm-coordinator-v1",candidates:[{...content.candidateContext,results:[content.result]}]}, {sourcePath:envelope.originalResearch.sourcePath,sourceSha256:envelope.originalResearch.sourceSha256,references:[]}, envelope.generatedAt);
    return produced.exported.revisions.flatMap(value => object(value) && object(value.standardEnvelope) ? [{
      envelope: value.standardEnvelope as unknown as ProspectEnrichmentEnvelope,
      legacyAssessmentProjectionClaims: value.legacyAssessmentProjectionClaims as LegacyAssessmentProjectionClaim[]
    }] : []);
  }
  return [];
}
function selectedLineage(envelope: ProspectEnrichmentEnvelope, observationId: string) {
  const index = envelope.observations.findIndex(o => o.observationId === observationId);
  return index < 0 ? null : buildProspectEnrichmentClientItems(envelope)[envelope.sources.length + index];
}
function replaceCriteria(content: unknown, claim: LegacyAssessmentProjectionClaim, criteria: unknown): unknown | null {
  const copy: unknown = JSON.parse(canonicalJson(content));
  const parentPointer = claim.sourcePointer.slice(0, -claim.criteriaSelector.length);
  const parent = parentPointer ? selectOwnJsonPointer(copy, parentPointer) : {found:true,value:copy};
  if (!parent.found || !object(parent.value) || !Object.hasOwn(parent.value,"criteria") || !object(criteria)) return null;
  parent.value.criteria = JSON.parse(canonicalJson(criteria));
  return copy;
}
/** Pure pinned-mapper replay. Metadata and matching scalar values alone are never accepted as proof. */
export function deriveLegacyAssessmentProjection(envelope: ProspectEnrichmentEnvelope, claim: LegacyAssessmentProjectionClaim, storedCriteria: unknown): DerivedLegacyAssessmentProjection | null {
  try {
    if (validateLegacyAssessmentProjectionClaims(envelope,[claim]).length || !envelope.assessment) return null;
    const expectedChild = selectedLineage(envelope,claim.observationId);
    const parent = buildProspectEnrichmentClientItems(envelope).find(item => item.itemKind === "assessment");
    if (!expectedChild || !parent) return null;
    const original = envelope.originalResearch.content;
    const changed = replaceCriteria(original,claim,storedCriteria);
    if (!changed) return null;
    for (const content of [original,changed]) {
      const mapped = remap(envelope,content).filter(p => p.legacyAssessmentProjectionClaims?.some(candidate =>
        candidate.observationId===claim.observationId && candidate.parentAssessmentId===claim.parentAssessmentId && candidate.sourcePointer===claim.sourcePointer && candidate.criteriaSelector===claim.criteriaSelector && candidate.selectedValueSha256===claim.selectedValueSha256));
      if (mapped.length !== 1) return null;
      const child = selectedLineage(mapped[0].envelope,claim.observationId);
      if (!child || child.sourceEventKey!==expectedChild.sourceEventKey || child.semanticSha256!==expectedChild.semanticSha256) return null;
    }
    return {observationSourceEventKey:expectedChild.sourceEventKey,observationSemanticSha256:expectedChild.semanticSha256,parentAssessmentClientId:parent.clientItemId,criteriaSelector:claim.criteriaSelector,selectedValueSha256:claim.selectedValueSha256};
  } catch { return null; }
}
