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
