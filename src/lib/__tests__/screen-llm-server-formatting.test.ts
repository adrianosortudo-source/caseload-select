import { afterEach, describe, expect, it, vi } from "vitest";
import { initialiseState } from "../screen-engine/extractor";
import { llmExtractServer } from "../screen-llm-server";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent }; }
  },
}));
afterEach(() => { vi.unstubAllEnvs(); generateContent.mockReset(); });

describe("provider enum formatting", () => {
  it.each(["$5,000\n–$25,000", "$5,000 – $25,000", "$5,000-$25,000"])("keeps a canonical amount despite provider formatting: %s", async (amount) => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "fixture-key-never-sent");
    generateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ amount_at_stake: amount }) } });
    const result = await llmExtractServer("A fictional client owes $18,450 for delivered work.", { ...initialiseState("unpaid invoice"), matter_type: "unpaid_invoice" });
    expect(result.mode).toBe("live");
    expect(result.extracted.amount_at_stake).toBe("$5,000–$25,000");
    expect(result.dropped).toEqual({});
  });
  it("still rejects an amount outside the canonical choices", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "fixture-key-never-sent");
    generateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ amount_at_stake: "$5,000–$250,000" }) } });
    const result = await llmExtractServer("A fictional unpaid invoice.", { ...initialiseState("unpaid invoice"), matter_type: "unpaid_invoice" });
    expect(result.extracted.amount_at_stake).toBeUndefined();
    expect(result.dropped).toEqual({ amount_at_stake: "$5,000–$250,000" });
  });
});
