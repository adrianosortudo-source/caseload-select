import { describe, expect, it } from "vitest";
import { validateAnalysisResult } from "../output";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildDefinitionSentence } from "../definition";
import { completeAnswers, evidence, validBlueprint } from "./blueprint-helpers";

describe("v4 provenance and client pathway", () => {
  it("keeps the law firm out of the desired-client identity and does not approve a target on wording review", () => {
    const result=validBlueprint();
    expect(result.brief.definition_components).not.toHaveProperty("firm");
    expect(result.brief.definition_sentence).toMatch(/^The firm wants to attract and serve business owners seeking/);
    expect(buildDefinitionSentence(result.brief,true)).toBe(buildDefinitionSentence(result.brief,false));
    expect(result.brief.definition_sentence).toContain("proposed");
  });
  it("requires the separate pathway and rejects an omitted stage", () => {
    const result=validBlueprint();
    const broken=structuredClone(result) as unknown as {brief:{decision_pathway:Record<string,unknown>}};
    delete broken.brief.decision_pathway.first_contact;
    expect(validateAnalysisResult(broken,completeAnswers(),[])).toBeNull();
  });
  it("does not let client-choice feedback certify the decision pathway", () => {
    const a=completeAnswers(); a.client.choice_basis="client_feedback";
    const result=validBlueprint();
    result.brief.decision_pathway.trigger=evidence("Clients report a planned transaction.","client_reported","situation.trigger","client.choice_basis");
    expect(validateAnalysisResult(result,a,[])).toBeNull();
    a.client.pathway_basis="client_feedback";
    result.brief.decision_pathway.trigger.source_answer_ids=["situation.trigger","client.pathway_basis"];
    expect(validateAnalysisResult(result,a,[])).not.toBeNull();
  });
  it("does not let pathway observations certify client-choice factors", () => {
    const a=completeAnswers(); a.client.pathway_basis="firm_observation";
    const result=validBlueprint();
    result.brief.why_client_chooses_firm.claims=[evidence("Clients value clear explanations.","firm_reported_observation","client.choice_detail","client.pathway_basis")];
    a.client.choice_detail="Clear explanations";
    expect(validateAnalysisResult(result,a,[])).toBeNull();
    a.client.choice_basis="firm_observation";
    result.brief.why_client_chooses_firm.claims[0].source_answer_ids=["client.choice_detail","client.choice_basis"];
    expect(validateAnalysisResult(result,a,[])).not.toBeNull();
  });
  it("rejects invented numbers and no-evidence presented as observed demand", () => {
    const a=completeAnswers(), result=validBlueprint();
    result.brief.why_firm_wants_work.claims[0].text="The firm has 20 years of experience.";
    expect(validateAnalysisResult(result,a,[])).toBeNull();
    a.opportunity.sources=["no_evidence"];
    const other=validBlueprint();
    other.brief.evidence_and_open_questions.claims=[evidence("Observed demand exists.","source_observed","opportunity.sources")];
    expect(validateAnalysisResult(other,a,[])).toBeNull();
  });
  it("preserves supplied economics, delivery needs and discovery detail in fallback", () => {
    const a=completeAnswers();
    a.value.fee_amount="18000"; a.value.direct_cost_amount="9000"; a.value.currency="CAD"; a.value.amount_basis="estimated"; a.value.amount_scope="per_matter";
    a.value.team_hours="16to40"; a.value.payment="varies"; a.practice.development_needs=["support"];
    a.repeatability.staffing_constraint="Reserve associate time"; a.client_context.discovery_behaviour="Buyers speak to their accountant";
    const b=buildStructuredBlueprintV4(a), text=JSON.stringify(b);
    expect(b.definition_sentence).not.toBe("");
    expect(text).toContain("18000"); expect(text).toContain("9000"); expect(text).toContain("Reserve associate time");
    expect(b.why_firm_wants_work.claims.some(s=>s.evidence_basis==="firm_reported_estimate")).toBe(true);
    expect(b.recognizable_circumstances.claims.some(s=>s.text.includes("Buyers speak to their accountant"))).toBe(true);
  });
  it("keeps the generated opening definition concise and states a useful measure", () => {
    const a=completeAnswers();
    const b=buildStructuredBlueprintV4(a);
    expect(validateAnalysisResult({brief:b,clarification_code:null},a,[])).not.toBeNull();
    expect(b.definition_sentence.split(/\s+/).length).toBeLessThanOrEqual(85);
    expect(b.definition_sentence).toContain("seeking legal help with");
    expect(b.definition_sentence).toContain("because the firm cites");
    expect(b.definition_sentence).toContain("a measure of retained matters");
  });
  it("labels clarification answers by the kind of information they contribute", () => {
    const a=completeAnswers();
    a.interview.followups=[
      {id:"11111111-1111-4111-8111-111111111111",stage:3,purpose:"firm_desirability",source_answer_ids:["value.reasons"],question:"Why does the firm want this work?",answer:"It lets us use our transaction experience.",skipped:false,reflection:""},
      {id:"22222222-2222-4222-8222-222222222222",stage:6,purpose:"discovery_evidence",source_answer_ids:["opportunity.sources"],question:"How do clients seek help?",answer:"They often ask their accountant first.",skipped:false,reflection:""},
    ];
    const b=buildStructuredBlueprintV4(a);
    expect(b.why_firm_wants_work.claims.some(claim=>claim.text.includes("It lets us use our transaction experience.")&&claim.evidence_basis==="firm_preference")).toBe(true);
    expect(b.evidence_and_open_questions.claims.some(claim=>claim.text.includes("They often ask their accountant first.")&&claim.evidence_basis==="hypothesis")).toBe(true);
  });
});
