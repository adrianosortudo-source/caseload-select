import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestOpenAI } from "../openai";
import { withWebsiteReviewBudget, requestVoiceOpenAI, requestWebsiteOpenAI } from "../public-tool-pilot-budget";
import { runOpenAIVoiceTurn } from "@/lib/firm-voice-builder/openai";
import { newVoiceAssignment, voiceTurnProvider } from "../voice-rollout";

const { evalRedis } = vi.hoisted(() => ({ evalRedis: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class { eval = evalRedis; } }));
vi.mock("../openai", async (original) => ({
  ...await original<typeof import("../openai")>(), requestOpenAI: vi.fn(),
}));

const website = { model: "gpt-6.1-terra", input: "Public page.", maxOutputTokens: 3072 };
const voice = { model: "gpt-6-luna", input: "Synthetic answer.", maxOutputTokens: 16384 };
const usage = { text: "Test", inputTokens: 100, outputTokens: 23 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T17:00:00Z"));
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "test-key");
  evalRedis.mockReset().mockResolvedValue(1);
  vi.mocked(requestOpenAI).mockReset().mockResolvedValue(usage);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("grant-period public tool budgets", () => {
  it("reserves before both requests, charges bounded usage, and requests Standard processing", async () => {
    await withWebsiteReviewBudget("openai", undefined, 3072, async provider => {
      expect(provider).toBe("openai");
      await requestWebsiteOpenAI(website);
      await requestWebsiteOpenAI(website);
    });
    expect(evalRedis).toHaveBeenCalledTimes(4);
    for (const i of [0, 2]) {
      const [script, [key], [expiry, allowance, debit, id]] = evalRedis.mock.calls[i];
      expect(script).toContain("HINCRBY");
      expect(key).toContain("websites:grant-ending-2026-12-09");
      expect(expiry).toBe(Date.UTC(2026, 11, 9) / 1000);
      expect(allowance).toBe(20_000_000);
      expect(debit).toBe(922_000 * 8 + 3072 * 9);
      expect(evalRedis.mock.calls[i + 1][2]).toEqual([id, 100 * 8 + 23 * 9]);
    }
    expect(evalRedis.mock.calls[0][2][3]).not.toBe(evalRedis.mock.calls[2][2][3]);
    expect(requestOpenAI).toHaveBeenCalledWith({ ...website, serviceTier: "default" });
  });

  it("keeps new runs on Gemini on saturation or storage failure and preserves an assigned Voice session", async () => {
    evalRedis.mockResolvedValueOnce(0).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(0);
    expect(await withWebsiteReviewBudget("openai", undefined, 3072, async p => p)).toBe("gemini");
    expect(await withWebsiteReviewBudget("openai", undefined, 3072, async p => p)).toBe("gemini");
    expect(await runOpenAIVoiceTurn([])).toEqual({ mode: "error", reason: "pilot_capacity" });
    expect(evalRedis.mock.calls[2][1][0]).toContain("voice:grant-ending-2026-12-09");
    expect(evalRedis.mock.calls[2][2][1]).toBe(10_000_000);
    expect(requestOpenAI).not.toHaveBeenCalled();
  });

  it("keeps ambiguous calls or invalid metadata fully reserved and releases an unused reservation", async () => {
    vi.mocked(requestOpenAI).mockRejectedValueOnce(new Error("upstream")).mockResolvedValueOnce({ ...usage, inputTokens: 0 });
    await expect(requestWebsiteOpenAI(website)).rejects.toThrow("upstream");
    await requestVoiceOpenAI(voice);
    expect(evalRedis).toHaveBeenCalledTimes(2);
    await withWebsiteReviewBudget("openai", undefined, 3072, async () => "no call needed");
    expect(evalRedis).toHaveBeenCalledTimes(4);
    expect(evalRedis.mock.calls[3][2]).toEqual([evalRedis.mock.calls[2][2][3], 0]);
  });

  it("blocks expired grants and unpriced models and keeps preview enforcement explicit", async () => {
    vi.stubEnv("FIRM_VOICE_BUILDER_PROVIDER", "openai");
    vi.stubEnv("FIRM_VOICE_BUILDER_OPENAI_PERCENT", "100");
    const session = newVoiceAssignment();
    expect(session.provider).toBe("openai");
    await expect(requestWebsiteOpenAI({ ...website, model: "unpriced" })).rejects.toThrow();
    vi.setSystemTime(new Date("2026-12-09T00:00:00Z"));
    expect(newVoiceAssignment().provider).toBe("gemini");
    expect(voiceTurnProvider(new Headers({
      "X-CaseLoad-AI-Provider": "openai", "X-CaseLoad-Voice-Assignment": session.token,
    }))).toBeNull();
    await expect(requestVoiceOpenAI(voice)).rejects.toThrow();
    expect(await withWebsiteReviewBudget("openai", undefined, 3072, async p => p)).toBe("gemini");
    expect(requestOpenAI).not.toHaveBeenCalled();
    expect(evalRedis).not.toHaveBeenCalled();
    vi.stubEnv("VERCEL_ENV", "preview");
    await expect(requestWebsiteOpenAI(website)).resolves.toEqual(usage);
    vi.stubEnv("CASELOAD_OPENAI_PILOT_BUDGET", "true");
    await expect(requestWebsiteOpenAI(website)).rejects.toThrow();
    expect(requestOpenAI).toHaveBeenCalledTimes(1);
  });
});
