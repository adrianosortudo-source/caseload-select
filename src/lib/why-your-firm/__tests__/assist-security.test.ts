import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mocks.generateContent };
    }
  },
}));

import { runAssist } from "../assist";

const originalGoogleKey = process.env.GOOGLE_AI_API_KEY;

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalGoogleKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
  else process.env.GOOGLE_AI_API_KEY = originalGoogleKey;
});

describe("runAssist logging", () => {
  it("never writes the visitor's claim or proof into retry logs", async () => {
    const claim = "PRIVATE CLAIM WORDING 9173";
    const proof = "CONFIDENTIAL PROOF LINE 4281";
    mocks.generateContent.mockRejectedValue(
      new Error(`429 provider echoed ${claim} and ${proof}`),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const pending = runAssist({ claim, proof });
    await vi.runAllTimersAsync();
    await pending;

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(claim);
    expect(logged).not.toContain(proof);
  });
});
