import { describe, expect, it } from "vitest";
import { validateAnalysisResult } from "../output";
import { completeAnswers, validBlueprint } from "./blueprint-helpers";
import { evidence } from "./blueprint-helpers";
import { calculateContribution } from "../economics";
import { interviewClarificationSourceFingerprint } from "../types";
describe("AI Blueprint output contract", () => {
  it("accepts six grounded cards with distinct evidence labels", () => { const value = validBlueprint(); expect(validateAnalysisResult(value, completeAnswers(), [])).not.toBeNull(); expect(value.brief.evidence_and_open_questions.claims[0].evidence_basis).toBe("unknown"); expect(value.brief.why_firm_wants_work.claims[0].evidence_basis).toBe("firm_preference"); });
  it("rejects legacy answer-list schemas, extra keys, and wrong versions", () => { const good = validBlueprint(), answers = completeAnswers(); expect(validateAnalysisResult({ brief: { definition: {}, client_goals: [], firm_reasons: [], marketing: {} }, clarification_code: null }, answers, [])).toBeNull(); expect(validateAnalysisResult({ ...good, unexpected: true }, answers, [])).toBeNull(); expect(validateAnalysisResult({ ...good, brief: { ...good.brief, report_version: "dcm-blueprint-v1" } }, answers, [])).toBeNull(); });
  it("rejects unsupported citations, definition drift, and slot overflow", () => { const answers = completeAnswers(), good = validBlueprint(); const fabricated = structuredClone(good); fabricated.brief.why_firm_wants_work.claims[0].source_answer_ids = ["focus.industry" as never]; expect(validateAnalysisResult(fabricated, answers, [])).toBeNull(); const sentence = structuredClone(good); sentence.brief.definition_sentence += " Extra."; expect(validateAnalysisResult(sentence, answers, [])).toBeNull(); const long = structuredClone(good); long.brief.client_and_matter.claims[0].text = "x ".repeat(101); expect(validateAnalysisResult(long, answers, [])).toBeNull(); });
  it("rejects an unknown claim cited only to known information and an incorrect evidence basis", () => { const answers = completeAnswers(), good = validBlueprint(); answers.opportunity.source_detail = "Monthly enquiry log"; const wrongUnknown = structuredClone(good); wrongUnknown.brief.evidence_and_open_questions.claims[0].source_answer_ids = ["opportunity.source_detail"]; expect(validateAnalysisResult(wrongUnknown, answers, [])).toBeNull(); const mismatch = structuredClone(good); mismatch.brief.why_firm_wants_work.claims[0].evidence_basis = "firm_reported_recorded"; expect(validateAnalysisResult(mismatch, answers, [])).toBeNull(); });
  it("rejects AI citations to a follow-up after its cited answers have changed",()=>{const answers=completeAnswers(),paths=["value.reasons"] as const;answers.interview.clarification_count=1;answers.interview.clarified_stages=[3];answers.interview.followups=[{id:"11111111-1111-4111-8111-111111111111",stage:3,purpose:"firm_desirability",source_answer_ids:[...paths],source_answer_fingerprint:interviewClarificationSourceFingerprint(answers,paths),question:"Why does the firm want this work?",answer:"The work lets us use our transaction experience.",skipped:false}];const fresh=validBlueprint();fresh.brief.why_firm_wants_work.claims=[evidence("The work lets us use our transaction experience.","firm_preference","interview.followups.0")];expect(validateAnalysisResult(fresh,answers,[])).not.toBeNull();answers.value.reasons=["client_benefit"];expect(validateAnalysisResult(fresh,answers,[])).toBeNull();});
  it("accepts only an application-calculated contribution with all five economics sources", () => {
    const answers = completeAnswers();
    answers.value.fee_amount = "8000"; answers.value.direct_cost_amount = "4800";
    answers.value.currency = "CAD"; answers.value.amount_basis = "recorded"; answers.value.amount_scope = "per_matter";
    const derived = calculateContribution(answers);
    expect(derived).not.toBeNull();
    const result = validBlueprint();
    result.brief.why_firm_wants_work.claims = [evidence(
      `Recorded contribution before overhead and acquisition costs: ${derived!.amount} per matter.`,
      "firm_reported_recorded",
      "value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope",
    )];
    expect(validateAnalysisResult(result, answers, [])).not.toBeNull();
    result.brief.why_firm_wants_work.claims[0].text = "Recorded contribution before overhead and acquisition costs: $4,200 per matter.";
    expect(validateAnalysisResult(result, answers, [])).toBeNull();
  });
  it("rejects the audit's unsupported hostile-takeover substitution", () => {
    const result=validBlueprint(), answers=completeAnswers();
    result.brief.client_and_matter.claims[0].text="The client is considering a hostile takeover and needs advice.";
    expect(validateAnalysisResult(result,answers,[])).toBeNull();
  });
  it("does not reject a supported definition solely because it exceeds the former 85-word ceiling", () => {
    const answers = completeAnswers(), result = validBlueprint();
    result.brief.definition_components.client.text = Array(25).fill("buyer").join(" ");
    result.brief.definition_components.client_matter.text = Array(45).fill("deal").join(" ");
    result.brief.definition_components.reasons.text = Array(35).fill("fit").join(" ");
    result.brief.definition_components.outcome.text = Array(25).fill("matters").join(" ");
    result.brief.definition_sentence = `The firm wants to attract and serve ${result.brief.definition_components.client.text} seeking ${result.brief.definition_components.client_matter.text}, because ${result.brief.definition_components.reasons.text}, and progress will be assessed against ${result.brief.definition_components.outcome.text}.`;
    expect(result.brief.definition_sentence.split(/\s+/).length).toBeGreaterThan(85);
    expect(validateAnalysisResult(result, answers, [])).not.toBeNull();
  });
});
