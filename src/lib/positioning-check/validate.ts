import { ELEMENT_KEYS, type Evidence, type PositioningResult } from "./types";

const words = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().split(/\s+/u).length <= max;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasIds = (ids: unknown, known: Map<string, Evidence>, allowEmpty = false): ids is string[] => Array.isArray(ids) && (allowEmpty || ids.length > 0) && ids.every(id => typeof id === "string" && known.has(id));

/** Validate model output against collector-owned evidence. Traceability is not proof of semantic support. */
export function validateAnalysis(raw: unknown, evidence: Evidence[]): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ["analysis_not_object"];
  const known = new Map(evidence.map(item => [item.id, item]));
  if (known.size !== evidence.length) errors.push("duplicate_evidence");
  const p1 = raw.part1, p2 = raw.part2;
  if (!isRecord(p1) || !isRecord(p2)) return [...errors, "missing_parts"];
  if (!words(p1.statement, 55) || !words(p1.rationale, 45)) errors.push("positioning_copy");
  if (!Array.isArray(p1.elements) || p1.elements.length !== 8) errors.push("element_count");
  else {
    const keys = new Set<string>();
    for (const e of p1.elements) {
      if (!isRecord(e)) { errors.push("element_shape"); continue; }
      if (typeof e.key !== "string" || !ELEMENT_KEYS.includes(e.key as typeof ELEMENT_KEYS[number]) || keys.has(e.key)) errors.push("element_key");
      else keys.add(e.key);
      if (!["observed", "inferred", "unclear", "not_observed", "not_assessable"].includes(String(e.status))) errors.push("element_status");
      if (e.clarity !== null && ![0, 1, 2, 3].includes(e.clarity as number)) errors.push("element_clarity");
      if (e.confidence !== null && !["high", "moderate", "low"].includes(String(e.confidence))) errors.push("element_confidence");
      if (e.status === "not_assessable" && (e.clarity !== null || e.confidence !== null)) errors.push("unassessable_scored");
      if (!words(e.finding, 45) || !words(e.reason, 45) || !words(e.uncertainty, 30) || typeof e.conflict !== "boolean") errors.push("element_copy");
      if (!hasIds(e.evidenceIds, known, e.status === "not_assessable" || e.status === "not_observed")) errors.push("element_evidence");
      if (e.conflict === true && e.confidence === "high") errors.push("conflict_confidence");
      if (e.conflict === true && (!Array.isArray(e.evidenceIds) || new Set(e.evidenceIds).size < 2)) errors.push("conflict_evidence");
    }
  }
  if (!Array.isArray(p1.visualFindings) || p1.visualFindings.length > 3) errors.push("visual_count");
  else for (const v of p1.visualFindings) {
    if (!isRecord(v) || !words(v.finding, 45) || !hasIds(v.evidenceIds, known) || !v.evidenceIds.every(id => known.get(id)?.kind === "screenshot")) errors.push("visual_evidence");
  }
  if (!Array.isArray(p2.directions) || p2.directions.length > 3) errors.push("direction_count");
  else if (!Array.isArray(p2.limitations) || !p2.limitations.every(x => words(x, 30))) errors.push("direction_limitations");
  else {
    const ids = new Set<string>();
    for (const d of p2.directions) {
      if (!isRecord(d)) { errors.push("direction_shape"); continue; }
      if (typeof d.id !== "string" || !d.id.trim() || ids.has(d.id)) errors.push("direction_id"); else ids.add(d.id);
      for (const k of ["label", "audienceSituation", "communicationImplication", "clientExpectation", "tradeoff"]) if (!words(d[k], 30)) errors.push("direction_copy");
      if (!words(d.possibleStatement, 35) || !hasIds(d.evidenceIds, known)) errors.push("direction_basis");
      if (!Array.isArray(d.validationQuestions) || d.validationQuestions.length !== 3 || !d.validationQuestions.every(q => words(q, 30))) errors.push("direction_questions");
    }
  }
  return [...new Set(errors)];
}
export type AnalysisParts = Pick<PositioningResult, "part1" | "part2">;


