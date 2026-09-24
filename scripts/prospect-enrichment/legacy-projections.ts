import type { ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { object, protocolHash, type Issue } from "./model";

/** Compiler provenance only; this is never proof that Admin has accepted the finding. */
export type LegacyAssessmentProjectionClaim = {
  observationId: string;
  parentAssessmentId: string;
  sourcePointer: string;
  criteriaSelector: string;
  selectedValueSha256: string;
};
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fields = ["observationId", "parentAssessmentId", "sourcePointer", "criteriaSelector", "selectedValueSha256"];
export function isSafeJsonPointer(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && value.slice(1).split("/").every(token =>
    !/~(?:[^01]|$)/.test(token) && !["__proto__", "prototype", "constructor"].includes(token.replace(/~1/g, "/").replace(/~0/g, "~")));
}
export function isCriteriaSelector(value: unknown): value is string {
  return isSafeJsonPointer(value) && value.startsWith("/criteria/") && value.length > "/criteria/".length;
}
/** Own-property traversal only; malformed escapes, inherited keys and array aliases never resolve. */
export function selectOwnJsonPointer(value: unknown, pointer: string): { found: boolean; value: unknown } {
  if (!isSafeJsonPointer(pointer)) return { found: false, value: undefined };
  let current: unknown = value;
  for (const token of pointer.slice(1).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key) || (Array.isArray(current) && !/^(?:0|[1-9]\d*)$/.test(key))) return { found: false, value: undefined };
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true, value: current };
}
export function projectionClaim(input: Omit<LegacyAssessmentProjectionClaim, "selectedValueSha256">, content: unknown): LegacyAssessmentProjectionClaim | null {
  const selected = selectOwnJsonPointer(content, input.sourcePointer);
  return isCriteriaSelector(input.criteriaSelector) && selected.found
    ? { ...input, selectedValueSha256: protocolHash(selected.value) } : null;
}
export function validateLegacyAssessmentProjectionClaims(envelope: ProspectEnrichmentEnvelope, input: unknown): Issue[] {
  if (input === undefined) return [];
  const issues: Issue[] = [];
  const fail = (path: string) => issues.push({ code: "legacy_projection_claim_invalid", path, reason: "Projection metadata must identify an exact nested original criteria value and this envelope's observation/assessment." });
  if (!Array.isArray(input)) { fail("legacyAssessmentProjectionClaims"); return issues; }
  const seen = new Set<string>();
  for (const [index, claim] of input.entries()) {
    const at = "legacyAssessmentProjectionClaims/" + index;
    if (!object(claim) || Object.keys(claim).length !== fields.length || !fields.every(key => Object.hasOwn(claim, key)) || typeof claim.observationId !== "string" || typeof claim.parentAssessmentId !== "string" || !isSafeJsonPointer(claim.sourcePointer) || !isCriteriaSelector(claim.criteriaSelector) || !hash(claim.selectedValueSha256)) { fail(at); continue; }
    const original = selectOwnJsonPointer(envelope.originalResearch.content, claim.sourcePointer);
    const criteria = selectOwnJsonPointer({ criteria: envelope.assessment?.legacyCriteria }, claim.criteriaSelector);
    if (!envelope.assessment || claim.parentAssessmentId !== envelope.assessment.assessmentId || !envelope.observations.some(o => o.observationId === claim.observationId) || seen.has(claim.observationId) || !claim.sourcePointer.endsWith(claim.criteriaSelector) || !original.found || !criteria.found || protocolHash(original.value) !== claim.selectedValueSha256 || protocolHash(criteria.value) !== claim.selectedValueSha256) fail(at);
    seen.add(claim.observationId);
  }
  return issues;
}
