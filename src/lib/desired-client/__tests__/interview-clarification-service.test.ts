import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeAnswers } from "./blueprint-helpers";
import { runInterviewClarification } from "../interview-clarification";
import type { InterviewClarificationRequestEnvelope } from "../types";

const provider = vi.hoisted(() => ({ configure: vi.fn(), generate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@google/generative-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@google/generative-ai")>();
  return { ...original, GoogleGenerativeAI: class {
    getGenerativeModel(config: unknown, options: unknown) {
      provider.configure(config, options); return { generateContent: provider.generate };
    }
  } };
});

function request(): InterviewClarificationRequestEnvelope {
  const answers = completeAnswers();
  answers.interview = { ai_clarification_consent: true, clarification_count: 0, clarified_stages: [], followups: [] };
  return { schemaVersion: 4, operation: "clarify", requestId: "11111111-1111-4111-8111-111111111111", answerRevision: answers.revision,
    interviewRunId: "22222222-2222-4222-8222-222222222222", clarificationIndex: 0, stage: 1, aiConsent: true, answers };
}
function ask(reflection: unknown) {
  return { outcome: "ask", prompt: { purpose: "firm_desirability", source_answer_ids: ["practice.direction"],
    question: "Why would the firm choose to repeat this work?", choices: [{ label: "Team experience" }, { label: "Enjoyment of the work" }], reflection }, reason: null };
}
const response = (value: unknown) => ({ response: { text: () => JSON.stringify(value) } });

beforeEach(() => { vi.clearAllMocks(); provider.generate.mockReset(); vi.stubEnv("GOOGLE_AI_API_KEY", "fictional-test-key"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("bounded clarification reflection repair", () => {
  it("repairs an overlong reflection while preserving the valid question, choices and sources", async () => {
    const original = ask("x".repeat(241));
    provider.generate.mockResolvedValueOnce(response(original)).mockResolvedValueOnce(response({ reflection: "The reason helps distinguish work the firm wants to repeat." }));
    const result = await runInterviewClarification(request());
    expect(result.mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const config = provider.configure.mock.calls[1][0];
    expect(config.systemInstruction).toContain("Repair only a clarification's reflection");
    expect(Object.keys(config.generationConfig.responseSchema.properties)).toEqual(["reflection"]);
    expect(provider.configure.mock.calls[1][1].timeout).toBeLessThanOrEqual(21_000);
    if (result.mode === "live" && result.response.prompt.outcome === "ask") {
      expect(result.response.prompt.question).toBe(original.prompt.question);
      expect(result.response.prompt.source_answer_ids).toEqual(original.prompt.source_answer_ids);
      expect(result.response.prompt.choices.map(choice => choice.label)).toEqual(original.prompt.choices.map(choice => choice.label));
      expect(result.response.prompt.reflection).toBe("The reason helps distinguish work the firm wants to repeat.");
    }
  });
  it.each([
    { reflection: "x".repeat(241) },
    { reflection: "Valid length.", question: "An unauthorized replacement" },
  ])("rejects a still-invalid or expanded repair without additional retries", async replacement => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    provider.generate.mockResolvedValueOnce(response(ask("private sentinel " + "x".repeat(241)))).mockResolvedValueOnce(response(replacement));
    expect(await runInterviewClarification(request())).toEqual({ mode: "invalid_output" });
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const metadata = JSON.parse(warn.mock.calls[0][0]);
    expect(metadata).toMatchObject({ validationCode: "reflection", repairAttempts: 1 });
    expect(JSON.stringify(metadata)).not.toContain("private sentinel");
  });
  it("does not repair an invalid source or change a valid response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = ask("A short reflection."); invalid.prompt.source_answer_ids = ["value.fee_amount"];
    provider.generate.mockResolvedValue(response(invalid));
    expect(await runInterviewClarification(request())).toEqual({ mode: "invalid_output" });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    provider.generate.mockReset(); provider.generate.mockResolvedValue(response(ask("A short reflection.")));
    expect((await runInterviewClarification(request())).mode).toBe("live");
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it("does not begin a repair when the original request exhausted its deadline", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(19_000);
    provider.generate.mockResolvedValue(response(ask("x".repeat(241))));
    expect(await runInterviewClarification(request())).toEqual({ mode: "invalid_output" });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});
