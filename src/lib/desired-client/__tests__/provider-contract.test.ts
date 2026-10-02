import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeAnswers, validBlueprint } from "./blueprint-helpers";
import { decodeProviderSources, providerBlueprintSchema, providerSourceAliases } from "../provider-schema";
import { runDesiredClientAnalysis } from "../analyze";
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
    expect(config.generationConfig.responseSchema).toEqual(providerBlueprintSchema(request().answers));
    const aliases = providerSourceAliases(request().answers);
    const sourceIds = config.generationConfig.responseSchema.properties.brief.properties.client_and_matter.properties.claims.items.properties.source_answer_ids.items.enum;
    expect(sourceIds.map((id: string) => aliases[id])).not.toContain("practice.direction");
    expect(sourceIds.map((id: string) => aliases[id])).toContain("focus.work");
    const roleAlias = Object.keys(aliases).find(id => aliases[id] === "situation.role")!;
    expect(decodeProviderSources({source_answer_ids:[roleAlias,roleAlias,"invalid"]},aliases)).toEqual({source_answer_ids:["situation.role","invalid"]});
    expect(config.generationConfig.responseSchema.properties.brief.required).toContain("client_and_matter");
    expect(config.generationConfig.responseSchema.properties.brief.properties.client_and_matter.properties.claims.maxItems).toBeUndefined();
    expect(config.generationConfig.responseSchema.properties.brief.properties.definition_components.properties.client.properties.evidence_basis.enum).toContain("hypothesis");
    expect(config.generationConfig.responseSchema.properties.brief.properties.definition_components.properties.client.properties.evidence_basis.enum).not.toContain("firm_reported_experience");
    expect(sourceIds.map((id: string) => aliases[id])).not.toContain("client_context.geography");
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
  it("separates client feedback from firm-observed decision evidence when their bases differ", () => {
    const answers = completeAnswers();
    answers.client.choice_basis = "client_feedback";
    answers.client.pathway_basis = "firm_observation";
    const aliases = providerSourceAliases(answers);
    const schema = providerBlueprintSchema(answers) as {properties:{brief:{properties:{client_goals_needs:{properties:{claims:{items:{properties:{evidence_basis:{description:string};source_answer_ids:{items:{enum:string[]}}}}}}}}}}};
    const claim = schema.properties.brief.properties.client_goals_needs.properties.claims.items.properties;
    const evidenceDescription = claim.evidence_basis.description;
    expect(evidenceDescription).toContain("Keep claims separate when client.choice_basis and client.pathway_basis differ");
    expect(evidenceDescription).toContain("client.choice_basis");
    expect(evidenceDescription).toContain("client.pathway_basis");
    expect(claim.source_answer_ids.items.enum.map(id => aliases[id])).toContain("client.choice_priorities");
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
      trigger: {text:"A business purchase may prompt the buyer to seek advice.",source_answer_ids:["situation.trigger"],evidence_basis:"hypothesis",kind:"hypothesis"},
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
    provider.generate.mockResolvedValueOnce({ response: { text: () => JSON.stringify(invalid) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(repaired) } });
    const outcome = await runDesiredClientAnalysis(input, []);
    expect(outcome.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.configure.mock.calls[1][0].systemInstruction).toContain("When those bases differ, write separate claims");
    if (outcome.mode === "live") expect(outcome.result.brief.client_goals_needs.claims).toHaveLength(2);
  });
});
