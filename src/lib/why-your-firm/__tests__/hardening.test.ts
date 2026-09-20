import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "../compliance";

vi.mock("server-only", () => ({}));

const originalFailClosed = process.env.RATE_LIMIT_FAIL_CLOSED;
const originalRestUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalRestToken = process.env.UPSTASH_REDIS_REST_TOKEN;

afterEach(() => {
  vi.resetModules();
  if (originalFailClosed === undefined) delete process.env.RATE_LIMIT_FAIL_CLOSED;
  else process.env.RATE_LIMIT_FAIL_CLOSED = originalFailClosed;
  if (originalRestUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = originalRestUrl;
  if (originalRestToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalRestToken;
});

describe("Why Your Firm shipping hardening", () => {
  it("keeps the assist bucket fail-closed even without the rollout flag or Redis", async () => {
    delete process.env.RATE_LIMIT_FAIL_CLOSED;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const { checkRateLimit } = await import("@/lib/rate-limit");
    const decision = await checkRateLimit("whyYourFirmAssist", "203.0.113.9");

    expect(decision.ok).toBe(false);
    expect(decision.active).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("names Gemini, the exact opt-in payload, and the confidential-data warning", () => {
    expect(copy.tool.privacyNoGateAssist).toContain("Google Gemini");
    expect(copy.tool.privacyNoGateAssist).toContain("only that claim and any proof line");
    expect(copy.tool.privacyNoGateAssist).toContain(
      "Do not enter client names, matter details, or confidential information.",
    );
  });
});
