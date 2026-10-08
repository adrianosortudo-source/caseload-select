import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeAnswers, evidence, negativeEconomicsAnswers, providerBlueprint, providerCard, providerStatement, validBlueprint, type ProviderSchemaProbe } from "./blueprint-helpers";
import { decodeProviderTargetCard, providerBlueprintSchema, providerTargetClaimIds } from "../provider-schema";
import { runDesiredClientAnalysis as runAnalysis } from "../analyze";
import { validateAnalysisResult } from "../output";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildBlueprintViewModel } from "../blueprint";
import { buildDesiredClientEvidenceGroups, evidenceGroupIdsForStatement } from "../evidence-contract";
import { interviewClarificationSourceFingerprint } from "../types";
import type { AnalysisRequestEnvelope, ClarificationCode } from "../types";

const provider = vi.hoisted(() => ({ configure: vi.fn(), generate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@google/generative-ai", () => ({ GoogleGenerativeAI: class {
  getGenerativeModel(config: { systemInstruction?: string }) {
    provider.configure(config);
    const repairSlot = /Repair only ([a-z_]+(?:\.[a-z_]+)*)\./.exec(config.systemInstruction ?? "")?.[1] ?? "";
    type ProviderEvidenceGroup = { evidence_group_id: string; evidence_basis: string; kind: string; source_answer_ids: string[] };
    type ProviderPrompt = {
      evidence_groups_by_slot?: Record<string, ProviderEvidenceGroup[]>;
      grounded_target?: { client_and_matter_claims?: Array<{ text: string }> };
      grounded_target_claim_ids?: string[];
    };
    type JsonObject = Record<string, unknown>;
    const asObject = (value: unknown): JsonObject | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
    const objectArray = (value: unknown): JsonObject[] => Array.isArray(value) ? value.map(asObject).filter((item): item is JsonObject => !!item) : [];
    const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const encodeStatement = (slot: string, value: JsonObject, groups: Record<string, ProviderEvidenceGroup[]>) => {
      if (Array.isArray(value.evidence_group_ids)) return value;
      const sources = stringArray(value.source_answer_ids);
      const selected = (groups[slot] ?? []).filter(group => group.evidence_basis === value.evidence_basis && group.kind === value.kind && group.source_answer_ids.every(path => sources.includes(path)));
      const flattened = selected.flatMap(group => group.source_answer_ids);
      return { text: value.text, evidence_group_ids: flattened.length === sources.length && flattened.every(path => sources.includes(path)) ? selected.map(group => group.evidence_group_id) : [] };
    };
    const adapt = (source: unknown, prompt: ProviderPrompt) => {
      const sourceRecord = asObject(source);
      if (!sourceRecord) return source;
      const groups = prompt.evidence_groups_by_slot ?? {};
      const report = asObject(sourceRecord.brief);
      if (!report) {
        if (repairSlot === "client_and_matter" && Array.isArray(sourceRecord.claims)) {
          const expected = prompt.grounded_target?.client_and_matter_claims?.map((claim) => claim.text) ?? [];
          const actual = objectArray(sourceRecord.claims).map((claim) => claim.text);
          return expected.length === actual.length && expected.every((text: string, index: number) => text === actual[index])
            ? { claim_ids: prompt.grounded_target_claim_ids }
            : { claim_ids: ["invalid_target_claim"] };
        }
        if (Array.isArray(sourceRecord.claims) && repairSlot) {
          const slot = repairSlot.startsWith("definition_components.")
            ? ({ client: "definition_client_type", client_matter: "definition_client_matter", reasons: "definition_reasons", outcome: "definition_outcome" } as Record<string, string>)[repairSlot.split(".")[1]]
            : repairSlot.startsWith("decision_pathway.") ? repairSlot : repairSlot;
          return { claims: objectArray(sourceRecord.claims).map((claim) => encodeStatement(slot, claim, groups)) };
        }
        if (repairSlot.startsWith("decision_pathway.") && "text" in sourceRecord) return encodeStatement(repairSlot, sourceRecord, groups);
        return source;
      }
      const brief = report;
      const componentSlots = { client: "definition_client_type", client_matter: "definition_client_matter", reasons: "definition_reasons", outcome: "definition_outcome" };
      const definition_components = { ...(asObject(brief.definition_components) ?? {}) };
      for (const [field, slot] of Object.entries(componentSlots)) {
        const statement = asObject(definition_components[field]);
        if (statement) definition_components[field] = encodeStatement(slot, statement, groups);
      }
      const cards = ["client_goals_needs", "why_firm_wants_work", "why_client_chooses_firm", "recognizable_circumstances", "evidence_and_open_questions"] as const;
      const targetTexts = prompt.grounded_target?.client_and_matter_claims?.map((claim) => claim.text) ?? [];
      const targetCard = asObject(brief.client_and_matter);
      const actualTargetTexts = objectArray(targetCard?.claims).map((claim) => claim.text);
      const expectedTargetIds = prompt.grounded_target_claim_ids ?? [];
      const selectedTargetIds = stringArray(targetCard?.claim_ids);
      const targetMatches = Array.isArray(selectedTargetIds) && selectedTargetIds.length === expectedTargetIds.length && selectedTargetIds.every((id: string, index: number) => id === expectedTargetIds[index]) ||
        targetTexts.length === actualTargetTexts.length && targetTexts.every((text: string, index: number) => text === actualTargetTexts[index]);
      const mapped: JsonObject = { ...brief, definition_components, client_and_matter: { claim_ids: targetMatches ? prompt.grounded_target_claim_ids : ["invalid_target_claim"] } };
      for (const slot of cards) {
        const card = asObject(brief[slot]);
        if (card && Array.isArray(card.claims)) mapped[slot] = { ...card, claims: objectArray(card.claims).map((claim) => encodeStatement(slot, claim, groups)) };
      }
      const pathway = asObject(brief.decision_pathway);
      if (pathway) mapped.decision_pathway = Object.fromEntries(Object.entries(pathway).flatMap(([field, claim]) => {
        const statement = asObject(claim);
        return statement ? [[field, encodeStatement(`decision_pathway.${field}`, statement, groups)]] : [];
      }));
      return { ...sourceRecord, brief: mapped };
    };
    return { generateContent: async (input: string) => {
      const result = await provider.generate(input);
      try {
        const prompt = JSON.parse(input) as ProviderPrompt;
        const parsed: unknown = JSON.parse(result.response.text());
        const adapted = adapt(parsed, prompt);
        return { ...result, response: { ...result.response, text: () => JSON.stringify(adapted) } };
      } catch { return result; }
    } };
  }
} }));
const request = (): AnalysisRequestEnvelope => ({ schemaVersion: 4, operation: "generate", requestId: "11111111-1111-4111-8111-111111111111", answerRevision: 3, reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0, aiConsent: true, answers: completeAnswers(), clarifications: [] });
const runDesiredClientAnalysis = (input: AnalysisRequestEnvelope, eligibleCodes: readonly ClarificationCode[]) =>
  runAnalysis(input, eligibleCodes, 3, async (callsUsed) => ({ status: "reserved", callsUsed: callsUsed + 1 }));
const isSchemaRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function collectSchemaNodes(value: unknown, nodes: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) value.forEach(item => collectSchemaNodes(item, nodes));
  else if (isSchemaRecord(value)) {
    nodes.push(value);
    Object.values(value).forEach(item => collectSchemaNodes(item, nodes));
  }
  return nodes;
}

describe("provider output contract", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("GOOGLE_AI_API_KEY", "test-only"); });
  it("passes the nested blueprint schema to the provider and validates its response", async () => {
    const input = request();
    provider.generate.mockResolvedValue({ response: { text: () => JSON.stringify(providerBlueprint(validBlueprint(input.answers), input.answers)) } });
    expect((await runDesiredClientAnalysis(input, [])).mode).toBe("live");
    const config = provider.configure.mock.calls[0][0];
    expect(config.systemInstruction).toContain("Use only application-listed evidence groups for the exact output slot");
    expect(config.generationConfig.responseSchema).toEqual(providerBlueprintSchema(request().answers));
    const targetSelection = config.generationConfig.responseSchema.properties.brief.properties.client_and_matter;
    expect(targetSelection.required).toEqual(["claim_ids"]);
    expect(targetSelection.properties.claim_ids.items).toEqual({ type: "string" });
    expect(config.generationConfig.responseSchema.properties.brief.required).toContain("client_and_matter");
    expect(targetSelection.properties.claim_ids).not.toHaveProperty("minItems");
    expect(targetSelection.properties.claim_ids).not.toHaveProperty("maxItems");
    const definitionClient = config.generationConfig.responseSchema.properties.brief.properties.definition_components.properties.client.properties;
    expect(definitionClient.text).not.toHaveProperty("enum");
    expect(definitionClient.evidence_group_ids.items).toEqual({ type: "string" });
    expect(definitionClient.evidence_group_ids).not.toHaveProperty("minItems");
    expect(definitionClient.evidence_group_ids).not.toHaveProperty("maxItems");
    expect(definitionClient).not.toHaveProperty("evidence_basis");
    expect(definitionClient).not.toHaveProperty("source_answer_ids");
    expect(config.generationConfig.responseSchema.properties.brief.properties.evidence_and_open_questions.properties.claims.items.properties.text.description).toContain("Use only the facts supported by the selected evidence groups");
    const finalSchema = config.generationConfig.responseSchema;
    const serializedSchema = JSON.stringify(finalSchema);
    expect(serializedSchema).not.toContain("eg_");
    const schemaNodes = collectSchemaNodes(finalSchema);
    expect(schemaNodes.some(node => Object.hasOwn(node, "minItems") || Object.hasOwn(node, "maxItems"))).toBe(false);
    expect(schemaNodes.flatMap(node => Array.isArray(node.enum) ? [node.enum] : [])).toEqual([["dcm-blueprint-v4"]]);
    const requestPrompt = JSON.parse(provider.generate.mock.calls[0][0]);
    const registeredGoal = buildDesiredClientEvidenceGroups("client_goals_needs", input.answers).find(group => group.source_answer_ids.includes("client.goals"))!;
    expect(requestPrompt.evidence_groups_by_slot.client_goals_needs).toContainEqual(expect.objectContaining({ evidence_group_id: registeredGoal.id, source_answer_ids: registeredGoal.source_answer_ids }));
  });
  it("permits the complete five-source set required to ground a contribution claim", () => {
    const answers = completeAnswers();
    Object.assign(answers.value, { fee_amount:"8000", direct_cost_amount:"4800", currency:"CAD", amount_basis:"estimated", amount_scope:"per_matter" });
    const schema = providerBlueprintSchema(answers) as unknown as ProviderSchemaProbe;
    const selections = schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties.evidence_group_ids;
    const financial = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).find(group => group.id.includes("financial_estimated"));
    expect(financial?.source_answer_ids).toEqual(["value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope"]);
    expect(selections.items).toEqual({ type: "string" });
    expect(selections).not.toHaveProperty("minItems");
    expect(selections).not.toHaveProperty("maxItems");
    expect(schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties).not.toHaveProperty("source_answer_ids");
  });
  it("permits a firm-reported observation for current capacity while keeping targets as preferences", () => {
    const answers = completeAnswers();
    answers.repeatability.additional_matters = "2 comparable matters per quarter";
    const schema = providerBlueprintSchema(answers) as unknown as ProviderSchemaProbe;
    const selections = schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties.evidence_group_ids;
    expect(buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).some(group => group.id.includes("current_capacity"))).toBe(true);
    expect(selections.items).toEqual({ type: "string" });
    expect(schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties).not.toHaveProperty("evidence_basis");
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
    const schema = providerBlueprintSchema(answers) as unknown as ProviderSchemaProbe;
    const selections = schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties.evidence_group_ids;
    const context = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).find(group => group.id.includes("payment_context"));
    expect(selections.items).toEqual({ type: "string" });
    expect(selections).not.toHaveProperty("minItems");
    expect(selections).not.toHaveProperty("maxItems");
    expect(context?.source_answer_ids).toEqual(["value.payment_context", "value.payment_context_basis"]);
    expect(context?.evidence_basis).toBe(expected);
    expect(schema.properties.brief.properties.why_firm_wants_work.properties.claims.items.properties.evidence_group_ids.description).toContain("application derives those fields");
  });
  it("supplies canonical payment claims with compact sources to the initial and repair prompts", async () => {
    const input = request();
    input.answers.value.payment = "predictable";
    input.answers.value.payment_context = "Clients told the firm that the first invoice was usually paid on schedule.";
    input.answers.value.payment_context_basis = "client_feedback";
    const groundedPaymentClaims = buildStructuredBlueprintV4(input.answers).why_firm_wants_work.claims.filter((claim) =>
      claim.source_answer_ids.some((path) => ["value.payment", "value.payment_context", "value.payment_context_basis"].includes(path)),
    );
    const compactPaymentClaims = groundedPaymentClaims.map(claim => ({
      text: claim.text,
      evidence_group_ids: evidenceGroupIdsForStatement("why_firm_wants_work", claim, input.answers),
    }));

    const invalid = validBlueprint(input.answers);
    invalid.brief.why_firm_wants_work.claims = Array.from(
      { length: 8 },
      () => structuredClone(invalid.brief.why_firm_wants_work.claims[0]),
    );
    const repaired = buildStructuredBlueprintV4(input.answers).why_firm_wants_work;
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(providerBlueprint(invalid, input.answers)) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify({ claims: providerCard("why_firm_wants_work", repaired, input.answers).claims }) } });

    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const initialPrompt = JSON.parse(provider.generate.mock.calls[0][0]);
    const repairPrompt = JSON.parse(provider.generate.mock.calls[1][0]);
    expect(initialPrompt.grounded_payment_claims).toEqual(compactPaymentClaims);
    expect(repairPrompt.grounded_payment_claims).toEqual(compactPaymentClaims);
    expect(initialPrompt.instruction).toContain("copy every applicable canonical payment");
    expect(repairPrompt.grounded_payment_claims.every((claim: { evidence_group_ids: string[] }) =>
      claim.evidence_group_ids.every((id) => id.startsWith("eg_")),
    )).toBe(true);
    const repairInstruction = provider.configure.mock.calls[1][0].systemInstruction;
    expect(repairInstruction).toContain("up to seven grounded claims");
    expect(repairInstruction).toContain("grounded_payment_claims exactly");
    const cardRepair = repairInstruction.split("This card allows up to seven grounded claims.").at(-1) ?? "";
    expect(cardRepair).toContain("do not drop delivery conditions");
    expect(cardRepair).toContain("Do not include progress targets or review periods in this card");
    expect(cardRepair).not.toContain("proposed target or its review period");
    expect(cardRepair).not.toContain("proposed measure and review period");
  });
  it("asks the model to format a specific client type as a grammatically complete noun phrase", () => {
    const schema = providerBlueprintSchema(completeAnswers()) as {properties:{brief:{properties:{definition_components:{properties:{client:{properties:{text:{description:string}}}}}}}}};
    const guidance = schema.properties.brief.properties.definition_components.properties.client.properties.text.description;
    expect(guidance).toContain("plural group");
    expect(guidance).toContain("an owner or founder");
  });
  it("aligns matter guidance with the quoted description used by the formatter", () => {
    const schema=providerBlueprintSchema(completeAnswers()) as unknown as ProviderSchemaProbe;
    const serialized=JSON.stringify(schema);
    expect(serialized).toContain("specific client situation, legal engagement and timing");
    expect(serialized).toContain("evidence_group_ids");
    expect(schema.properties.brief.properties.definition_components.properties.client.properties).not.toHaveProperty("source_answer_ids");
  });
  it("separates client feedback from firm-observed decision evidence when their bases differ", () => {
    const answers = completeAnswers();
    answers.client.choice_priorities = ["clear_fees"];
    answers.client.choice_basis = "client_feedback";
    answers.client.pathway_basis = "firm_observation";
    const choiceGroups = buildDesiredClientEvidenceGroups("why_client_chooses_firm", answers);
    expect(choiceGroups.some(group => group.evidence_basis === "client_reported" && group.source_answer_ids.includes("client.choice_basis"))).toBe(true);
    const pathwayGroups = buildDesiredClientEvidenceGroups("decision_pathway.trigger", answers);
    const pathwayPaths = pathwayGroups.flatMap(group => group.source_answer_ids);
    expect(pathwayPaths).toContain("client.pathway_basis");
    expect(pathwayPaths).not.toContain("client.choice_priorities");
    expect(pathwayGroups.some(group => group.evidence_basis === "firm_reported_observation")).toBe(true);
  });
  it("allows an unanswered first-contact source only to support an explicit unknown", () => {
    const answers = completeAnswers();
    answers.client.pathway_basis = "firm_observation";
    answers.client.decision_context = "The owner decides, with an accountant involved.";
    answers.situation.contact = null;
    const schema = providerBlueprintSchema(answers) as unknown as ProviderSchemaProbe;
    const firstContact = schema.properties.brief.properties.decision_pathway.properties.first_contact.properties;
    const groups = buildDesiredClientEvidenceGroups("decision_pathway.first_contact", answers);
    expect(firstContact.evidence_group_ids.items).toEqual({ type: "string" });
    expect(firstContact.evidence_group_ids).not.toHaveProperty("minItems");
    expect(firstContact.evidence_group_ids).not.toHaveProperty("maxItems");
    expect(groups.some(group => group.source_answer_ids.length === 1 && group.source_answer_ids[0] === "situation.contact" && group.evidence_basis === "unknown")).toBe(true);
    expect(groups.flatMap(group => group.source_answer_ids)).not.toContain("client.choice_priorities");
    expect(firstContact.text.description).toContain("State that gap plainly");
    expect(firstContact.text.description).toContain("unanswered situation.contact group");
    expect(firstContact).not.toHaveProperty("evidence_basis");
  });
  it("allows all sources required by the exact negative-contribution target", async () => {
    const input = request();
    Object.assign(input.answers.value, { fee_amount:"8000", direct_cost_amount:"10000", currency:"CAD", amount_basis:"estimated", amount_scope:"per_matter" });
    const original = validBlueprint(input.answers);
    const compact = providerBlueprint(original, input.answers) as unknown as {brief:{definition_components:{reasons:{evidence_group_ids:string[]}}}};
    provider.generate.mockResolvedValue({ response: { text: () => JSON.stringify(compact) } });
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const config = provider.configure.mock.calls[0][0];
    const reason = config.generationConfig.responseSchema.properties.brief.properties.definition_components.properties.reasons.properties;
    const expected = original.brief.definition_components.reasons;
    expect(expected.source_answer_ids.length).toBeGreaterThan(0);
    expect(reason.text).not.toHaveProperty("enum");
    expect(reason.evidence_group_ids.items).toEqual({ type: "string" });
    expect(reason.evidence_group_ids).not.toHaveProperty("minItems");
    expect(reason.evidence_group_ids).not.toHaveProperty("maxItems");
    const prompt = JSON.parse(provider.generate.mock.calls[0][0]);
    expect(prompt.grounded_target.reasons).not.toHaveProperty("kind");
    expect(prompt.grounded_target.reasons.evidence_group_ids).toEqual(compact.brief.definition_components.reasons.evidence_group_ids);
    expect(prompt.grounded_target.primary_client_and_matter_claim).not.toHaveProperty("kind");
    expect(prompt.instruction).toContain("registered evidence_group_ids");
  });
  it("preserves the acquisition fixture and negative economics through the offline provider contract", async () => {
    const input = request();
    input.answers.client_context.repeat_matter_pattern = "A business buyer needs an asset purchase agreement drafted or reviewed before final terms are agreed.";
    input.answers.value.collected_fee = "15to50";
    input.answers.value.team_hours = "16to40";
    input.answers.value.payment = "predictable";
    input.answers.value.payment_context = "Clients told the firm that the first invoice was usually paid on schedule.";
    input.answers.value.payment_context_basis = "client_feedback";
    Object.assign(input.answers.value, { fee_amount: "8000", direct_cost_amount: "8500", currency: "CAD", amount_basis: "recorded", amount_scope: "per_matter" });
    input.answers.delivery.capacity = "room";
    input.answers.delivery.conditions = ["scope", "information"];
    input.answers.repeatability.additional_matters = "2 comparable matters per quarter";
    input.answers.repeatability.staffing_constraint = "Hire an associate before increasing volume.";
    input.answers.repeatability.target = "2 comparable matters retained";
    input.answers.repeatability.review_period = "after six months";
    const canonical = validBlueprint(input.answers);
    canonical.brief.recognizable_circumstances = buildStructuredBlueprintV4(input.answers).recognizable_circumstances;
    provider.generate.mockResolvedValue({ response: { text: () => JSON.stringify(providerBlueprint(canonical, input.answers)) } });

    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    const responseSchema = provider.configure.mock.calls[0][0].generationConfig.responseSchema;
    const serializedSchema = JSON.stringify(responseSchema);
    expect(serializedSchema.length).toBeLessThan(15_000);
    expect(serializedSchema).not.toContain("eg_");
    const schemaNodes = collectSchemaNodes(responseSchema);
    expect(schemaNodes.some(node => Object.hasOwn(node, "minItems") || Object.hasOwn(node, "maxItems"))).toBe(false);
    expect(schemaNodes.flatMap(node => Array.isArray(node.enum) ? [node.enum] : [])).toEqual([["dcm-blueprint-v4"]]);
    const providerPrompt = JSON.parse(provider.generate.mock.calls[0][0]);
    const openQuestionGroups = providerPrompt.evidence_groups_by_slot.evidence_and_open_questions as Array<{ evidence_group_id: string; source_answer_ids: string[]; evidence_basis: string; kind: string }>;
    expect(openQuestionGroups).toHaveLength(71);
    const financialGroup = buildDesiredClientEvidenceGroups("why_firm_wants_work", input.answers).find(group => group.id.includes("financial_recorded"))!;
    expect(providerPrompt.evidence_groups_by_slot.why_firm_wants_work).toContainEqual(expect.objectContaining({ evidence_group_id: financialGroup.id, source_answer_ids: financialGroup.source_answer_ids, evidence_basis: financialGroup.evidence_basis, kind: financialGroup.kind }));
    if (outcome.mode !== "live") return;
    const brief = outcome.result.brief;
    const whyWork = brief.why_firm_wants_work.claims;
    const economics = whyWork.find(claim => claim.source_answer_ids.includes("value.fee_amount"));
    const payment = whyWork.find(claim => claim.source_answer_ids.includes("value.payment_context"));
    const capacity = whyWork.find(claim => claim.source_answer_ids.includes("delivery.capacity"));
    const staffing = whyWork.find(claim => claim.source_answer_ids.includes("repeatability.staffing_constraint"));
    expect(economics?.text).toContain("fee amount: 8000");
    expect(economics?.text).toContain("direct cost amount: 8500");
    expect(economics?.text).toContain("−C$500.00");
    expect(economics?.text).toContain("before overhead and acquisition costs");
    expect(economics?.text).toContain("do not establish net profit");
    expect(economics?.text).not.toMatch(/profitable|positive contribution/iu);
    expect(whyWork.map(claim => claim.text).join(" ")).toContain("C$15,000 to under C$50,000");
    expect(whyWork.map(claim => claim.text).join(" ")).toContain("More than 15, up to 40 hours");
    expect(payment?.text).toContain(input.answers.value.payment_context);
    expect(payment?.evidence_basis).toBe("client_reported");
    expect(capacity?.evidence_basis).toBe("firm_reported_observation");
    expect(capacity?.source_answer_ids).toContain("repeatability.additional_matters");
    expect(capacity?.source_answer_ids).not.toContain("repeatability.staffing_constraint");
    expect(staffing?.evidence_basis).toBe("firm_preference");
    expect(staffing?.source_answer_ids).not.toContain("delivery.capacity");
    expect(brief.definition_components.client_matter.text).toContain("asset purchase agreement");
    expect(brief.definition_components.outcome.text).toContain("2 comparable matters retained");
    const view = buildBlueprintViewModel(brief, input.answers, { mode: "ai", generatedAt: "2026-10-06T12:00:00.000Z", wordingReviewed: false });
    const whyWorkView = view.cards.find(card => card.id === "whyWork");
    expect(whyWorkView?.contribution).toMatchObject({ amount: "−C$500.00", margin: { amount: "−6.25%" } });
    expect(view.conditions.some(condition => condition.includes("negative contribution of −C$500.00"))).toBe(true);
    expect(view.progressReview.target).toBe("2 comparable matters retained");
    expect(view.progressReview.reviewPeriod).toBe("after six months");
    expect(view.sourceDetails.some(detail => detail.answers.some(source => source.path === "delivery.conditions"))).toBe(true);
  });
  it("repairs a positive economic claim against negative contribution without merging evidence bases", async () => {
    const input=request();
    Object.assign(input.answers.value,{fee_amount:"4800",direct_cost_amount:"8000",currency:"CAD",amount_basis:"estimated",amount_scope:"per_matter"});
    const invalid=validBlueprint(input.answers);
    invalid.brief.why_firm_wants_work.claims[0]=evidence("These fees support the effort and make the work profitable.","firm_reported_estimate","value.fee_amount","value.direct_cost_amount","value.currency","value.amount_basis","value.amount_scope");
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
    expect(decodeProviderTargetCard(reordered,input.answers)).toMatchObject({brief:{client_and_matter:{provider_target_selection_invalid:true}}});
    const invalid = validBlueprint(input.answers);
    const incompleteTarget = providerBlueprint(invalid,input.answers) as {brief:{client_and_matter:{claim_ids:string[]}}};
    incompleteTarget.brief.client_and_matter.claim_ids = ["target_claim_1"];
    provider.generate.mockResolvedValueOnce({response:{text:()=>JSON.stringify(incompleteTarget)}})
      .mockResolvedValueOnce({response:{text:()=>JSON.stringify({claim_ids:providerTargetClaimIds(input.answers)})}});
    const outcome = await runDesiredClientAnalysis(input,[]);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const card = provider.configure.mock.calls[0][0].generationConfig.responseSchema.properties.brief.properties.client_and_matter.properties.claim_ids;
    expect(card.items).toEqual({ type: "string" });
    expect(card).not.toHaveProperty("minItems"); expect(card).not.toHaveProperty("maxItems");
    expect(JSON.parse(provider.generate.mock.calls[0][0]).grounded_target.client_and_matter_claims).toEqual(target.claims.map(claim => providerStatement("client_and_matter",claim,input.answers)));
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("Do not replace, omit, paraphrase or merge a current stage-two clarification");
    if(outcome.mode==="live") expect(outcome.result.brief.client_and_matter).toEqual(target);
  });
  it("resolves an explicit confirmed target reference without replacing other AI claims", async () => {
    const input=request();
    const original=validBlueprint(input.answers);
    const compact=providerBlueprint(original,input.answers) as {brief:Record<string,unknown>};
    provider.generate.mockResolvedValue({response:{text:()=>JSON.stringify(compact)}});
    const outcome=await runDesiredClientAnalysis(input,[]);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const prompt=JSON.parse(provider.generate.mock.calls[0][0]);
    expect(prompt.grounded_target_claim_ids).toEqual(["target_claim_1"]);
    expect(prompt.instruction).toContain("Return exact text and registered evidence_group_ids");
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
    expect(decodeProviderTargetCard(original,completeAnswers())).toMatchObject({brief:{client_and_matter:{provider_target_selection_invalid:true}}});
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
    const groups=buildDesiredClientEvidenceGroups("recognizable_circumstances",answers);
    expect(groups.some(group=>group.source_answer_ids.includes("client_context.relevant_circumstances")&&group.evidence_basis==="unknown")).toBe(true);
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
    invalid.brief.client_goals_needs.claims[0].text = "The client wants advice within 987 days.";
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(original.brief.client_and_matter) } });
    const outcome = await runDesiredClientAnalysis(request(), []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("The fragment failed unsupported_numeric_claim");
    if (outcome.mode === "live") expect(outcome.result.brief.client_and_matter).toEqual(original.brief.client_and_matter);
  });
  it("rebuilds an over-limit evidence card from the current answers without a wording repair", async () => {
    const input=request();
    const original = validBlueprint(input.answers);
    const invalid = structuredClone(original);
    invalid.brief.evidence_and_open_questions.claims = Array.from({length:7}, () => ({
      ...structuredClone(original.brief.evidence_and_open_questions.claims[0]),
      text:"The firm has 900 invented years of proven demand.",
    }));
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } });
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    if (outcome.mode === "live") {
      expect(outcome.result.brief.evidence_and_open_questions).toEqual(buildStructuredBlueprintV4(input.answers).evidence_and_open_questions);
      expect(JSON.stringify(outcome.result.brief.evidence_and_open_questions)).not.toContain("900 invented");
      expect(JSON.stringify(outcome.result.brief.evidence_and_open_questions)).not.toContain("proven demand");
    }
  });
  it("rebuilds payment evidence with separate bases and sources after mixed provider wording", async () => {
    const input = request();
    input.answers = negativeEconomicsAnswers();
    input.answerRevision = input.answers.revision;
    const original = validBlueprint(input.answers);
    const initial = providerBlueprint(original, input.answers) as { brief: Record<string, { claims: Array<Record<string, unknown>> }> };

    const groups = buildDesiredClientEvidenceGroups("evidence_and_open_questions", input.answers);
    const paymentGroup = groups.find(group => group.source_answer_ids.includes("value.payment"));
    const contextGroup = groups.find(group => group.source_answer_ids.includes("value.payment_context"));
    expect(paymentGroup).toBeDefined();
    expect(contextGroup).toBeDefined();
    expect(`${paymentGroup?.evidence_basis}/${paymentGroup?.kind}`).not.toBe(`${contextGroup?.evidence_basis}/${contextGroup?.kind}`);

    initial.brief.evidence_and_open_questions.claims = [{
      text: "Synthetic mixed-selector fixture; no provider wording is being reproduced.",
      evidence_group_ids: [paymentGroup!.id, contextGroup!.id],
    }];
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(initial) } });

    const outcome = await runDesiredClientAnalysis(input, []);

    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    if (outcome.mode === "live") {
      const payment = outcome.result.brief.evidence_and_open_questions.claims.find(claim => claim.source_answer_ids.includes("value.payment"));
      const context = outcome.result.brief.evidence_and_open_questions.claims.find(claim => claim.source_answer_ids.includes("value.payment_context"));
      expect(payment?.evidence_basis).toBe("firm_reported_observation");
      expect(context?.evidence_basis).toBe("client_reported");
      expect(payment?.source_answer_ids).not.toContain("value.payment_context");
      expect(context?.source_answer_ids).not.toContain("value.payment");
      expect(JSON.stringify(outcome.result.brief.evidence_and_open_questions)).not.toContain("Synthetic mixed-selector fixture");
      expect(outcome.result.brief.client_and_matter).toEqual(original.brief.client_and_matter);
      const canonicalFirmCard = buildStructuredBlueprintV4(input.answers).why_firm_wants_work;
      expect(outcome.result.brief.why_firm_wants_work.claims).toHaveLength(canonicalFirmCard.claims.length);
      expect(outcome.result.brief.why_firm_wants_work.claims).toEqual(expect.arrayContaining(canonicalFirmCard.claims));
    }
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
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("Select only registered evidence_group_ids for the exact slot");
    if (outcome.mode === "live") {
      expect(outcome.result.brief.client_goals_needs.claims).toHaveLength(2);
      expect(outcome.result.brief.client_goals_needs.claims[1].evidence_basis).toBe("unknown");
    }
  });
  it("rebuilds the demand gap on its unknown basis without repairing discarded provider wording", async () => {
    const input = request();
    input.answers.opportunity.sources = ["no_evidence"];
    input.answers.opportunity.uncertainty = "Referral demand has not been verified.";
    const invalid = validBlueprint(input.answers);
    invalid.brief.evidence_and_open_questions.claims = [evidence("Referral demand still needs verification.", "firm_preference", "opportunity.uncertainty")];
    provider.generate.mockResolvedValueOnce({response:{text:()=>JSON.stringify(invalid)}});
    const outcome=await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const prompt = JSON.parse(provider.generate.mock.calls[0][0]);
    const groups = prompt.evidence_groups_by_slot.evidence_and_open_questions as Array<{ evidence_group_id:string; source_answer_ids:string[]; evidence_basis:string }>;
    const gapGroup = groups.find(group => group.source_answer_ids.includes("opportunity.uncertainty"));
    const noEvidenceGroup = groups.find(group => group.source_answer_ids.includes("opportunity.sources"));
    expect(gapGroup?.evidence_basis).toBe("unknown");
    expect(noEvidenceGroup?.evidence_basis).toBe("unknown");
    const schema = provider.configure.mock.calls[0][0].generationConfig.responseSchema;
    expect(schema.properties.brief.properties.evidence_and_open_questions.properties.claims.items.properties.evidence_group_ids.items).toEqual({ type: "string" });
    expect(schema.properties.brief.properties.evidence_and_open_questions.properties.claims.items.properties.evidence_group_ids).not.toHaveProperty("minItems");
    expect(schema.properties.brief.properties.evidence_and_open_questions.properties.claims.items.properties.evidence_group_ids).not.toHaveProperty("maxItems");
    expect(groups.map(group => group.evidence_group_id)).toContain(gapGroup?.evidence_group_id);
    expect(groups.map(group => group.evidence_group_id)).toContain(noEvidenceGroup?.evidence_group_id);
    expect(schema.properties.brief.properties.evidence_and_open_questions.properties.claims.items.properties.evidence_group_ids.description).toContain("application derives those fields");
    if(outcome.mode==="live"){
      const uncertainty=outcome.result.brief.evidence_and_open_questions.claims.find(claim=>claim.source_answer_ids.includes("opportunity.uncertainty"));
      expect(uncertainty).toMatchObject({evidence_basis:"unknown",kind:"unknown"});
      expect(uncertainty?.text).toContain(input.answers.opportunity.uncertainty.replace(/[.!?]+$/u,""));
      expect(uncertainty?.text).not.toContain("Referral demand still needs verification.");
    }
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
    expect(instruction).toContain("Select only registered evidence_group_ids for the exact slot");
    if (outcome.mode === "live") expect(outcome.result.brief.why_client_chooses_firm.claims[0].evidence_basis).toBe("firm_preference");
  });
  it("repairs an unsupported first-contact claim as an explicit evidence gap", async () => {
    const input = request();
    input.answers.client.pathway_basis = "firm_observation";
    input.answers.client.decision_context = "The owner decides, with an accountant involved.";
    const invalid = providerBlueprint(validBlueprint(input.answers), input.answers) as {brief:{decision_pathway:Record<string,{evidence_group_ids:string[]}>}};
    invalid.brief.decision_pathway.first_contact.evidence_group_ids = [];
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
    const invalid = providerBlueprint(validBlueprint(input.answers), input.answers) as {brief:{decision_pathway:Record<string,{evidence_group_ids:string[]}>}};
    invalid.brief.decision_pathway.trigger.evidence_group_ids = [];
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
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("Select only registered evidence_group_ids for the exact slot");
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("Decision-pathway fields use only groups listed for that pathway slot");
    if (outcome.mode === "live") expect(outcome.result.brief.decision_pathway.trigger.evidence_basis).toBe("firm_reported_observation");
  });
  it("keeps client-choice and pathway evidence groups in their own provider slots", () => {
    const answers = completeAnswers();
    answers.client.choice_basis = "client_feedback";
    answers.client.choice_priorities = ["clear_fees"];
    answers.client.pathway_basis = "firm_observation";
    answers.client.decision_context = "The owner decides, with accountant input.";
    const choiceGroups = buildDesiredClientEvidenceGroups("why_client_chooses_firm", answers);
    const pathwayGroups = buildDesiredClientEvidenceGroups("decision_pathway.decision", answers);
    const choice = choiceGroups.find(group => group.source_answer_ids.includes("client.choice_priorities"));
    const pathway = pathwayGroups.find(group => group.source_answer_ids.includes("client.decision_context"));
    expect(choice?.evidence_basis).toBe("client_reported");
    expect(pathway?.evidence_basis).toBe("firm_reported_observation");
    expect(choiceGroups).not.toContainEqual(pathway);
    expect(pathwayGroups).not.toContainEqual(choice);
  });
});
