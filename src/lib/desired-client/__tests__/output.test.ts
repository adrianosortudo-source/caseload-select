import { describe, expect, it } from "vitest";
import { validateAnalysisResult } from "../output";
import { completeAnswers, validBlueprint } from "./blueprint-helpers";
import { evidence } from "./blueprint-helpers";
import { calculateContribution } from "../economics";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildDefinitionSentence } from "../definition";
import { interviewClarificationSourceFingerprint } from "../types";
describe("AI Blueprint output contract", () => {
  it("accepts six grounded cards with distinct evidence labels", () => { const value = validBlueprint(); expect(validateAnalysisResult(value, completeAnswers(), [])).not.toBeNull(); expect(value.brief.evidence_and_open_questions.claims[0].evidence_basis).toBe("unknown"); expect(value.brief.why_firm_wants_work.claims[0].evidence_basis).toBe("firm_preference"); });
  it("reports only a safe field and rule when rejecting model output", () => { const failures: Array<{field:string;reason:string}> = []; const value = validBlueprint(); value.brief.client_and_matter.claims[0].text = "x".repeat(701); expect(validateAnalysisResult(value,completeAnswers(),[],failure=>failures.push(failure))).toBeNull(); expect(failures).toEqual([{field:"client_and_matter",reason:"statement_text_budget_or_format"}]); expect(JSON.stringify(failures)).not.toContain("x".repeat(701)); });
  it("reports recognized disallowed citation paths while keeping unknown paths and answer text out of diagnostics", () => { const answers=completeAnswers(), unknown=validBlueprint(), disallowed=validBlueprint(); unknown.brief.definition_components.client.source_answer_ids=["client.identity" as never]; disallowed.brief.definition_components.client.source_answer_ids=["practice.firm_type"]; const failures:Array<{field:string;reason:string;sourcePath?:string}>=[]; expect(validateAnalysisResult(unknown,answers,[],failure=>failures.push(failure))).toBeNull(); expect(failures.at(-1)).toEqual({field:"definition_components.client",reason:"source_answer_path_unrecognized"}); expect(validateAnalysisResult(disallowed,answers,[],failure=>failures.push(failure))).toBeNull(); expect(failures.at(-1)).toEqual({field:"definition_components.client",reason:"source_answer_path_not_allowed_for_slot",sourcePath:"practice.firm_type"}); expect(JSON.stringify(failures)).not.toContain("client.identity"); expect(JSON.stringify(failures)).not.toContain(answers.practice.firm_type); });
  it("rejects legacy answer-list schemas, extra keys, and wrong versions", () => { const good = validBlueprint(), answers = completeAnswers(); expect(validateAnalysisResult({ brief: { definition: {}, client_goals: [], firm_reasons: [], marketing: {} }, clarification_code: null }, answers, [])).toBeNull(); expect(validateAnalysisResult({ ...good, unexpected: true }, answers, [])).toBeNull(); expect(validateAnalysisResult({ ...good, brief: { ...good.brief, report_version: "dcm-blueprint-v1" } }, answers, [])).toBeNull(); });
  it("rejects unsupported citations and slot overflow, and replaces model sentence wording with the application formatter", () => { const answers = completeAnswers(), good = validBlueprint(); const fabricated = structuredClone(good); fabricated.brief.why_firm_wants_work.claims[0].source_answer_ids = ["focus.industry" as never]; expect(validateAnalysisResult(fabricated, answers, [])).toBeNull(); const sentence = structuredClone(good); sentence.brief.definition_sentence = "A conflicting sentence written by the model."; const checked=validateAnalysisResult(sentence, answers, []); expect(checked?.brief.definition_sentence).toBe(buildDefinitionSentence(sentence.brief,false,answers.client.goal_detail,answers.client.goals.includes("unknown"))); expect(checked?.brief.definition_sentence).not.toContain("progress will be assessed"); const long = structuredClone(good); long.brief.client_and_matter.claims[0].text = "x ".repeat(101); expect(validateAnalysisResult(long, answers, [])).toBeNull(); });
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
  it("accepts the structured economics summary when its cited fee and cost are adjacent numbers", () => {
    const answers = completeAnswers();
    answers.value.fee_amount = "8000"; answers.value.direct_cost_amount = "4800";
    answers.value.currency = "CAD"; answers.value.amount_basis = "estimated"; answers.value.amount_scope = "per_matter";
    const brief = buildStructuredBlueprintV4(answers);
    const economics = brief.why_firm_wants_work.claims.find((claim) => claim.text.startsWith("Matter economics supplied:"));
    expect(economics?.text).toContain("fee amount: 8000; direct cost amount: 4800");
    expect(economics?.text).toContain("estimated contribution before overhead and acquisition costs: $3,200.00");
    expect(economics && validateAnalysisResult({ brief, clarification_code: null }, answers, [])).not.toBeNull();
  });
  it("does not allow a positive contribution claim when the calculated result is negative",()=>{
    const answers=completeAnswers();
    Object.assign(answers.value,{fee_amount:"4800",direct_cost_amount:"8000",currency:"CAD",amount_basis:"recorded",amount_scope:"per_matter"});
    const result=validBlueprint();
    result.brief.why_firm_wants_work.claims=[evidence("Fees are worthwhile and support the effort.","firm_preference","value.reasons")];
    expect(validateAnalysisResult(result,answers,[])).toBeNull();
    result.brief.why_firm_wants_work.claims=[evidence("The contribution is $3,200.00 per matter.","firm_reported_recorded","value.fee_amount","value.direct_cost_amount","value.currency","value.amount_basis","value.amount_scope")];
    expect(validateAnalysisResult(result,answers,[])).toBeNull();
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
    result.brief.definition_sentence = `The firm wants to attract and serve ${result.brief.definition_components.client.text} for matters such as ${result.brief.definition_components.client_matter.text}, because ${result.brief.definition_components.reasons.text}, and progress will be assessed against ${result.brief.definition_components.outcome.text}.`;
    expect(result.brief.definition_sentence.split(/\s+/).length).toBeGreaterThan(85);
    expect(validateAnalysisResult(result, answers, [])).not.toBeNull();
  });
});
