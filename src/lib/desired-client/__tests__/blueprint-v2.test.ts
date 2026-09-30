import { describe, expect, it } from "vitest";
import { buildDefinitionSentence } from "../definition";
import { validateAnalysisResult } from "../output";
import { completeAnswers, validBlueprint } from "./blueprint-helpers";
describe("Desired Client Blueprint v4 contract", () => {
  it("accepts a grounded six-card profile with its deterministic one-sentence definition", () => {
    const result = validBlueprint();
    expect(result.brief.report_version).toBe("dcm-blueprint-v4");
    expect(result.brief.definition_sentence).toBe(buildDefinitionSentence(result.brief, false));
    expect([result.brief.why_client_chooses_firm, result.brief.client_and_matter, result.brief.why_firm_wants_work, result.brief.recognizable_circumstances, result.brief.evidence_and_open_questions, result.brief.client_goals_needs]).toHaveLength(6);
    expect(validateAnalysisResult(result, completeAnswers(), [])).not.toBeNull();
  });
  it("rejects legacy answer-list schemas, extra keys, and v1 reports as AI output", () => {
    const candidate = validBlueprint(), answers = completeAnswers();
    expect(validateAnalysisResult({ brief: { definition: {}, client_goals: [], firm_reasons: [], delivery_conditions: [], evidence: [], open_questions: [], marketing: {}, work_to_promote_less: [] }, clarification_code: null }, answers, [])).toBeNull();
    expect(validateAnalysisResult({ ...candidate, extra: true }, answers, [])).toBeNull();
    expect(validateAnalysisResult({ ...candidate, brief: { ...candidate.brief, report_version: "dcm-blueprint-v1" } }, answers, [])).toBeNull();
  });
  it("rejects mismatched definitions, unsupported sources, and evidence-basis mismatches", () => {
    const answers = completeAnswers(), candidate = validBlueprint();
    expect(validateAnalysisResult({ ...candidate, brief: { ...candidate.brief, definition_sentence: "A different sentence." } }, answers, [])).toBeNull();
    const fabricated = structuredClone(candidate); fabricated.brief.why_firm_wants_work.claims[0].source_answer_ids = ["focus.industry" as never];
    expect(validateAnalysisResult(fabricated, answers, [])).toBeNull();
    const mismatch = structuredClone(candidate); mismatch.brief.why_firm_wants_work.claims[0].evidence_basis = "firm_reported_recorded";
    expect(validateAnalysisResult(mismatch, answers, [])).toBeNull();
  });
  it("requires unknown statements to cite an answer path that is explicitly unknown", () => {
    const answers = completeAnswers(), candidate = validBlueprint(); answers.opportunity.source_detail = "Monthly enquiry log";
    candidate.brief.evidence_and_open_questions.claims[0].source_answer_ids = ["opportunity.source_detail"];
    expect(validateAnalysisResult(candidate, answers, [])).toBeNull();
  });
});
