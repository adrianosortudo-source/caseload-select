import { describe, expect, it } from "vitest";
import { buildDefinitionSentence } from "../definition";
import { validateAnalysisResult } from "../output";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { completeAnswers, validBlueprint } from "./blueprint-helpers";
describe("Desired Client Blueprint v4 contract", () => {
  it("accepts a grounded six-card profile with its deterministic one-sentence definition", () => {
    const result = validBlueprint(), answers = completeAnswers();
    expect(result.brief.report_version).toBe("dcm-blueprint-v4");
    expect(result.brief.definition_sentence).toBe(buildDefinitionSentence(result.brief, false, answers.client.goal_detail, answers.client.goals.includes("unknown")));
    expect([result.brief.why_client_chooses_firm, result.brief.client_and_matter, result.brief.why_firm_wants_work, result.brief.recognizable_circumstances, result.brief.evidence_and_open_questions, result.brief.client_goals_needs]).toHaveLength(6);
    expect(validateAnalysisResult(result, completeAnswers(), [])).not.toBeNull();
  });
  it("frames client benefits as quoted content for noun phrases and complete sentences", () => {
    const brief = validBlueprint().brief;
    const nounPhrase = buildDefinitionSentence(brief, false, "Clarity about the assets, liabilities, payment and closing obligations.");
    expect(nounPhrase).toContain('with the intended client benefit described as “Clarity about the assets, liabilities, payment and closing obligations”');
    expect(nounPhrase).not.toContain("can clarity");
    const completeSentence = buildDefinitionSentence(brief, false, "The buyer understands what they will receive and which obligations they will assume.");
    expect(completeSentence).toContain("The buyer understands what they will receive and which obligations they will assume");
    expect(completeSentence).not.toContain("can The buyer");
    const unknown = buildDefinitionSentence(brief, false, "", true);
    expect(unknown).toContain("with the practical client benefit still to be established");
  });
  it("rejects legacy answer-list schemas, extra keys, and v1 reports as AI output", () => {
    const candidate = validBlueprint(), answers = completeAnswers();
    expect(validateAnalysisResult({ brief: { definition: {}, client_goals: [], firm_reasons: [], delivery_conditions: [], evidence: [], open_questions: [], marketing: {}, work_to_promote_less: [] }, clarification_code: null }, answers, [])).toBeNull();
    expect(validateAnalysisResult({ ...candidate, extra: true }, answers, [])).toBeNull();
    expect(validateAnalysisResult({ ...candidate, brief: { ...candidate.brief, report_version: "dcm-blueprint-v1" } }, answers, [])).toBeNull();
  });
  it("rejects mismatched definitions, unsupported sources, and evidence-basis mismatches", () => {
    const answers = completeAnswers(), candidate = validBlueprint();
    const mismatched = validateAnalysisResult({ ...candidate, brief: { ...candidate.brief, definition_sentence: "A different sentence." } }, answers, []);
    const grounded = buildStructuredBlueprintV4(answers);
    const groundedBrief = { ...candidate.brief, definition_components: { ...candidate.brief.definition_components, client: grounded.definition_components.client, client_matter: grounded.definition_components.client_matter } };
    expect(mismatched?.brief.definition_sentence).toBe(buildDefinitionSentence(groundedBrief, false, answers.client.goal_detail, answers.client.goals.includes("unknown")));
    const fabricated = structuredClone(candidate); fabricated.brief.why_firm_wants_work.claims[0].source_answer_ids = ["focus.industry" as never];
    expect(validateAnalysisResult(fabricated, answers, [])).toBeNull();
    const mismatch = structuredClone(candidate); mismatch.brief.why_firm_wants_work.claims[0].evidence_basis = "firm_reported_recorded";
    expect(validateAnalysisResult(mismatch, answers, [])).toBeNull();
  });
  it("rebuilds a provider evidence claim with the current answer basis", () => {
    const answers = completeAnswers(), candidate = validBlueprint(); answers.opportunity.source_detail = "Monthly enquiry log";
    candidate.brief.evidence_and_open_questions.claims[0].source_answer_ids = ["opportunity.source_detail"];
    const result=validateAnalysisResult(candidate, answers, []);
    const detail=result?.brief.evidence_and_open_questions.claims.find(claim=>claim.source_answer_ids.includes("opportunity.source_detail"));
    expect(detail).toMatchObject({evidence_basis:"hypothesis",kind:"hypothesis"});
    expect(detail?.text).toContain("Monthly enquiry log");
    expect(detail?.evidence_basis).not.toBe("unknown");
  });
});
