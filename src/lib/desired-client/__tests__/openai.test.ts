import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestOpenAI } from "@/lib/ai/openai";
import { runDesiredClientAnalysis } from "../analyze";
import { runInterviewClarification } from "../interview-clarification";
import { completeAnswers, providerBlueprint, validBlueprint } from "./blueprint-helpers";

vi.mock("@/lib/ai/openai", async (original) => ({
  ...await original<typeof import("@/lib/ai/openai")>(), requestOpenAI: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv("DESIRED_CLIENT_PROVIDER", "openai");
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "fictional-project-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("OpenAI Best Case Profile", () => {
  const ids = { schemaVersion: 4, requestId: "11111111-1111-4111-8111-111111111111", aiConsent: true } as const;
  it("validates the full structured blueprint and accounts for the reserved call", async () => {
    const answers = completeAnswers();
    const response = providerBlueprint(validBlueprint(answers), answers) as { brief: Record<string, unknown> };
    delete response.brief.why_firm_wants_work;
    vi.mocked(requestOpenAI).mockResolvedValue({
      text: JSON.stringify(response), inputTokens: 100, outputTokens: 20,
    });
    const reserve = vi.fn(async (expected: number) => ({ status: "reserved" as const, callsUsed: expected + 1 }));
    const result = await runDesiredClientAnalysis({
      ...ids, operation: "generate", answers, answerRevision: answers.revision,
      reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0, clarifications: [],
    }, [], 3, reserve);
    expect(result).toMatchObject({ mode: "live", providerCallsUsed: 1, providerCallLimit: 3 });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith(0);
    expect(requestOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-6-luna", maxOutputTokens: 4096, format: expect.objectContaining({
        schema: expect.objectContaining({ type: "object", required: ["brief"], additionalProperties: false }),
      }),
    }));
  });

  it("honours a structured continue and keeps an invalid question out of the interview", async () => {
    const answers = completeAnswers();
    answers.interview.ai_clarification_consent = true;
    const req = {
      ...ids, operation: "clarify" as const, answers, answerRevision: answers.revision,
      interviewRunId: "22222222-2222-4222-8222-222222222222", clarificationIndex: 0 as const, stage: 1 as const,
    };
    const mock = vi.mocked(requestOpenAI);
    mock.mockResolvedValueOnce({ text: JSON.stringify({ outcome: "continue", prompt: null, reason: "The goal is clear." }), inputTokens: 10, outputTokens: 4 })
      .mockResolvedValueOnce({ text: JSON.stringify({ outcome: "ask", prompt: {}, reason: null }), inputTokens: 10, outputTokens: 4 });
    expect(await runInterviewClarification(req)).toMatchObject({ mode: "live", response: { prompt: { outcome: "continue" } } });
    expect(await runInterviewClarification(req)).toMatchObject({ mode: "invalid_output" });
    expect(mock).toHaveBeenCalledTimes(2);
    const root = mock.mock.calls[0][0].format?.schema;
    expect(root?.properties).toMatchObject({ prompt: { type: ["object","null"], additionalProperties: false }, reason: { type: ["string","null"] } });
  });
});
