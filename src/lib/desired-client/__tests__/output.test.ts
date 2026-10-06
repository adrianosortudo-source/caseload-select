import { describe, expect, it } from "vitest";
import { validateAnalysisResult } from "../output";
import { completeAnswers, validBlueprint } from "./blueprint-helpers";
import { evidence } from "./blueprint-helpers";
import { calculateContribution } from "../economics";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildDefinitionSentence } from "../definition";
import { interviewClarificationSourceFingerprint } from "../types";
import { validateDraftAnswers } from "../validation";
describe("AI Blueprint output contract", () => {
  it("joins model fragments without repeating because or capitalizing a mid-sentence article", () => {
    const value = validBlueprint();
    value.brief.definition_components.client.text = "An Ontario business owner";
    value.brief.definition_components.reasons.text = "The firm wants this work because it fits the team's transaction experience";
    const sentence = buildDefinitionSentence(value.brief, false);
    expect(sentence).toContain("attract and serve an Ontario business owner");
    expect(sentence).toContain("because the work fits the team's transaction experience");
    expect(sentence).not.toContain("because The firm wants");
    value.brief.definition_components.reasons.text = "The work fits the team's transaction experience";
    expect(buildDefinitionSentence(value.brief, false)).toContain("because the work fits");
  });
  it("adds an article when a client type starts with a singular role", () => {
    const value = validBlueprint();
    value.brief.definition_components.client.text = "Owner or founder of an Ontario owner-managed company";
    expect(buildDefinitionSentence(value.brief, false)).toContain("serve an owner or founder of an Ontario owner-managed company");
  });
  it("joins a complete client-matter clause grammatically", () => {
    const value = validBlueprint();
    value.brief.definition_components.client_matter.text = "The client is evaluating an operating business and needs an asset purchase agreement drafted or reviewed before final terms are agreed";
    value.brief.definition_components.reasons.text = "It makes a useful difference and fits the firm's experience";
    const sentence = buildDefinitionSentence(value.brief, false, completeAnswers().client.goal_detail);
    expect(sentence).toContain("on matters matching the firm's description: “The client is evaluating");
    expect(sentence).toContain("because the work makes a useful difference");
    expect(sentence).not.toContain("in a situation where");
  });
  it("does not repeat the same decision endpoint in the appended practical benefit", () => {
    const value = validBlueprint();
    value.brief.definition_components.client_matter.text = "The client has identified an operating business and needs an asset purchase agreement drafted or reviewed, due diligence advised, and transaction terms negotiated before deciding whether to proceed";
    const sentence = buildDefinitionSentence(value.brief, false, "Understand which assets and liabilities are included, clarify payment and closing obligations, and negotiate how contractual risks are allocated before deciding whether to proceed");
    expect(sentence.match(/\bbefore\b[^.!?]*\bdecid\w*\b[^.!?]*\bproceed\b/gi)).toHaveLength(1);
    expect(sentence).toContain("negotiate how contractual risks are allocated");
  });
  it("rejects a client or engagement that is not the target confirmed in the firm's answers", () => {
    const answers = completeAnswers();
    const rejected: Array<{ field: string; reason: string }> = [];
    const unsupportedClient = validBlueprint(answers);
    unsupportedClient.brief.definition_components.client.text = "Canadian billionaires";
    expect(validateAnalysisResult(unsupportedClient, answers, [], failure => rejected.push(failure))).toBeNull();
    expect(rejected.at(-1)).toEqual({ field: "definition_components", reason: "target_not_grounded_in_confirmed_answers" });

    const unsupportedMatter = validBlueprint(answers);
    unsupportedMatter.brief.definition_components.client_matter.text = "seeking leveraged buyout advice";
    expect(validateAnalysisResult(unsupportedMatter, answers, [])).toBeNull();

    const unsupportedCard = validBlueprint(answers);
    unsupportedCard.brief.client_and_matter.claims[0] = evidence("Canadian billionaires seek leveraged buyout advice.", "hypothesis", "focus.work");
    expect(validateAnalysisResult(unsupportedCard, answers, [])).toBeNull();

    const appendedTarget = validBlueprint(answers);
    appendedTarget.brief.client_and_matter.claims.push(evidence("Canadian billionaires seek leveraged buyout advice.", "hypothesis", "focus.work"));
    expect(validateAnalysisResult(appendedTarget, answers, [])).toBeNull();
  });
  it("accepts a more specific target once the firm supplies it", () => {
    const answers = completeAnswers();
    answers.situation.role = "other";
    answers.situation.role_other = "Canadian billionaires";
    answers.client_context.repeat_matter_pattern = "A Canadian billionaire preparing a leveraged buyout who needs acquisition counsel before final terms are agreed.";
    expect(validateAnalysisResult(validBlueprint(answers), answers, [])).not.toBeNull();
  });
  it("accepts a digit rendering of a cited written-out count but rejects a changed value", () => {
    const answers = completeAnswers();
    answers.repeatability.target = "Proposed target: two additional retained buyer-side acquisition matters per quarter.";
    const value = validBlueprint();
    value.brief.evidence_and_open_questions.claims = [evidence("The proposed target of 2 additional retained buyer-side acquisition matters per quarter needs firm approval.", "firm_preference", "repeatability.target")];
    expect(validateAnalysisResult(value, answers, [])).not.toBeNull();
    value.brief.evidence_and_open_questions.claims[0] = evidence("The proposed target of 3 additional retained buyer-side acquisition matters per quarter needs firm approval.", "firm_preference", "repeatability.target");
    expect(validateAnalysisResult(value, answers, [])).toBeNull();
  });
  it("preserves payment answers as an observation, a testable hypothesis, or an unknown", () => {
    const answers=completeAnswers();
    answers.value.payment="predictable";
    const ai=validBlueprint(answers);
    ai.brief.why_firm_wants_work.claims.push(evidence("Payment timing is usually predictable.","firm_reported_observation","value.payment"));
    const result=validateAnalysisResult(ai,answers,[]);
    expect(result).not.toBeNull();
    const recorded=result!.brief.why_firm_wants_work.claims.find((claim)=>claim.source_answer_ids.includes("value.payment"));
    expect(recorded?.evidence_basis).toBe("firm_reported_observation");
    expect(recorded?.text).toContain("Basis not specified.");
    expect(recorded?.text).not.toContain("timing is usually predictable");

    const fabricated = validBlueprint(answers);
    fabricated.brief.why_firm_wants_work.claims.push(evidence("Payment records prove all clients pay on time.","firm_reported_observation","value.payment"));
    expect(validateAnalysisResult(fabricated, answers, [])).toBeNull();

    answers.focus.route="new";
    const newWork=validateAnalysisResult(validBlueprint(answers),answers,[]);
    const hypothesis=newWork!.brief.why_firm_wants_work.claims.find((claim)=>claim.source_answer_ids.includes("value.payment"));
    expect(hypothesis?.evidence_basis).toBe("hypothesis");
    expect(hypothesis?.text).toContain("Working assumption to test");

    answers.value.payment="unknown";
    const unknown=validateAnalysisResult(validBlueprint(answers),answers,[]);
    const unresolved=unknown!.brief.why_firm_wants_work.claims.find((claim)=>claim.source_answer_ids.includes("value.payment"));
    expect(unresolved?.evidence_basis).toBe("unknown");
    expect(unresolved?.text).toContain("Basis not specified.");
  });
  it("distinguishes an omitted payment-context basis from an explicit unknown basis",()=>{
    const answers=completeAnswers();
    answers.value.payment_context="The client paid the initial retainer promptly.";
    answers.value.payment_context_basis=null;
    const unspecified=buildStructuredBlueprintV4(answers).why_firm_wants_work.claims.find(claim=>claim.source_answer_ids.includes("value.payment_context"));
    expect(unspecified?.text).toContain("Basis not specified.");
    answers.value.payment_context_basis="unknown";
    const unknown=buildStructuredBlueprintV4(answers).why_firm_wants_work.claims.find(claim=>claim.source_answer_ids.includes("value.payment_context"));
    expect(unknown?.text).toContain("Not established.");
    expect(unknown?.text).not.toContain("Basis not specified.");
  });
  it("rejects negated payment meaning and timing before canonical recovery", () => {
    const answers = completeAnswers();
    answers.value.payment = "predictable";
    answers.value.payment_context = "Clients told the firm that the first invoice was usually paid on schedule.";
    answers.value.payment_context_basis = "client_feedback";

    const positiveContext = validBlueprint(answers);
    positiveContext.brief.why_firm_wants_work.claims = [evidence(
      "Clients said the first invoice was usually paid on time.",
      "client_reported",
      "value.payment_context",
      "value.payment_context_basis",
    )];
    expect(validateAnalysisResult(positiveContext, answers, [])).not.toBeNull();

    const negatedContext = validBlueprint(answers);
    negatedContext.brief.why_firm_wants_work.claims = [evidence(
      "Clients said the first invoice was not usually paid on time.",
      "client_reported",
      "value.payment_context",
      "value.payment_context_basis",
    )];
    expect(validateAnalysisResult(negatedContext, answers, [])).toBeNull();

    const positivePayment = validBlueprint(answers);
    positivePayment.brief.why_firm_wants_work.claims = [evidence(
      "Payment is usually predictable.",
      "firm_reported_observation",
      "value.payment",
    )];
    expect(validateAnalysisResult(positivePayment, answers, [])).not.toBeNull();

    const negatedPayment = validBlueprint(answers);
    negatedPayment.brief.why_firm_wants_work.claims = [evidence(
      "Payment is not predictable.",
      "firm_reported_observation",
      "value.payment",
    )];
    expect(validateAnalysisResult(negatedPayment, answers, [])).toBeNull();
  });
  it("recovers mixed payment and experience claims as separate statements with their own evidence categories", () => {
    const answers = completeAnswers();
    answers.value.payment = "predictable";
    const result = validBlueprint(answers);
    result.brief.why_firm_wants_work.claims = [evidence(
      "The firm reports payment is usually predictable and handles this work regularly.",
      "firm_reported_observation",
      "value.payment",
      "practice.experience",
    ), evidence("The firm handles this work regularly.", "firm_reported_experience", "practice.experience")];
    const validated = validateAnalysisResult(result, answers, []);
    expect(validated).not.toBeNull();
    const recovered = validated!.brief.why_firm_wants_work.claims;
    const payment = recovered.find(claim => claim.source_answer_ids.includes("value.payment"));
    const experience = recovered.find(claim => claim.source_answer_ids.includes("practice.experience"));
    expect(payment).toMatchObject({ evidence_basis: "firm_reported_observation", source_answer_ids: ["value.payment"] });
    expect(payment?.text).toContain("payment is usually predictable");
    expect(experience).toMatchObject({ evidence_basis: "firm_reported_experience" });
    expect(experience?.source_answer_ids).toContain("practice.experience");
    expect(experience?.source_answer_ids).not.toContain("value.payment");
    expect(recovered.some(claim => claim.source_answer_ids.includes("value.payment") && claim.source_answer_ids.includes("practice.experience"))).toBe(false);
    expect(recovered.filter(claim => claim.source_answer_ids.includes("practice.experience"))).toHaveLength(1);
  });
  it("accepts current capacity as a firm-reported observation and keeps staffing change as preference", () => {
    const answers = completeAnswers();
    answers.repeatability.additional_matters = "2 comparable matters per quarter";
    answers.repeatability.staffing_constraint = "An associate must be hired before increasing volume.";
    const brief = buildStructuredBlueprintV4(answers);
    const capacity = brief.why_firm_wants_work.claims.find(claim => claim.source_answer_ids.includes("repeatability.additional_matters"));
    const staffing = brief.why_firm_wants_work.claims.find(claim => claim.source_answer_ids.includes("repeatability.staffing_constraint"));
    expect(capacity).toMatchObject({ evidence_basis: "firm_reported_observation", kind: "experience" });
    expect(staffing).toMatchObject({ evidence_basis: "firm_preference", kind: "preference" });
    expect(validateAnalysisResult({ brief, clarification_code: null }, answers, [])).not.toBeNull();
  });
  it("keeps established and new routes within the firm-value claim budget while preserving capacity provenance", () => {
    for (const route of ["established", "new"] as const) {
      const answers = completeAnswers();
      answers.focus.route = route;
      answers.value.reasons = ["client_benefit", "fees", "skills"];
      Object.assign(answers.value, {
        fee_effort: "worthwhile",
        collected_fee: "15to50",
        team_hours: "16to40",
        payment: "predictable",
        payment_context: "The firm observed that comparable buyers usually paid the first invoice within 15 days.",
        payment_context_basis: "firm_observation",
        currency: "CAD",
        fee_amount: "25000",
        direct_cost_amount: "12000",
        amount_basis: "recorded",
        amount_scope: "per_matter",
      });
      Object.assign(answers.delivery, { capacity: "room" });
      Object.assign(answers.repeatability, {
        target: "2 additional retained matters per quarter",
        review_period: "quarterly",
        additional_matters: "2 comparable matters per quarter",
        staffing_constraint: "An associate must be hired before increasing volume.",
      });
      if (route === "new") {
        answers.practice.experience = "new";
        answers.practice.direction = "explore_direction";
        answers.interview.clarification_count = 1;
        answers.interview.clarified_stages = [3];
        answers.interview.followups = [{
          id: "44444444-4444-4444-8444-444444444444",
          stage: 3,
          purpose: "firm_desirability",
          source_answer_ids: ["value.reasons"],
          source_answer_fingerprint: interviewClarificationSourceFingerprint(answers, ["value.reasons"]),
          question: "Why does the firm want this work?",
          answer: "The team enjoys the strategic work and wants to test repeatable demand.",
          skipped: false,
        }];
      }

      const brief = buildStructuredBlueprintV4(answers);
      expect(brief.why_firm_wants_work.claims.length).toBeLessThanOrEqual(7);
      const capacity = brief.why_firm_wants_work.claims.find(claim => claim.source_answer_ids.includes("repeatability.additional_matters"));
      expect(capacity?.evidence_basis).toBe("firm_reported_observation");
      expect(capacity?.source_answer_ids).toContain("delivery.capacity");
      const staffing = brief.why_firm_wants_work.claims.find(claim => claim.source_answer_ids.includes("repeatability.staffing_constraint"));
      expect(staffing?.evidence_basis).toBe("firm_preference");
      if (route === "new") expect(JSON.stringify(brief)).toContain("The team enjoys the strategic work and wants to test repeatable demand.");
      expect(validateDraftAnswers(answers)).toBe(true);
      expect(validateAnalysisResult({ brief, clarification_code: null }, answers, [])).not.toBeNull();
    }
  });
  it("keeps an unresolved rationale separate from a current capacity preference", () => {
    const answers = completeAnswers();
    answers.value.reasons = ["undecided"];
    answers.value.fee_effort = "unknown";
    answers.practice.enjoys = "";
    answers.repeatability.additional_matters = "2 comparable matters per quarter";
    answers.repeatability.staffing_constraint = "An associate must be hired before increasing volume.";
    const brief = buildStructuredBlueprintV4(answers);
    const rationale = brief.why_firm_wants_work.claims[0];
    const staffing = brief.why_firm_wants_work.claims.find(claim => claim.source_answer_ids.includes("repeatability.staffing_constraint"));
    expect(rationale.source_answer_ids.length).toBeGreaterThan(0);
    expect(rationale.evidence_basis).toBe("unknown");
    expect(staffing).toMatchObject({ evidence_basis: "firm_preference", kind: "preference" });
    expect(validateAnalysisResult({ brief, clarification_code: null }, answers, [])).not.toBeNull();
  });
  it("fits all supplied commercial and capacity facts into the six-claim limit without losing provenance",()=>{
    const answers=completeAnswers();
    answers.value.reasons=["client_benefit","fees","skills"];
    Object.assign(answers.value,{fee_effort:"worthwhile",collected_fee:"15to50",team_hours:"16to40",payment:"predictable",payment_context:"Most buyers paid the first invoice within 15 days.",payment_context_basis:"firm_observation",currency:"CAD",fee_amount:"25000",direct_cost_amount:"12000",amount_basis:"recorded",amount_scope:"per_matter"});
    Object.assign(answers.delivery,{capacity:"room"});
    Object.assign(answers.repeatability,{target:"2 additional retained matters per quarter",review_period:"quarterly",additional_matters:"2",staffing_constraint:"One associate has room for two more matters."});
    const built=buildStructuredBlueprintV4(answers);
    expect(built.why_firm_wants_work.claims.length).toBeLessThanOrEqual(7);
    const payment=built.why_firm_wants_work.claims.find(claim=>claim.source_answer_ids.includes("value.payment"));
    expect(payment?.source_answer_ids).toEqual(["value.payment","value.payment_context","value.payment_context_basis"]);
    expect(payment?.text).toContain("Most buyers paid the first invoice within 15 days.");
    expect(payment?.text).toContain("payment is usually predictable");
    const validated=validateAnalysisResult(validBlueprint(answers),answers,[]);
    expect(validated).not.toBeNull();
    const all=JSON.stringify(validated);
    for(const source of ["value.payment","value.payment_context","value.payment_context_basis","value.fee_amount","value.direct_cost_amount","value.collected_fee","value.team_hours","delivery.capacity","repeatability.target","repeatability.staffing_constraint"]){expect(all).toContain(source);}
  });
  it("keeps a full commercial fixture valid when payment context has a different evidence basis",()=>{
    for(const basis of [null,"unknown","client_feedback","firm_hypothesis"] as const){
      const answers=completeAnswers();
      answers.value.reasons=["client_benefit","fees","skills"];
      Object.assign(answers.value,{fee_effort:"worthwhile",collected_fee:"15to50",team_hours:"16to40",payment:"predictable",payment_context:"In our last ten comparable engagements, payment was usually received on schedule.",payment_context_basis:basis,currency:"CAD",fee_amount:"8000",direct_cost_amount:"8500",amount_basis:"recorded",amount_scope:"per_matter"});
      answers.practice.experience="regular";
      Object.assign(answers.delivery,{capacity:"room"});
      Object.assign(answers.repeatability,{target:"2 additional retained matters per quarter",review_period:"quarterly",additional_matters:"2",staffing_constraint:"One associate has room for two more matters."});
      const built=buildStructuredBlueprintV4(answers);
      expect(built.why_firm_wants_work.claims.length).toBeLessThanOrEqual(7);
      expect(validateAnalysisResult({brief:built,clarification_code:null},answers,[])).not.toBeNull();
      const serialized=JSON.stringify(built);
      for(const source of ["value.payment","value.payment_context","value.payment_context_basis","value.fee_amount","value.direct_cost_amount","value.collected_fee","value.team_hours","delivery.capacity","repeatability.target"]){expect(serialized).toContain(source);}
      expect(serialized).toContain("In our last ten comparable engagements, payment was usually received on schedule.");
    }
  });
  it("accepts seven firm-value claims but rejects an eighth",()=>{
    const answers=completeAnswers();
    answers.focus.route="new";
    answers.practice.experience="new";
    answers.practice.direction="explore_direction";
    answers.value.reasons=["client_benefit","fees","skills"];
    Object.assign(answers.value,{fee_effort:"worthwhile",collected_fee:"15to50",team_hours:"16to40",payment:"predictable",payment_context:"Payment was usually received on schedule.",payment_context_basis:null,currency:"CAD",fee_amount:"8000",direct_cost_amount:"8500",amount_basis:"recorded",amount_scope:"per_matter"});
    Object.assign(answers.delivery,{capacity:"room"});
    Object.assign(answers.repeatability,{target:"2 additional retained matters per quarter",review_period:"quarterly",additional_matters:"2",staffing_constraint:"One associate has room for two more matters."});
    const built=buildStructuredBlueprintV4(answers);
    expect(built.why_firm_wants_work.claims).toHaveLength(7);
    expect(validateDraftAnswers(answers)).toBe(true);
    expect(validateAnalysisResult({brief:built,clarification_code:null},answers,[])).not.toBeNull();
    const excessive=structuredClone(built);
    excessive.why_firm_wants_work.claims.push(structuredClone(excessive.why_firm_wants_work.claims[0]));
    const failures: Array<{field:string;reason:string}> = [];
    expect(validateAnalysisResult({brief:excessive,clarification_code:null},answers,[],failure=>failures.push(failure))).toBeNull();
    expect(failures).toContainEqual({field:"why_firm_wants_work",reason:"payment_claim_cannot_fit_without_dropping_other_claims"});
  });
  it("normalizes a grounded client-feedback payment-context paraphrase without accepting a changed source claim", () => {
    const answers = completeAnswers();
    answers.value.payment = "predictable";
    answers.value.payment_context = "Clients told the firm that the first invoice was usually paid on schedule.";
    answers.value.payment_context_basis = "client_feedback";
    const value = validBlueprint(answers);
    const contextIndex = value.brief.why_firm_wants_work.claims.length;
    value.brief.why_firm_wants_work.claims.push(evidence(
      "Clients said the first invoice was usually paid on time.",
      "client_reported",
      "value.payment_context",
      "value.payment_context_basis",
    ));

    const normalized = validateAnalysisResult(value, answers, []);
    expect(normalized).not.toBeNull();
    const context = normalized!.brief.why_firm_wants_work.claims.find(claim => claim.source_answer_ids.includes("value.payment_context"));
    expect(context).toMatchObject({
      text: 'Client feedback reported by the firm: “Clients told the firm that the first invoice was usually paid on schedule.”',
      evidence_basis: "client_reported",
      source_answer_ids: ["value.payment_context", "value.payment_context_basis"],
    });
    expect(normalized!.brief.why_firm_wants_work.claims.some(claim =>
      claim.source_answer_ids.includes("value.payment_context") && claim.source_answer_ids.includes("value.payment"),
    )).toBe(false);

    const wrongBasis = structuredClone(value);
    wrongBasis.brief.why_firm_wants_work.claims[contextIndex] = evidence(
      "Clients said the first invoice was usually paid on time.",
      "firm_reported_observation",
      "value.payment_context",
      "value.payment_context_basis",
    );
    expect(validateAnalysisResult(wrongBasis, answers, [])).toBeNull();

    const contradicted = structuredClone(value);
    contradicted.brief.why_firm_wants_work.claims[contextIndex] = evidence(
      "Clients said the first invoice was usually paid late.",
      "client_reported",
      "value.payment_context",
      "value.payment_context_basis",
    );
    expect(validateAnalysisResult(contradicted, answers, [])).toBeNull();

    const fabricated = structuredClone(value);
    fabricated.brief.why_firm_wants_work.claims[contextIndex] = evidence(
      "All clients always paid the first invoice on time.",
      "client_reported",
      "value.payment_context",
      "value.payment_context_basis",
    );
    expect(validateAnalysisResult(fabricated, answers, [])).toBeNull();
  });
  it("preserves optional payment context and recovers a mixed experience claim without duplication", () => {
    const answers = completeAnswers();
    answers.value.payment = "predictable";
    answers.value.payment_context = "The firm observed that 8 of 10 buyers paid the first invoice within 15 days.";
    answers.value.payment_context_basis = "firm_observation";
    const result = validBlueprint(answers);
    result.brief.why_firm_wants_work.claims = [evidence(
      "The firm reports payment is usually predictable, observed that 8 of 10 buyers paid within 15 days, and handles this work regularly.",
      "firm_reported_observation",
      "value.payment",
      "value.payment_context",
      "value.payment_context_basis",
      "practice.experience",
    ), evidence("The firm handles this work regularly.", "firm_reported_experience", "practice.experience")];

    const validated = validateAnalysisResult(result, answers, []);
    expect(validated).not.toBeNull();
    const claims = validated!.brief.why_firm_wants_work.claims;
    const context = claims.find(claim => claim.source_answer_ids.includes("value.payment_context"));
    const experience = claims.filter(claim => claim.source_answer_ids.includes("practice.experience"));
    expect(context?.text).toContain("payment is usually predictable");
    expect(context?.text).toContain("Firm observation: “The firm observed that 8 of 10 buyers paid the first invoice within 15 days.”");
    expect(context).toMatchObject({
      evidence_basis: "firm_reported_observation",
      source_answer_ids: ["value.payment", "value.payment_context", "value.payment_context_basis"],
    });
    expect(experience).toHaveLength(1);
    expect(experience[0].evidence_basis).toBe("firm_reported_experience");
    expect(claims.some(claim => claim.source_answer_ids.includes("value.payment_context") && claim.source_answer_ids.includes("practice.experience"))).toBe(false);
  });
  it("splits a canonical client-feedback payment claim from grounded experience and capacity while preserving the full commercial fixture", () => {
    const answers = completeAnswers();
    answers.value.reasons = ["client_benefit", "fees", "skills"];
    Object.assign(answers.value, {
      fee_effort: "worthwhile", collected_fee: "15to50", team_hours: "16to40",
      payment: "predictable",
      payment_context: "Clients told the firm the first invoice was usually paid on schedule.",
      payment_context_basis: "client_feedback",
      currency: "CAD", fee_amount: "8000", direct_cost_amount: "8500",
      amount_basis: "recorded", amount_scope: "per_matter",
    });
    answers.practice.experience = "regular";
    Object.assign(answers.delivery, { conditions: ["scope", "information"], capacity: "room" });
    Object.assign(answers.repeatability, {
      success_measure: "retained_matters",
      target: "2 additional retained matters per quarter",
      review_period: "6 months",
      additional_matters: "2 comparable matters per quarter",
      staffing_constraint: "An associate must be hired before increasing volume.",
    });

    const built = buildStructuredBlueprintV4(answers);
    const contextIndex = built.why_firm_wants_work.claims.findIndex((claim) => claim.source_answer_ids.includes("value.payment_context"));
    const context = built.why_firm_wants_work.claims[contextIndex];
    const experience = built.why_firm_wants_work.claims.find((claim) => claim.source_answer_ids.includes("practice.experience"));
    const capacity = built.why_firm_wants_work.claims.find((claim) => claim.source_answer_ids.includes("repeatability.additional_matters"));
    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(experience).toBeDefined();
    expect(capacity).toBeDefined();

    const result = { brief: structuredClone(built), clarification_code: null };
    result.brief.why_firm_wants_work.claims[contextIndex] = evidence(
      [context.text, experience!.text, capacity!.text].join(" "),
      "client_reported",
      "value.payment_context",
      "value.payment_context_basis",
      ...experience!.source_answer_ids,
      ...capacity!.source_answer_ids,
    );
    const failures: Array<{ field: string; reason: string }> = [];
    const validated = validateAnalysisResult(result, answers, [], (failure) => failures.push({ field: failure.field, reason: failure.reason }));
    expect(validated, JSON.stringify(failures)).not.toBeNull();
    const claims = validated!.brief.why_firm_wants_work.claims;
    expect(claims.length).toBeLessThanOrEqual(7);

    const normalizedContext = claims.find((claim) => claim.source_answer_ids.includes("value.payment_context"));
    expect(normalizedContext).toMatchObject({
      evidence_basis: "client_reported",
      source_answer_ids: ["value.payment_context", "value.payment_context_basis"],
    });
    expect(normalizedContext?.text).toContain("usually paid on schedule");
    const normalizedExperience = claims.find((claim) => claim.source_answer_ids.includes("practice.experience"));
    expect(normalizedExperience?.evidence_basis).toBe("firm_reported_experience");
    expect(normalizedExperience?.source_answer_ids).not.toContain("value.payment_context");
    const normalizedCapacity = claims.find((claim) => claim.source_answer_ids.includes("repeatability.additional_matters"));
    expect(normalizedCapacity?.evidence_basis).toBe("firm_reported_observation");
    expect(normalizedCapacity?.text).toContain("2 comparable matters per quarter");
    expect(normalizedCapacity?.source_answer_ids).not.toContain("value.payment_context");

    const serialized = JSON.stringify(validated);
    for (const path of [
      "value.fee_amount", "value.direct_cost_amount", "value.collected_fee", "value.team_hours",
      "value.payment_context", "value.payment_context_basis", "delivery.capacity", "delivery.conditions",
      "repeatability.staffing_constraint", "repeatability.target", "repeatability.review_period",
    ]) expect(serialized).toContain(path);
    expect(serialized).toContain("8000");
    expect(serialized).toContain("8500");
    expect(serialized).toContain("C$500.00");
    expect(serialized).toContain("C$15,000 to under C$50,000");
    expect(serialized).toContain("More than 15, up to 40 hours");
    expect(serialized).toContain("A clearly agreed scope");
    expect(serialized).toContain("Access to the information we need");
    expect(serialized).toContain("An associate must be hired before increasing volume.");
    expect(serialized).toContain("2 additional retained matters per quarter");
    expect(validated!.brief.definition_components.outcome.source_answer_ids).toContain("repeatability.review_period");
    expect(calculateContribution(answers)?.amount.replace(/\u2212/u, "-")).toBe("-C$500.00");
    expect(calculateContribution(answers)?.margin?.amount.replace(/\u2212/u, "-")).toBe("-6.25%");
  });
  it("rejects fabricated payment assertions before repairable source separation", () => {
    const answers = completeAnswers();
    answers.value.payment = "predictable";
    answers.value.payment_context = "In our last ten comparable engagements, payment was usually received on schedule.";
    answers.value.payment_context_basis = "firm_observation";
    for (const text of [
      "Firm observation: 999 clients never paid.",
      "Audited records prove all clients pay on time.",
    ]) {
      const value = validBlueprint(answers);
      value.brief.why_firm_wants_work.claims = [evidence(
        text,
        "firm_reported_observation",
        "value.payment",
        "value.payment_context",
        "value.payment_context_basis",
      )];
      expect(validateAnalysisResult(value, answers, [])).toBeNull();
    }
  });
  it("rejects an unsupported number in a mixed payment and experience claim before recovery", () => {
    const answers = completeAnswers();
    answers.value.payment = "predictable";
    answers.practice.experience = "regular";
    const value = validBlueprint(answers);
    value.brief.why_firm_wants_work.claims = [evidence(
      "Payment is usually predictable and the firm handled 999 matters.",
      "firm_reported_observation",
      "value.payment",
      "practice.experience",
    )];
    expect(validateAnalysisResult(value, answers, [])).toBeNull();
  });
  it("keeps an explicit unknown payment gap while rejecting an unknown-as-fact claim", () => {
    const answers = completeAnswers();
    answers.value.payment = "unknown";
    const gap = validBlueprint(answers);
    gap.brief.why_firm_wants_work.claims = [evidence("Payment predictability is unknown.", "unknown", "value.payment")];
    expect(validateAnalysisResult(gap, answers, [])).not.toBeNull();
    const asserted = validBlueprint(answers);
    asserted.brief.why_firm_wants_work.claims = [evidence("Payment is predictable for every client.", "firm_reported_observation", "value.payment")];
    expect(validateAnalysisResult(asserted, answers, [])).toBeNull();
  });
  it("keeps a supplied demand uncertainty as an explicit gap rather than treating its text as proof", () => {
    const answers = completeAnswers(); answers.opportunity.uncertainty = "Demand for this agreement engagement has not yet been verified.";
    const value = validBlueprint();
    value.brief.evidence_and_open_questions.claims = [evidence(answers.opportunity.uncertainty, "unknown", "opportunity.uncertainty")];
    expect(validateAnalysisResult(value, answers, [])).not.toBeNull();
    value.brief.evidence_and_open_questions.claims[0] = evidence("Demand for this agreement engagement is established.", "firm_preference", "opportunity.uncertainty");
    expect(validateAnalysisResult(value, answers, [])).toBeNull();
  });
  it("distinguishes malformed evidence cards from empty and over-limit claim lists", () => {
    const answers = completeAnswers();
    const empty = validBlueprint();
    empty.brief.evidence_and_open_questions.claims = [];
    const emptyFailures: Array<{field:string;reason:string}> = [];
    expect(validateAnalysisResult(empty, answers, [], failure => emptyFailures.push(failure))).toBeNull();
    expect(emptyFailures[0]).toEqual({field:"evidence_and_open_questions",reason:"card_claims_empty"});

    const excessive = validBlueprint();
    excessive.brief.evidence_and_open_questions.claims = Array.from({length:7}, () => structuredClone(excessive.brief.evidence_and_open_questions.claims[0]));
    const excessiveFailures: Array<{field:string;reason:string}> = [];
    expect(validateAnalysisResult(excessive, answers, [], failure => excessiveFailures.push(failure))).toBeNull();
    expect(excessiveFailures[0]).toEqual({field:"evidence_and_open_questions",reason:"card_claim_limit_exceeded"});

    const malformed = validBlueprint();
    Object.assign(malformed.brief.evidence_and_open_questions, {summary:"unrecognized field"});
    const malformedFailures: Array<{field:string;reason:string}> = [];
    expect(validateAnalysisResult(malformed, answers, [], failure => malformedFailures.push(failure))).toBeNull();
    expect(malformedFailures[0]).toEqual({field:"evidence_and_open_questions",reason:"card_shape"});
  });
  it("accepts six grounded cards with distinct evidence labels", () => { const value = validBlueprint(); expect(validateAnalysisResult(value, completeAnswers(), [])).not.toBeNull(); expect(value.brief.evidence_and_open_questions.claims[0].evidence_basis).toBe("unknown"); expect(value.brief.why_firm_wants_work.claims[0].evidence_basis).toBe("firm_preference"); });
  it("uses explicit client geography, not the firm's service area, for target identity", () => { const answers=completeAnswers(); answers.focus.service_area="Ontario"; const firmServiceAreaOnly=validBlueprint(answers); expect(firmServiceAreaOnly.brief.definition_components.client.text).toBe("an owner or founder"); expect(validateAnalysisResult(firmServiceAreaOnly,answers,[])).not.toBeNull(); answers.client_context.geography="Ontario"; const clientLocation=validBlueprint(answers); expect(clientLocation.brief.definition_components.client.text).toBe("an owner or founder in Ontario"); expect(validateAnalysisResult(clientLocation,answers,[])).not.toBeNull(); });
  it("reports only a safe field and rule when rejecting model output", () => { const failures: Array<{field:string;reason:string}> = []; const value = validBlueprint(); value.brief.client_and_matter.claims[0].text = "x".repeat(701); expect(validateAnalysisResult(value,completeAnswers(),[],failure=>failures.push(failure))).toBeNull(); expect(failures).toEqual([{field:"client_and_matter",reason:"statement_text_budget_or_format"}]); expect(JSON.stringify(failures)).not.toContain("x".repeat(701)); });
  it("reports recognized disallowed citation paths while keeping unknown paths and answer text out of diagnostics", () => { const answers=completeAnswers(), unknown=validBlueprint(), disallowed=validBlueprint(); unknown.brief.definition_components.client.source_answer_ids=["client.identity" as never]; disallowed.brief.definition_components.client.source_answer_ids=["practice.firm_type"]; const failures:Array<{field:string;reason:string;sourcePath?:string}>=[]; expect(validateAnalysisResult(unknown,answers,[],failure=>failures.push(failure))).toBeNull(); expect(failures.at(-1)).toEqual({field:"definition_components.client",reason:"source_answer_path_unrecognized"}); expect(validateAnalysisResult(disallowed,answers,[],failure=>failures.push(failure))).toBeNull(); expect(failures.at(-1)).toEqual({field:"definition_components.client",reason:"source_answer_path_not_allowed_for_slot",sourcePath:"practice.firm_type"}); expect(JSON.stringify(failures)).not.toContain("client.identity"); expect(JSON.stringify(failures)).not.toContain(answers.practice.firm_type); });
  it("rejects legacy answer-list schemas, extra keys, and wrong versions", () => { const good = validBlueprint(), answers = completeAnswers(); expect(validateAnalysisResult({ brief: { definition: {}, client_goals: [], firm_reasons: [], marketing: {} }, clarification_code: null }, answers, [])).toBeNull(); expect(validateAnalysisResult({ ...good, unexpected: true }, answers, [])).toBeNull(); expect(validateAnalysisResult({ ...good, brief: { ...good.brief, report_version: "dcm-blueprint-v1" } }, answers, [])).toBeNull(); });
  it("rejects unsupported citations and slot overflow, and replaces model sentence wording with the application formatter", () => { const answers = completeAnswers(), good = validBlueprint(answers); const fabricated = structuredClone(good); fabricated.brief.why_firm_wants_work.claims[0].source_answer_ids = ["focus.industry" as never]; expect(validateAnalysisResult(fabricated, answers, [])).toBeNull(); const sentence = structuredClone(good); sentence.brief.definition_sentence = "A conflicting sentence written by the model."; const checked=validateAnalysisResult(sentence, answers, []); expect(checked?.brief.definition_sentence).toContain("on matters matching the firm's description: “A business buyer"); expect(checked?.brief.definition_sentence).toContain("because the firm cites client benefit, a fit with the firm's skills and fees usually worthwhile for the effort"); expect(checked?.brief.definition_sentence).not.toContain("progress will be assessed"); const long = structuredClone(good); long.brief.client_and_matter.claims[0].text = "x ".repeat(101); expect(validateAnalysisResult(long, answers, [])).toBeNull(); });
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
    expect(economics?.text).toContain("estimated contribution before overhead and acquisition costs: C$3,200.00");
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
  it("preserves a selected fee preference without claiming positive economics when the figures are negative",()=>{
    const answers=completeAnswers();
    answers.value.reasons=["client_benefit","fees","skills"];
    Object.assign(answers.value,{fee_amount:"8000",direct_cost_amount:"8500",currency:"CAD",amount_basis:"recorded",amount_scope:"per_matter"});
    const brief=buildStructuredBlueprintV4(answers);
    const rationale=brief.why_firm_wants_work.claims.find(claim=>claim.source_answer_ids.includes("value.reasons"));
    expect(rationale?.text).toContain("fee sustainability as a firm preference");
    expect(rationale?.text).not.toMatch(/\bfees? (?:are )?worthwhile\b|\bfees? support(?:s)? the effort\b/i);
    expect(validateAnalysisResult({brief,clarification_code:null},answers,[])).not.toBeNull();
  });
  it("accepts the structured report's firm-reported fee and team-time bands",()=>{
    const answers=completeAnswers();
    answers.value.reasons=["client_benefit","fees","skills"];
    answers.value.collected_fee="5to15"; answers.value.team_hours="16to40";
    Object.assign(answers.value,{fee_amount:"8000",direct_cost_amount:"8500",currency:"CAD",amount_basis:"estimated",amount_scope:"per_matter"});
    const brief=buildStructuredBlueprintV4(answers);
    const range=brief.why_firm_wants_work.claims.find(claim=>claim.source_answer_ids.includes("value.collected_fee"));
    expect(range?.evidence_basis).toBe("firm_reported_observation");
    expect(range?.text).toContain("C$5,000 to under C$15,000");
    expect(range?.text).toContain("More than 15, up to 40 hours");
    expect(brief.why_firm_wants_work.claims.find(claim=>claim.source_answer_ids.includes("value.reasons"))?.text).toContain("fee sustainability as a firm preference");
    expect(validateAnalysisResult({brief,clarification_code:null},answers,[])).not.toBeNull();
  });
  it("accepts an accurate negative result and a growth prerequisite without blessing positive economics",()=>{
    const answers=completeAnswers();
    Object.assign(answers.value,{fee_amount:"8000",direct_cost_amount:"10000",currency:"CAD",amount_basis:"estimated",amount_scope:"per_matter"});
    const result=validBlueprint(answers);
    const original=result.brief.why_firm_wants_work.claims;
    const economics=["value.fee_amount","value.direct_cost_amount","value.currency","value.amount_basis","value.amount_scope"] as const;
    result.brief.why_firm_wants_work.claims=[evidence("The work is not profitable at the supplied fee and direct cost.","firm_reported_estimate",...economics)];
    expect(validateAnalysisResult(result,answers,[])).not.toBeNull();
    result.brief.why_firm_wants_work.claims=[evidence("Before growing this work, the firm needs to establish positive contribution.","firm_preference","value.reasons","delivery.capacity")];
    expect(validateAnalysisResult(result,answers,[])).not.toBeNull();
    result.brief.why_firm_wants_work.claims=[evidence("Positive contribution remains to be verified.","firm_reported_estimate",...economics)];
    expect(validateAnalysisResult(result,answers,[])).not.toBeNull();
    result.brief.why_firm_wants_work.claims=[evidence("The work is not profitable, but fees are worthwhile.","firm_reported_estimate",...economics)];
    expect(validateAnalysisResult(result,answers,[])).toBeNull();
    result.brief.why_firm_wants_work.claims=[evidence("The work is profitable at the supplied fee and direct cost.","firm_reported_estimate",...economics)];
    expect(validateAnalysisResult(result,answers,[])).toBeNull();
    result.brief.why_firm_wants_work.claims=original;
  });
  it("allows a specific matter term when the firm supplies it", () => {
    const answers=completeAnswers();
    answers.client_context.repeat_matter_pattern="Ontario owners buying a family-owned manufacturer through an asset purchase agreement.";
    const validated=validateAnalysisResult(validBlueprint(answers),answers,[]);
    expect(validated?.brief.definition_sentence).toContain("Ontario owners buying a family-owned manufacturer through an asset purchase agreement");
  });
  it("does not reject a supported definition solely because it exceeds the former 85-word ceiling", () => {
    const answers = completeAnswers();
    answers.client_context.repeat_matter_pattern = `A buyer of an established operating business needs an asset purchase agreement drafted or reviewed before agreeing to final terms. ${"The buyer also needs advice on due diligence, excluded assets, assumed liabilities, payment mechanics, closing conditions and allocation of contractual risk. ".repeat(5)}`.slice(0, 600);
    answers.client.goal_detail = `Understand which assets and liabilities are included, clarify payment and closing obligations, and negotiate how contractual risks are allocated. ${"The client needs a clear view of the next decision and the obligations tied to closing. ".repeat(4)}`.slice(0, 450);
    const result = validBlueprint(answers);
    result.brief.definition_sentence = buildDefinitionSentence(result.brief, false, answers.client.goal_detail);
    expect(result.brief.definition_sentence.split(/\s+/).length).toBeGreaterThan(85);
    expect(validateAnalysisResult(result, answers, [])).not.toBeNull();
  });
});
