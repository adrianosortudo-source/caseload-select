import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeAnswers, evidence, validBlueprint } from "./blueprint-helpers";
import { decodeProviderSources, decodeProviderTargetCard, encodeProviderSources, providerBlueprintSchema, providerSourceAliases, providerTargetClaimIds } from "../provider-schema";
import { runDesiredClientAnalysis } from "../analyze";
import { validateAnalysisResult } from "../output";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { interviewClarificationSourceFingerprint } from "../types";
import type { AnalysisRequestEnvelope } from "../types";

const provider = vi.hoisted(() => ({ configure: vi.fn(), generate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@google/generative-ai", () => ({ GoogleGenerativeAI: class {
  getGenerativeModel(config: unknown) { provider.configure(config); return { generateContent: provider.generate }; }
} }));
const request = (): AnalysisRequestEnvelope => ({ schemaVersion: 4, operation: "generate", requestId: "11111111-1111-4111-8111-111111111111", answerRevision: 3, reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0, aiConsent: true, answers: completeAnswers(), clarifications: [] });

describe("provider output contract", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("GOOGLE_AI_API_KEY", "test-only"); });
  it("passes the nested blueprint schema to the provider and validates its response", async () => {
    provider.generate.mockResolvedValue({ response: { text: () => JSON.stringify(validBlueprint()) } });
    expect((await runDesiredClientAnalysis(request(), [])).mode).toBe("live");
    const config = provider.configure.mock.calls[0][0];
    expect(config.systemInstruction).toContain("“two matters” and “2 matters”");
    expect(config.generationConfig.responseSchema).toEqual(providerBlueprintSchema(request().answers));
    const aliases = providerSourceAliases(request().answers);
    const targetSelection = config.generationConfig.responseSchema.properties.brief.properties.client_and_matter;
    expect(targetSelection.required).toEqual(["claim_ids"]);
    expect(targetSelection.properties.claim_ids.items.enum).toEqual(["target_claim_1"]);
    const roleAlias = Object.keys(aliases).find(id => aliases[id] === "situation.role")!;
    expect(decodeProviderSources({source_answer_ids:[roleAlias,roleAlias,"invalid"]},aliases)).toEqual({source_answer_ids:["situation.role","invalid"]});
    expect(config.generationConfig.responseSchema.properties.brief.required).toContain("client_and_matter");
    expect(targetSelection.properties.claim_ids.maxItems).toBe(1);
    expect(config.generationConfig.responseSchema.properties.brief.properties.definition_components.properties.client.properties.evidence_basis.enum).toEqual(["firm_preference"]);
    expect(config.generationConfig.responseSchema.properties.brief.properties.definition_components.properties.client.properties.evidence_basis.enum).not.toContain("firm_reported_experience");
    expect(config.generationConfig.responseSchema.properties.brief.properties.evidence_and_open_questions.properties.claims.items.properties.text.description).toContain("“two matters” and “2 matters”");
  });
  it("permits the complete five-source set required to ground a contribution claim", () => {
    const answers = completeAnswers();
    Object.assign(answers.value, { fee_amount:"8000", direct_cost_amount:"4800", currency:"CAD", amount_basis:"estimated", amount_scope:"per_matter" });
    const schema = providerBlueprintSchema(answers) as ReturnType<typeof providerBlueprintSchema> & {properties:{brief:{properties:{why_firm_wants_work:{properties:{claims:{items:{properties:{source_answer_ids:{maxItems:number;items:{enum:string[]}};evidence_basis:{description:string}}}}}}}}}};
    const sources = schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties.source_answer_ids;
    const aliases = providerSourceAliases(answers);
    expect(sources.maxItems).toBeGreaterThanOrEqual(5);
    const evidenceDescription = schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties.evidence_basis.description;
    const feeAlias = Object.keys(aliases).find(id => aliases[id] === "value.fee_amount");
    expect(evidenceDescription).toContain("For firm_reported_estimate you MUST cite at least one of");
    expect(evidenceDescription).toContain(feeAlias);
    expect(sources.items.enum.map(id => aliases[id])).toEqual(expect.arrayContaining(["value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope"]));
  });
  it("permits a firm-reported observation for current capacity while keeping targets as preferences", () => {
    const answers = completeAnswers();
    answers.repeatability.additional_matters = "2 comparable matters per quarter";
    const schema = providerBlueprintSchema(answers) as ReturnType<typeof providerBlueprintSchema> & {properties:{brief:{properties:{why_firm_wants_work:{properties:{claims:{items:{properties:{source_answer_ids:{items:{enum:string[]}};evidence_basis:{enum:string[];description:string}}}}}}}}}};
    const aliases = providerSourceAliases(answers);
    const basis = schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties.evidence_basis;
    expect(basis.enum).toContain("firm_reported_observation");
    expect(basis.description).toContain(Object.keys(aliases).find(id => aliases[id] === "repeatability.additional_matters"));
    expect(basis.description).toContain("proposed targets");
  });
  it.each([
    { paymentContextBasis: "client_feedback" as const, expected: "client_reported" },
    { paymentContextBasis: "firm_observation" as const, expected: "firm_reported_observation" },
    { paymentContextBasis: null, expected: "unknown" },
  ])("permits payment context under its selected source: $paymentContextBasis", ({ paymentContextBasis, expected }) => {
    const answers = completeAnswers();
    answers.value.payment = "predictable";
    answers.value.payment_context = "Clients told the firm that the first invoice was usually paid on schedule.";
    answers.value.payment_context_basis = paymentContextBasis;
    const schema = providerBlueprintSchema(answers) as ReturnType<typeof providerBlueprintSchema> & {properties:{brief:{properties:{why_firm_wants_work:{properties:{claims:{items:{properties:{source_answer_ids:{items:{enum:string[]}};evidence_basis:{enum:string[];description:string}}}}}}}}}};
    const aliases = providerSourceAliases(answers);
    const claim = schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties;
    const allowedPaths = claim.source_answer_ids.items.enum.map(id => aliases[id]);
    expect(allowedPaths).toContain("value.payment_context");
    expect(allowedPaths).toContain("value.payment_context_basis");
    expect(claim.evidence_basis.enum).toContain(expected);
    expect(claim.evidence_basis.description).toContain("payment_context_basis");
    expect(claim.evidence_basis.description).toContain("Keep payment and context claims separate when their derived status differs");
    expect(claim.evidence_basis.description).toContain("copy the matching canonical text");
    if (paymentContextBasis === "firm_observation") expect(claim.evidence_basis.enum).not.toContain("client_reported");
  });
  it("supplies canonical payment claims with compact sources to the initial and repair prompts", async () => {
    const input = request();
    input.answers.value.payment = "predictable";
    input.answers.value.payment_context = "Clients told the firm that the first invoice was usually paid on schedule.";
    input.answers.value.payment_context_basis = "client_feedback";
    const aliases = providerSourceAliases(input.answers);
    const groundedPaymentClaims = buildStructuredBlueprintV4(input.answers).why_firm_wants_work.claims.filter((claim) =>
      claim.source_answer_ids.some((path) => ["value.payment", "value.payment_context", "value.payment_context_basis"].includes(path)),
    );
    const compactPaymentClaims = encodeProviderSources(groundedPaymentClaims, aliases);

    const invalid = validBlueprint(input.answers);
    invalid.brief.why_firm_wants_work.claims = Array.from(
      { length: 8 },
      () => structuredClone(invalid.brief.why_firm_wants_work.claims[0]),
    );
    const repaired = buildStructuredBlueprintV4(input.answers).why_firm_wants_work;
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(encodeProviderSources(invalid, aliases)) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(encodeProviderSources(repaired, aliases)) } });

    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const initialPrompt = JSON.parse(provider.generate.mock.calls[0][0]);
    const repairPrompt = JSON.parse(provider.generate.mock.calls[1][0]);
    expect(initialPrompt.grounded_payment_claims).toEqual(compactPaymentClaims);
    expect(repairPrompt.grounded_payment_claims).toEqual(compactPaymentClaims);
    expect(initialPrompt.instruction).toContain("copy every applicable canonical payment");
    expect(repairPrompt.grounded_payment_claims.every((claim: { source_answer_ids: string[] }) =>
      claim.source_answer_ids.every((id) => Object.hasOwn(aliases, id)),
    )).toBe(true);
    const repairInstruction = provider.configure.mock.calls[1][0].systemInstruction;
    expect(repairInstruction).toContain("up to seven grounded claims");
    expect(repairInstruction).toContain("grounded_payment_claims exactly");
    expect(repairInstruction).not.toContain("proposed target or its review period");
    expect(repairInstruction).not.toContain("proposed measure and review period");
  });
  it("asks the model to format a specific client type as a grammatically complete noun phrase", () => {
    const schema = providerBlueprintSchema(completeAnswers()) as {properties:{brief:{properties:{definition_components:{properties:{client:{properties:{text:{description:string}}}}}}}}};
    const guidance = schema.properties.brief.properties.definition_components.properties.client.properties.text.description;
    expect(guidance).toContain("plural group");
    expect(guidance).toContain("an owner or founder");
  });
  it("aligns matter guidance with the quoted description used by the formatter", () => {
    const schema=providerBlueprintSchema(completeAnswers());
    const serialized=JSON.stringify(schema);
    expect(serialized).toContain("quoted matter description");
    expect(serialized).toContain("rebuilds the final client type and matter definition directly from the firm's answers");
    expect(serialized).not.toContain("in a situation where");
  });
  it("separates client feedback from firm-observed decision evidence when their bases differ", () => {
    const answers = completeAnswers();
    answers.client.choice_basis = "client_feedback";
    answers.client.pathway_basis = "firm_observation";
    const aliases = providerSourceAliases(answers);
    const schema = providerBlueprintSchema(answers) as {properties:{brief:{properties:{client_goals_needs:{properties:{claims:{items:{properties:{evidence_basis:{description:string};source_answer_ids:{items:{enum:string[]}}}}}}};decision_pathway:{properties:{trigger:{properties:{evidence_basis:{description:string;enum:string[]};source_answer_ids:{items:{enum:string[]}}}}}}}}}};
    const claim = schema.properties.brief.properties.client_goals_needs.properties.claims.items.properties;
    const evidenceDescription = claim.evidence_basis.description;
    expect(evidenceDescription).toContain("otherwise keep the claims separate");
    expect(evidenceDescription).toContain("client.choice_basis=client_feedback");
    expect(evidenceDescription).toContain("client.pathway_basis=firm_observation");
    expect(claim.source_answer_ids.items.enum.map(id => aliases[id])).toContain("client.choice_priorities");
    const pathway = schema.properties.brief.properties.decision_pathway.properties.trigger.properties;
    const pathwayPaths = pathway.source_answer_ids.items.enum.map(id => aliases[id]);
    expect(pathwayPaths).toContain("client.pathway_basis");
    expect(pathwayPaths).not.toContain("client.choice_basis");
    expect(pathwayPaths).not.toContain("client.choice_priorities");
    expect(pathway.evidence_basis.enum).toContain("firm_reported_observation");
    expect(pathway.evidence_basis.enum).not.toContain("client_reported");
    expect(pathway.evidence_basis.description).toContain("Do not use client-choice details in this statement.");
  });
  it("allows an unanswered first-contact source only to support an explicit unknown", () => {
    const answers = completeAnswers();
    answers.client.pathway_basis = "firm_observation";
    answers.client.decision_context = "The owner decides, with an accountant involved.";
    answers.situation.contact = null;
    const aliases = providerSourceAliases(answers);
    const schema = providerBlueprintSchema(answers) as {properties:{brief:{properties:{decision_pathway:{properties:{first_contact:{properties:{text:{description:string};source_answer_ids:{items:{enum:string[]}};evidence_basis:{enum:string[]}}}}}}}}};
    const firstContact = schema.properties.brief.properties.decision_pathway.properties.first_contact.properties;
    const paths = firstContact.source_answer_ids.items.enum.map(id => aliases[id]);
    expect(paths).toContain("situation.contact");
    expect(firstContact.text.description).toContain("State that gap plainly");
    expect(firstContact.text.description).toContain("use evidence_basis unknown");
    expect(firstContact.evidence_basis.enum).not.toContain("client_reported");
  });
  it("allows all sources required by the exact negative-contribution target", async () => {
    const input = request();
    Object.assign(input.answers.value, { fee_amount:"8000", direct_cost_amount:"10000", currency:"CAD", amount_basis:"estimated", amount_scope:"per_matter" });
    const original = validBlueprint(input.answers);
    const aliases = providerSourceAliases(input.answers);
    const compact = encodeProviderSources(original, aliases);
    provider.generate.mockResolvedValue({ response: { text: () => JSON.stringify(compact) } });
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const config = provider.configure.mock.calls[0][0];
    const reason = config.generationConfig.responseSchema.properties.brief.properties.definition_components.properties.reasons.properties;
    const expected = original.brief.definition_components.reasons;
    expect(expected.source_answer_ids).toHaveLength(8);
    expect(reason.text.enum).toEqual([expected.text]);
    expect(reason.evidence_basis.enum).toEqual([expected.evidence_basis]);
    expect(reason.source_answer_ids.maxItems).toBe(8);
    expect(reason.source_answer_ids.items.enum.map((id: string) => aliases[id])).toEqual(expect.arrayContaining(expected.source_answer_ids));
    const prompt = JSON.parse(provider.generate.mock.calls[0][0]);
    expect(prompt.grounded_target.reasons).not.toHaveProperty("kind");
    expect(decodeProviderSources(prompt.grounded_target.reasons, aliases)).toEqual(expected);
    expect(prompt.grounded_target.reasons.source_answer_ids.every((id: string) => Object.hasOwn(aliases, id))).toBe(true);
    expect(prompt.grounded_target.primary_client_and_matter_claim).not.toHaveProperty("kind");
    expect(prompt.instruction).toContain("already use compact source IDs");
  });
  it("repairs a positive economic claim against negative contribution without merging evidence bases", async () => {
    const input=request();
    Object.assign(input.answers.value,{fee_amount:"4800",direct_cost_amount:"8000",currency:"CAD",amount_basis:"estimated",amount_scope:"per_matter"});
    const invalid=validBlueprint(input.answers);
    invalid.brief.why_firm_wants_work.claims[0]=evidence("These fees support the effort and make the work profitable.","firm_preference","value.reasons","value.fee_amount","value.direct_cost_amount","value.currency","value.amount_basis","value.amount_scope");
    const repaired={claims:[
      evidence("The firm prefers this work because it fits its selected skills.","firm_preference","value.reasons"),
      evidence("The estimated comparable fee is below direct delivery cost; resolve this conflict before increasing volume.","firm_reported_estimate","value.fee_amount","value.direct_cost_amount","value.currency","value.amount_basis","value.amount_scope"),
    ]};
    provider.generate.mockResolvedValueOnce({response:{text:()=>JSON.stringify(invalid)}})
      .mockResolvedValueOnce({response:{text:()=>JSON.stringify(repaired)}});
    const outcome=await runDesiredClientAnalysis(input,[]);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const repairInstruction=provider.configure.mock.calls[1][0].systemInstruction;
    expect(repairInstruction).toContain("The application calculated negative contribution");
    expect(repairInstruction).toContain("State the firm's reported preference separately");
    if(outcome.mode==="live") {
      const claims = outcome.result.brief.why_firm_wants_work.claims;
      const grounded = buildStructuredBlueprintV4(input.answers).why_firm_wants_work.claims;
      expect(claims).toEqual(expect.arrayContaining([
        repaired.claims[1],
        ...grounded.filter((claim) => !claim.source_answer_ids.includes("value.fee_amount")),
      ]));
      expect(claims.some((claim) => /fees support the effort|make the work profitable/iu.test(claim.text))).toBe(false);
    }
  });
  it("does not silently replace an invented target with the confirmed target", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = validBlueprint();
    invalid.brief.definition_components.client.text = "Canadian billionaires";
    provider.generate.mockResolvedValue({ response: { text: () => JSON.stringify(invalid) } });
    expect((await runDesiredClientAnalysis(request(), [])).mode).toBe("invalid_output");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"reason":"target_not_grounded_in_confirmed_answers"'));
    warning.mockRestore();
  });
  it("requires all confirmed target claims and repairs an omitted current clarification", async () => {
    const input = request();
    const paths = ["client_context.repeat_matter_pattern"] as const;
    input.answers.interview = { ai_clarification_consent:true, clarification_count:1, clarified_stages:[2], followups:[{
      id:"33333333-3333-4333-8333-333333333333", stage:2, purpose:"client_matter_specificity",
      source_answer_ids:[...paths], source_answer_fingerprint:interviewClarificationSourceFingerprint(input.answers,[...paths]),
      question:"Which part of this engagement should remain the focus?", answer:"Buyer-side asset purchase agreement review before terms are agreed.", skipped:false,
    }] };
    const target = buildStructuredBlueprintV4(input.answers).client_and_matter;
    expect(target.claims).toHaveLength(2);
    const reordered={brief:{client_and_matter:{claim_ids:["target_claim_2","target_claim_1"]}}};
    expect(decodeProviderTargetCard(reordered,input.answers)).toBe(reordered);
    const aliases = providerSourceAliases(input.answers);
    const invalid = validBlueprint(input.answers);
    provider.generate.mockResolvedValueOnce({response:{text:()=>JSON.stringify(encodeProviderSources(invalid,aliases))}})
      .mockResolvedValueOnce({response:{text:()=>JSON.stringify({claim_ids:providerTargetClaimIds(input.answers)})}});
    const outcome = await runDesiredClientAnalysis(input,[]);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const card = provider.configure.mock.calls[0][0].generationConfig.responseSchema.properties.brief.properties.client_and_matter.properties.claim_ids;
    expect(card.minItems).toBe(2); expect(card.maxItems).toBe(2);
    expect(card.items.enum).toEqual(["target_claim_1","target_claim_2"]);
    expect(JSON.parse(provider.generate.mock.calls[0][0]).grounded_target.client_and_matter_claims).toEqual(encodeProviderSources(target.claims,aliases));
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("including a current stage-two clarification");
    if(outcome.mode==="live") expect(outcome.result.brief.client_and_matter).toEqual(target);
  });
  it("resolves an explicit confirmed target reference without replacing other AI claims", async () => {
    const input=request();
    const original=validBlueprint(input.answers);
    const compact=encodeProviderSources(original,providerSourceAliases(input.answers)) as {brief:Record<string,unknown>};
    compact.brief.client_and_matter={claim_ids:providerTargetClaimIds(input.answers)};
    provider.generate.mockResolvedValue({response:{text:()=>JSON.stringify(compact)}});
    const outcome=await runDesiredClientAnalysis(input,[]);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const prompt=JSON.parse(provider.generate.mock.calls[0][0]);
    expect(prompt.grounded_target_claim_ids).toEqual(["target_claim_1"]);
    expect(prompt.instruction).toContain("all other cards remain AI-written grounded analysis");
    if(outcome.mode==="live") {
      expect(outcome.result.brief.client_and_matter).toEqual(buildStructuredBlueprintV4(input.answers).client_and_matter);
      expect(outcome.result.brief.client_goals_needs).toEqual(original.brief.client_goals_needs);
    }
  });
  it.each([
    {claim_ids:[]},
    {claim_ids:["target_claim_99"]},
    {claim_ids:["target_claim_1","target_claim_1"]},
    {claim_ids:["target_claim_1"],text:"Canadian billionaires"},
  ])("never resolves a missing, invented, duplicate or expanded target selection: %j", card => {
    const original={brief:{client_and_matter:card}};
    expect(decodeProviderTargetCard(original,completeAnswers())).toBe(original);
    const result=validBlueprint();
    (result.brief as unknown as Record<string,unknown>).client_and_matter=card;
    expect(validateAnalysisResult(decodeProviderTargetCard(result,completeAnswers()),completeAnswers(),[])).toBeNull();
  });
  it("rejects an invented target card even when the confirmed definition components are intact", async () => {
    const warning = vi.spyOn(console,"warn").mockImplementation(()=>{});
    const invalid = validBlueprint();
    invalid.brief.client_and_matter.claims=[evidence("Canadian billionaires seek leveraged buyout advice.","hypothesis","focus.work")];
    provider.generate.mockResolvedValue({response:{text:()=>JSON.stringify(invalid)}});
    expect((await runDesiredClientAnalysis(request(),[])).mode).toBe("invalid_output");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"reason":"target_card_not_grounded_in_confirmed_answers"'));
    warning.mockRestore();
  });
  it("records a truncated response's safe finish reason without its text", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    provider.generate.mockResolvedValue({ response: { text: () => '{"submitted":"private example', candidates:[{finishReason:"MAX_TOKENS"}] } });
    expect((await runDesiredClientAnalysis(request(), [])).mode).toBe("invalid_output");
    expect(warning).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(warning.mock.calls[0][0]);
    expect(metadata.reason).toBe("invalid_json");
    expect(metadata.finishReason).toBe("MAX_TOKENS");
    expect(JSON.stringify(metadata)).not.toContain("private example");
    warning.mockRestore();
  });
  it("keeps provider exception diagnostics in one safe log message", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    provider.generate.mockRejectedValue(Object.assign(new Error("private provider response"), {name:"GoogleGenerativeAIFetchError",status:429}));
    expect((await runDesiredClientAnalysis(request(), [])).mode).toBe("unavailable");
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]).toHaveLength(1);
    const metadata = JSON.parse(warning.mock.calls[0][0]);
    expect(metadata.providerStatus).toBe(429);
    expect(metadata.providerError).toBe("GoogleGenerativeAIFetchError");
    expect(JSON.stringify(metadata)).not.toContain("private provider response");
    warning.mockRestore();
  });
  it("allows a relevant unanswered circumstance as a citation for an unknown claim", () => {
    const answers=completeAnswers();
    answers.client_context.relevant_circumstances="";
    const aliases=providerSourceAliases(answers);
    const schema=JSON.parse(JSON.stringify(providerBlueprintSchema(answers))) as {properties:{brief:{properties:{recognizable_circumstances:{properties:{claims:{items:{properties:{source_answer_ids:{items:{enum:string[]}}}}}}}}}}};
    const permitted=schema.properties.brief.properties.recognizable_circumstances.properties.claims.items.properties.source_answer_ids.items.enum.map(id=>aliases[id]);
    expect(permitted).toContain("client_context.relevant_circumstances");
    const result=validBlueprint(answers);
    result.brief.recognizable_circumstances.claims=[evidence("The relevant circumstances have not yet been established.","unknown","client_context.relevant_circumstances")];
    expect(validateAnalysisResult(result,answers,[])).not.toBeNull();
  });
  it("still rejects a malformed root rather than accepting misplaced cards", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    provider.generate.mockResolvedValue({ response: { text: () => JSON.stringify({ ...validBlueprint(), client_and_matter: { claims: [] } }) } });
    expect((await runDesiredClientAnalysis(request(), [])).mode).toBe("invalid_output");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"reason":"root_shape"'));
    warning.mockRestore();
  });
  it("derives the display kind without upgrading an unsupported evidence basis", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blueprint = validBlueprint();
    blueprint.brief.definition_components.client.evidence_basis = "firm_reported_recorded";
    provider.generate.mockResolvedValue({ response: { text: () => JSON.stringify(blueprint) } });
    expect((await runDesiredClientAnalysis(request(), [])).mode).toBe("invalid_output");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"field":"definition_components.client"'));
    warning.mockRestore();
  });
  it("repairs only the rejected card and revalidates the complete result", async () => {
    const original = validBlueprint();
    const invalid = structuredClone(original);
    invalid.brief.client_and_matter.claims[0].text = "The business owner wants advice within 987 days.";
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(original.brief.client_and_matter) } });
    const outcome = await runDesiredClientAnalysis(request(), []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("unsupported_numeric_claim");
    if (outcome.mode === "live") expect(outcome.result.brief.client_goals_needs).toEqual(original.brief.client_goals_needs);
  });
  it("repairs an over-limit evidence card with focused shape and claim-count guidance", async () => {
    const original = validBlueprint();
    const invalid = structuredClone(original);
    invalid.brief.evidence_and_open_questions.claims = Array.from({length:7}, () => structuredClone(original.brief.evidence_and_open_questions.claims[0]));
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(original.brief.evidence_and_open_questions) } });
    const outcome = await runDesiredClientAnalysis(request(), []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const repairInstruction = provider.configure.mock.calls[1][0].systemInstruction;
    expect(repairInstruction).toContain("Return exactly one card object with only a claims array and one to six grounded claims");
    expect(repairInstruction).toContain("preserve all supplied facts and material conditions that belong in this card");
    if (outcome.mode === "live") expect(outcome.result.brief.evidence_and_open_questions).toEqual(original.brief.evidence_and_open_questions);
  });
  it("repairs a claim that combines known goals with an unknown choice factor", async () => {
    const input = request();
    const invalid = validBlueprint();
    invalid.brief.client_goals_needs.claims[0] = {
      text: "The client wants to understand options, but their choice factors are not established.",
      source_answer_ids: ["client.goals", "client.choice_priorities"],
      evidence_basis: "hypothesis",
      kind: "hypothesis",
    };
    const repaired = {claims:[
      {text:"The client wants to understand the available options.",source_answer_ids:["client.goals"],evidence_basis:"hypothesis",kind:"hypothesis"},
      {text:"The client's choice factors have not been established.",source_answer_ids:["client.choice_priorities"],evidence_basis:"unknown",kind:"unknown"},
    ]};
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(repaired) } });
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("Separate each known statement from any unanswered or unknown finding");
    if (outcome.mode === "live") {
      expect(outcome.result.brief.client_goals_needs.claims).toHaveLength(2);
      expect(outcome.result.brief.client_goals_needs.claims[1].evidence_basis).toBe("unknown");
    }
  });
  it("gives the provider and fragment repair the validator's demand-gap classification", async () => {
    const input = request();
    input.answers.opportunity.sources = ["no_evidence"];
    input.answers.opportunity.uncertainty = "Referral demand has not been verified.";
    const invalid = validBlueprint(input.answers);
    invalid.brief.evidence_and_open_questions.claims = [evidence("Referral demand still needs verification.", "firm_preference", "opportunity.uncertainty")];
    const repaired = {claims:[evidence("Referral demand has not been verified.", "unknown", "opportunity.uncertainty")]};
    provider.generate.mockResolvedValueOnce({response:{text:()=>JSON.stringify(invalid)}})
      .mockResolvedValueOnce({response:{text:()=>JSON.stringify(repaired)}});
    expect((await runDesiredClientAnalysis(input, [])).mode).toBe("live");
    const prompt = JSON.parse(provider.generate.mock.calls[0][0]);
    const aliases = providerSourceAliases(input.answers);
    const gapAlias = Object.keys(aliases).find(id => aliases[id] === "opportunity.uncertainty")!;
    const noEvidenceAlias = Object.keys(aliases).find(id => aliases[id] === "opportunity.sources")!;
    expect(prompt.evidence_gap_source_ids).toEqual(expect.arrayContaining([gapAlias, noEvidenceAlias]));
    const schema = provider.configure.mock.calls[0][0].generationConfig.responseSchema;
    const guidance = schema.properties.brief.properties.evidence_and_open_questions.properties.claims.items.properties.evidence_basis.description;
    expect(guidance).toContain(gapAlias);
    expect(guidance).toContain(noEvidenceAlias);
    expect(guidance).toContain("including a populated description of demand uncertainty");
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("The offending citation is opportunity.uncertainty");
  });
  it("repairs a selected strength wrongly labelled as experience without upgrading its evidence", async () => {
    const input = request();
    input.answers.practice.client_strength = "matter_experience";
    input.answers.practice.client_strength_effect = "Connect diligence findings to purchase agreement terms.";
    const invalid = validBlueprint(input.answers);
    invalid.brief.why_client_chooses_firm.claims = [evidence("The firm identifies relevant matter experience as a strength for this engagement.", "firm_reported_experience", "practice.client_strength")];
    const repaired = {claims:[evidence("The firm identifies relevant matter experience as a strength for this engagement.", "firm_preference", "practice.client_strength")]};
    provider.generate.mockResolvedValueOnce({response:{text:()=>JSON.stringify(invalid)}})
      .mockResolvedValueOnce({response:{text:()=>JSON.stringify(repaired)}});
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const instruction = provider.configure.mock.calls[1][0].systemInstruction;
    expect(instruction).toContain("A chosen strength or its proposed benefit is a firm preference");
    expect(instruction).toContain("Do not add an unrelated experience citation to upgrade a selected strength");
    if (outcome.mode === "live") expect(outcome.result.brief.why_client_chooses_firm.claims[0].evidence_basis).toBe("firm_preference");
  });
  it("repairs an unsupported first-contact claim as an explicit evidence gap", async () => {
    const input = request();
    input.answers.client.pathway_basis = "firm_observation";
    input.answers.client.decision_context = "The owner decides, with an accountant involved.";
    const invalid = validBlueprint();
    invalid.brief.decision_pathway.trigger = {
      text: "The firm observes that a planned business purchase prompts the need for legal advice.",
      source_answer_ids: ["situation.trigger", "client.pathway_basis"],
      evidence_basis: "firm_reported_observation",
      kind: "experience",
    };
    invalid.brief.decision_pathway.decision = {
      text: "The firm observes that the owner decides, with an accountant involved.",
      source_answer_ids: ["client.decision_context", "client.pathway_basis"],
      evidence_basis: "firm_reported_observation",
      kind: "experience",
    };
    invalid.brief.decision_pathway.first_contact = {
      text: "The buyer initiates contact during the planning stage.",
      source_answer_ids: ["situation.timing", "client.pathway_basis"],
      evidence_basis: "client_reported",
      kind: "experience",
    };
    const repaired = {
      text: "Who initiates first contact and how the buyer reaches the firm are not established.",
      source_answer_ids: ["situation.contact"],
      evidence_basis: "unknown",
      kind: "unknown",
    };
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(repaired) } });
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("Do not infer contact behaviour from the client's role, timing or decision context");
    if (outcome.mode === "live") {
      expect(outcome.result.brief.decision_pathway.first_contact.evidence_basis).toBe("unknown");
      expect(outcome.result.brief.decision_pathway.first_contact.source_answer_ids).toEqual(["situation.contact"]);
    }
  });
  it("repairs a pathway basis to match the firm's selected observation source", async () => {
    const input = request();
    input.answers.client.pathway_basis = "firm_observation";
    const invalid = validBlueprint();
    invalid.brief.decision_pathway.trigger = {
      text: "The client reports that a planned purchase prompts them to seek legal advice.",
      source_answer_ids: ["situation.trigger", "client.pathway_basis"],
      evidence_basis: "client_reported",
      kind: "experience",
    };
    const repaired = {
      text: "The firm observes that a planned business purchase can prompt a need for legal advice.",
      source_answer_ids: ["situation.trigger", "client.pathway_basis"],
      evidence_basis: "firm_reported_observation",
      kind: "experience",
    };
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(repaired) } });
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("client.pathway_basis is firm_observation");
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("client_reported is incorrect");
    if (outcome.mode === "live") expect(outcome.result.brief.decision_pathway.trigger.evidence_basis).toBe("firm_reported_observation");
  });
  it("repairs a claim that mixes client feedback and a differently based firm observation", async () => {
    const input = request();
    input.answers.client.choice_basis = "client_feedback";
    input.answers.client.choice_priorities = ["clear_fees"];
    input.answers.client.pathway_basis = "firm_observation";
    input.answers.client.decision_context = "The owner decides, with accountant input.";
    const invalid = validBlueprint();
    invalid.brief.why_client_chooses_firm.claims[0] = {
      text: "Clients identify clear fees as relevant.",
      source_answer_ids: ["client.choice_priorities", "client.choice_basis"],
      evidence_basis: "client_reported",
      kind: "experience",
    };
    invalid.brief.decision_pathway = {
      trigger: {text:"Clients say the purchase prompts them to seek advice, while the firm observes that the owner decides with accountant input.",source_answer_ids:["situation.trigger","client.choice_basis","client.pathway_basis","client.decision_context"],evidence_basis:"client_reported",kind:"experience"},
      first_contact: {text:"The buyer may begin by asking what advice the agreement requires.",source_answer_ids:["client.goal_detail"],evidence_basis:"hypothesis",kind:"hypothesis"},
      decision: {text:"The firm observes that the owner decides, with accountant input.",source_answer_ids:["client.decision_context","client.pathway_basis"],evidence_basis:"firm_reported_observation",kind:"experience"},
      desired_progress: {text:"The buyer wants to understand the available options.",source_answer_ids:["client.goals"],evidence_basis:"hypothesis",kind:"hypothesis"},
    };
    invalid.brief.client_goals_needs.claims[0] = {
      text: "Clients prioritize clear fees, and the firm observes that the owner decides with accountant input.",
      source_answer_ids: ["client.choice_priorities", "client.choice_basis", "client.decision_context", "client.pathway_basis"],
      evidence_basis: "client_reported",
      kind: "experience",
    };
    const repaired = {claims:[
      {text:"Clients identify clear fees as relevant.",source_answer_ids:["client.choice_priorities","client.choice_basis"],evidence_basis:"client_reported",kind:"experience"},
      {text:"The firm observes that the owner decides with accountant input.",source_answer_ids:["client.decision_context","client.pathway_basis"],evidence_basis:"firm_reported_observation",kind:"experience"},
    ]};
    const repairedTrigger = {text:"A planned business purchase may prompt a buyer to seek advice.",source_answer_ids:["situation.trigger"],evidence_basis:"hypothesis",kind:"hypothesis"};
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(repaired) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(repairedTrigger) } });
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(3);
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("If a statement cites both source groups, cite both basis answers");
    expect(provider.configure.mock.calls[2][0].systemInstruction).toContain("source_answer_path_not_allowed_for_slot");
    if (outcome.mode === "live") {
      expect(outcome.result.brief.client_goals_needs.claims).toHaveLength(2);
      expect(outcome.result.brief.decision_pathway.trigger.evidence_basis).toBe("hypothesis");
    }
  });
});
