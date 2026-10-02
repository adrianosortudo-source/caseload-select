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
});
