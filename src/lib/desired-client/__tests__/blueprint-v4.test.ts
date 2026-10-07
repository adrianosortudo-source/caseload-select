import { describe, expect, it } from "vitest";
import { validateAnalysisResult } from "../output";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildDefinitionSentence } from "../definition";
import { buildDraftPreview } from "../brief";
import { completeAnswers, evidence, validBlueprint } from "./blueprint-helpers";
import { interviewClarificationSourceFingerprint } from "../types";
import { buildBlueprintViewModel, REPORT_EDIT_LINKS } from "../blueprint";
import { createHtmlDownload } from "../export";

describe("v4 provenance and client pathway", () => {
  it("keeps the law firm out of the desired-client identity and does not approve a target on wording review", () => {
    const result=validBlueprint();
    expect(result.brief.definition_components).not.toHaveProperty("firm");
    expect(result.brief.definition_sentence).toMatch(/^The firm wants to attract and serve an owner or founder on matters matching the firm's description:/);
    expect(buildDefinitionSentence(result.brief,true,completeAnswers().client.goal_detail)).toBe(buildDefinitionSentence(result.brief,false,completeAnswers().client.goal_detail));
    expect(result.brief.definition_sentence).toContain("with the intended client benefit described as “Understand the assets, liabilities and closing obligations before deciding whether to proceed”");
    expect(result.brief.definition_sentence).not.toContain("progress will be assessed");
  });
  it("requires the separate pathway and rejects an omitted stage", () => {
    const result=validBlueprint();
    const broken=structuredClone(result) as unknown as {brief:{decision_pathway:Record<string,unknown>}};
    delete broken.brief.decision_pathway.first_contact;
    expect(validateAnalysisResult(broken,completeAnswers(),[])).toBeNull();
  });
  it("maps report edit links to their matching interview stages", () => {
    expect(REPORT_EDIT_LINKS).toEqual([
      [1, "Edit practice"],
      [2, "Edit client and matter"],
      [3, "Edit value"],
      [4, "Edit firm fit"],
      [5, "Edit matter signals"],
      [6, "Edit opportunity and progress"],
    ]);
    expect(REPORT_EDIT_LINKS.find(([, label]) => label === "Edit opportunity and progress")?.[0]).toBe(6);
  });
  it("states negative unit economics as a condition without breaking the definition sentence", () => {
    const answers=completeAnswers();
    Object.assign(answers.value,{fee_amount:"4800",direct_cost_amount:"8000",currency:"CAD",amount_basis:"recorded",amount_scope:"per_matter"});
    const brief=buildStructuredBlueprintV4(answers);
    expect(brief.definition_sentence).toContain("because the firm's reported preference needs to be reconciled with the negative contribution");
    expect(brief.definition_sentence).not.toContain("the firm cites the firm's");
  });
  it("uses concise card headings while retaining the original report sections", () => {
    const answers=completeAnswers(), brief=buildStructuredBlueprintV4(answers);
    const view=buildBlueprintViewModel(brief,answers,{mode:"structured",generatedAt:"2026-10-01T12:00:00.000Z",wordingReviewed:false});
    expect(view.cards.map(card=>card.title)).toEqual([
      "Desired client and matter",
      "Client goals and needs",
      "Why this work",
      "Why clients choose the firm",
      "Matter signals",
      "Evidence & open questions",
    ]);
  });
  it("does not let client-choice feedback certify the decision pathway", () => {
    const a=completeAnswers(); a.client.choice_basis="client_feedback";
    let result=validBlueprint(a);
    result.brief.decision_pathway.trigger=evidence("Clients report a planned transaction.","client_reported","situation.trigger","client.choice_basis");
    expect(validateAnalysisResult(result,a,[])).toBeNull();
    a.client.pathway_basis="client_feedback";
    result=validBlueprint(a);
    result.brief.decision_pathway.trigger.source_answer_ids=["situation.trigger","client.pathway_basis"];
    expect(validateAnalysisResult(result,a,[])).not.toBeNull();
    a.client.choice_priorities=["clear_fees"];
    result=validBlueprint(a);
    result.brief.decision_pathway.trigger=evidence("Clients report a planned purchase and clear fees matter to them.","client_reported","situation.trigger","client.pathway_basis","client.choice_priorities","client.choice_basis");
    expect(validateAnalysisResult(result,a,[])).toBeNull();
  });
  it("does not let pathway observations certify client-choice factors", () => {
    const a=completeAnswers(); a.client.pathway_basis="firm_observation"; a.client.choice_detail="Clear explanations";
    let result=validBlueprint(a);
    result.brief.why_client_chooses_firm.claims=[evidence("Clients value clear explanations.","firm_reported_observation","client.choice_detail","client.pathway_basis")];
    expect(validateAnalysisResult(result,a,[])).toBeNull();
    a.client.choice_basis="firm_observation";
    result=validBlueprint(a);
    result.brief.why_client_chooses_firm.claims=[evidence("Clients value clear explanations.","firm_reported_observation","client.choice_detail","client.choice_basis")];
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
  it("carries a specific acquisition matter through preview, sentence and client-and-matter report", () => {
    const a=completeAnswers();
    a.client_context.geography="Ontario";
    a.client_context.repeat_matter_pattern="A buyer of an established operating business who needs an asset purchase agreement drafted or reviewed before final terms are agreed";
    a.client.goal_detail="Understand which assets and liabilities are included, what payment and closing obligations apply, and how contractual risks are allocated";
    const preview=buildDraftPreview(a);
    const blueprint=buildStructuredBlueprintV4(a);
    expect(preview.rows[0].value).toContain("asset purchase agreement");
    expect(blueprint.definition_sentence).toContain("asset purchase agreement drafted or reviewed");
    expect(blueprint.client_and_matter.claims[0].text).toContain("before final terms are agreed");
    expect(blueprint.client_goals_needs.claims.some(claim=>claim.text.includes("contractual risks are allocated"))).toBe(true);
  });
  it("keeps detailed client circumstances out of the concise identity and validates the full acquisition profile", () => {
    const a=completeAnswers();
    a.client_context.geography="Ontario";
    a.client_context.relevant_circumstances="The buyer has identified an operating business, is seeking acquisition counsel before signing final terms, and has draft financial and transaction information available for review.";
    a.client_context.repeat_matter_pattern="A buyer needs an asset purchase agreement drafted or reviewed before final terms are agreed, including advice on included assets and liabilities, payment and closing obligations, and allocation of contractual risks.";
    const brief=buildStructuredBlueprintV4(a);
    expect(brief.definition_components.client.text).toBe("an owner or founder in Ontario");
    // The fallback normalizes terminal punctuation when combining facts;
    // the complete circumstance must still appear without that final stop.
    expect(brief.recognizable_circumstances.claims[0].text).toContain(a.client_context.relevant_circumstances.replace(/[.!?]+$/u, ""));
    expect(validateAnalysisResult({brief,clarification_code:null},a,[])).not.toBeNull();
  });
  it("renders labelled fallback facts without joining full answers into broken sentences",()=>{
    const a=completeAnswers();
    a.client.goals=["complete"];
    a.client.goal_detail="Understand included assets and liabilities, payment terms and closing obligations.";
    a.client.decision_context="The owner decides and pays, with accountant input.";
    a.client.pathway_basis="firm_observation";
    a.practice.client_strength="matter_experience";
    a.practice.client_strength_effect="Explain included assets and liabilities. Clarify payment and closing obligations.";
    a.practice.client_strength_support="12 comparable matters in the last year.";
    Object.assign(a.opportunity,{period:"Last 12 months",enquiry_count:"20",retained_count:"12",conversion:"60%",data_basis:"recorded",source_detail:"Comparable acquisitions."});
    const brief=buildStructuredBlueprintV4(a);
    const prose=JSON.stringify(brief);
    expect(prose).toContain("Client goal: Complete a planned transaction or process. Practical benefit sought: Understand included assets and liabilities, payment terms and closing obligations.");
    expect(prose).toContain("Firm-selected strength: Relevant matter experience. Practical effect described by the firm: Explain included assets and liabilities. Clarify payment and closing obligations.");
    expect(prose).toContain("Comparable enquiries: 20; Retained matters: 12; Reported conversion: 60%");
    expect(prose).not.toContain("obligations..");
    expect(prose).not.toContain("input..");
    expect(prose).not.toContain("The client is seeking Complete");
    expect(validateAnalysisResult({brief,clarification_code:null},a,[])).not.toBeNull();
    const saved={brief,sourceAnswersVersion:"dcm-v3.3" as const,sourceAnswersSnapshot:structuredClone(a),sourceBriefRevision:a.revision,generatedAt:"2026-10-05T12:00:00.000Z",wordingReviewed:false,mode:"structured" as const};
    const html=createHtmlDownload(saved,a,new Date(2026,9,5)).content;
    expect(html).toContain("Comparable enquiries: 20; Retained matters: 12; Reported conversion: 60%");
    expect(html).not.toContain("obligations..");
  });
  it("keeps a long accepted geography in recognition detail without breaking the client identity",()=>{
    const a=completeAnswers();
    a.client_context.geography="All of Ontario, including Toronto, Ottawa, London, Hamilton, Windsor, Kingston, Kitchener, Waterloo, Guelph, Cambridge, Brampton, Mississauga, Burlington, Oakville, Barrie and surrounding rural communities";
    const brief=buildStructuredBlueprintV4(a);
    expect(brief.definition_components.client.text.split(/\s+/u).length).toBeLessThanOrEqual(25);
    expect(brief.definition_components.client.text).toBe("an owner or founder");
    expect(brief.recognizable_circumstances.claims[0].text).toContain(a.client_context.geography);
    expect(validateAnalysisResult({brief,clarification_code:null},a,[])).not.toBeNull();
  });
  it("uses community focus to describe whom the firm serves",()=>{
    const a=completeAnswers();
    a.client_context.community_focus="Brazilian entrepreneurs";
    const brief=buildStructuredBlueprintV4(a);
    expect(brief.definition_components.client.text).toBe("an owner or founder from the Brazilian entrepreneurs community");
    expect(brief.definition_components.client.text).not.toContain("serving the Brazilian entrepreneurs community");
    expect(validateAnalysisResult({brief,clarification_code:null},a,[])).not.toBeNull();
  });
  it("keeps an unknown client role explicit and grammatically complete",()=>{
    const a=completeAnswers();
    a.situation.role="unknown";
    const brief=buildStructuredBlueprintV4(a);
    expect(brief.definition_sentence).toContain("attract and serve a client group the firm has not yet defined on matters matching");
    expect(brief.definition_sentence).not.toContain("the specific kind of client the firm wants to attract has not yet been defined on matters");
    expect(validateAnalysisResult({brief,clarification_code:null},a,[])).not.toBeNull();
  });
  it("keeps the generated opening definition concise and separates the progress measure", () => {
    const a=completeAnswers();
    const b=buildStructuredBlueprintV4(a);
    expect(validateAnalysisResult({brief:b,clarification_code:null},a,[])).not.toBeNull();
    expect(b.definition_sentence.split(/\s+/).length).toBeLessThanOrEqual(85);
    expect(b.definition_sentence).toContain("on matters matching the firm's description: “A business buyer");
    expect(b.definition_sentence).toContain("because the firm cites");
    expect(b.definition_sentence).toContain("with the intended client benefit described as “Understand the assets, liabilities and closing obligations before deciding whether to proceed”");
    expect(b.definition_sentence).not.toContain("retained matters");
  });
  it("keeps the complete maximum-length matter answer in supporting detail while producing a valid bounded definition",()=>{
    const a=completeAnswers();
    a.client_context.repeat_matter_pattern=`A buyer of an established operating business needs an asset purchase agreement drafted or reviewed before agreeing to final terms. ${"The buyer also needs advice on due diligence, excluded assets, assumed liabilities, payment mechanics, closing conditions and allocation of contractual risk. ".repeat(5)}`.slice(0,600);
    const brief=buildStructuredBlueprintV4(a);
    expect(brief.definition_components.client_matter.text.length).toBeLessThanOrEqual(600);
    expect(brief.client_and_matter.claims[0].text.length).toBeLessThanOrEqual(700);
    expect(buildBlueprintViewModel(brief,a,{mode:"structured",generatedAt:"2026-10-01T12:00:00.000Z",wordingReviewed:false}).allAnswers.some(row=>row.answer===a.client_context.repeat_matter_pattern)).toBe(true);
    expect(validateAnalysisResult({brief,clarification_code:null},a,[])).not.toBeNull();
  });
  it("keeps negative contribution prominent and prevents a positive-value claim from overriding it",()=>{
    const a=completeAnswers();
    a.value.fee_amount="4800"; a.value.direct_cost_amount="8000"; a.value.currency="CAD"; a.value.amount_scope="per_matter"; a.value.amount_basis="estimated";
    const brief=buildStructuredBlueprintV4(a);
    expect(brief.definition_components.reasons.text).toContain("negative contribution");
    const view=buildBlueprintViewModel(brief,a,{mode:"structured",generatedAt:"2026-10-01T12:00:00.000Z",wordingReviewed:false});
    expect(view.conditions.some(condition=>condition.includes("negative contribution of"))).toBe(true);
    const unsupported=validBlueprint();
    unsupported.brief.why_firm_wants_work.claims[0].text="These fees are worthwhile and support a positive contribution.";
    unsupported.brief.why_firm_wants_work.claims[0].source_answer_ids=["value.fee_amount","value.direct_cost_amount","value.currency","value.amount_basis","value.amount_scope"];
    expect(validateAnalysisResult(unsupported,a,[])).toBeNull();
  });
  it("explains when the firm's fee-support preference conflicts with negative contribution",()=>{
    const a=completeAnswers();
    a.value.reasons=["client_benefit","fees","skills"];
    a.value.fee_amount="8000"; a.value.direct_cost_amount="8500"; a.value.currency="CAD"; a.value.amount_scope="per_matter"; a.value.amount_basis="recorded";
    const brief=buildStructuredBlueprintV4(a);
    const view=buildBlueprintViewModel(brief,a,{mode:"structured",generatedAt:"2026-10-01T12:00:00.000Z",wordingReviewed:false});
    expect(view.conditions.some(condition=>condition.includes("selected fee sustainability as a reason")&&condition.includes("negative contribution of −C$500.00"))).toBe(true);
    expect(view.definition).toContain("preference needs to be reconciled with the negative contribution");
  });
  it("retains a fully populated commercial and delivery fixture within every six-claim section",()=>{
    const a=completeAnswers();
    a.value.reasons=["client_benefit","fees","skills"];
    Object.assign(a.value,{fee_effort:"worthwhile",collected_fee:"15to50",team_hours:"16to40",payment:"predictable",payment_context:"Most buyers paid the first invoice within 15 days.",payment_context_basis:"firm_observation",currency:"CAD",fee_amount:"25000",direct_cost_amount:"12000",amount_basis:"recorded",amount_scope:"per_matter"});
    a.practice.experience="regular";
    Object.assign(a.delivery,{capacity:"room"});
    Object.assign(a.repeatability,{target:"2 additional retained matters per quarter",review_period:"quarterly",additional_matters:"2",staffing_constraint:"One associate has room for two more matters."});
    const brief=buildStructuredBlueprintV4(a);
    const cards=[brief.client_and_matter,brief.client_goals_needs,brief.why_firm_wants_work,brief.why_client_chooses_firm,brief.recognizable_circumstances,brief.evidence_and_open_questions];
    const text=cards.flatMap(card=>card.claims).map(claim=>claim.text).join(" ");
    expect(brief.why_firm_wants_work.claims.length).toBeLessThanOrEqual(7);
    expect(brief.client_and_matter.claims.length).toBeLessThanOrEqual(6);
    expect(brief.client_goals_needs.claims.length).toBeLessThanOrEqual(6);
    expect(brief.why_client_chooses_firm.claims.length).toBeLessThanOrEqual(6);
    expect(brief.recognizable_circumstances.claims.length).toBeLessThanOrEqual(6);
    expect(brief.evidence_and_open_questions.claims.length).toBeLessThanOrEqual(6);
    for(const detail of ["25000","12000","C$15,000 to under C$50,000","More than 15, up to 40 hours","payment is usually predictable","Most buyers paid the first invoice within 15 days","Yes, with the current team","2 additional retained matters per quarter","One associate has room for two more matters"]){
      expect(JSON.stringify(brief)).toContain(detail);
    }
    expect(text).toContain("One associate has room for two more matters");
    const capacityClaim=brief.why_firm_wants_work.claims.find(claim=>claim.source_answer_ids.includes("delivery.capacity"));
    expect(capacityClaim?.evidence_basis).toBe("firm_reported_observation");
    expect(capacityClaim?.source_answer_ids).toContain("repeatability.additional_matters");
    const staffingClaim=brief.why_firm_wants_work.claims.find(claim=>claim.source_answer_ids.includes("repeatability.staffing_constraint"));
    expect(staffingClaim?.evidence_basis).toBe("firm_preference");
  });
  it("labels clarification answers by the kind of information they contribute", () => {
    const a=completeAnswers();
    a.interview.followups=[
      {id:"11111111-1111-4111-8111-111111111111",stage:3,purpose:"firm_desirability",source_answer_ids:["value.reasons"],question:"Why does the firm want this work?",answer:"It lets us use our transaction experience.",skipped:false,reflection:"",source_answer_fingerprint:interviewClarificationSourceFingerprint(a,["value.reasons"])},
      {id:"22222222-2222-4222-8222-222222222222",stage:6,purpose:"discovery_evidence",source_answer_ids:["opportunity.sources"],question:"How do clients seek help?",answer:"They often ask their accountant first.",skipped:false,reflection:"",source_answer_fingerprint:interviewClarificationSourceFingerprint(a,["opportunity.sources"])},
    ];
    const b=buildStructuredBlueprintV4(a);
    expect(b.why_firm_wants_work.claims.some(claim=>claim.text.includes("It lets us use our transaction experience.")&&claim.evidence_basis==="firm_preference")).toBe(true);
    expect(b.evidence_and_open_questions.claims.some(claim=>claim.text.includes("They often ask their accountant first.")&&claim.evidence_basis==="hypothesis")).toBe(true);
  });
  it("excludes a follow-up after its cited answer changes but keeps it after unrelated edits",()=>{
    const a=completeAnswers();
    a.interview.followups=[{id:"11111111-1111-4111-8111-111111111111",stage:3,purpose:"firm_desirability",source_answer_ids:["value.reasons"],question:"Why does the firm want this work?",answer:"We enjoy the strategic work.",skipped:false,source_answer_fingerprint:interviewClarificationSourceFingerprint(a,["value.reasons"])}];
    a.practice.enjoys="We value technically complex work";
    expect(JSON.stringify(buildStructuredBlueprintV4(a))).toContain("We enjoy the strategic work.");
    a.value.reasons=["client_benefit"];
    expect(JSON.stringify(buildStructuredBlueprintV4(a))).not.toContain("We enjoy the strategic work.");
  });
});
