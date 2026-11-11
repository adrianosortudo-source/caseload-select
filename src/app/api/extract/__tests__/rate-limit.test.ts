/**
 * Route-level tests for /api/extract rate limiting + body cap (H6).
 *
 * /api/extract is a public proxy in front of the Gemini extraction call
 * (the browser widget calls it, so it cannot require auth). These tests
 * pin the two gates added by the launch audit:
 *   - 429 with rate-limit headers when the per-IP bucket denies
 *   - 413 when the description exceeds the 16,000-char cap
 * plus the happy path passing through to the extractor unchanged.
 *
 * Mocks follow the intake-v2 route test pattern: rate-limit and the LLM
 * client are stubbed; the route handler itself is the SUT.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  llmExtractServer: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  rateLimitHeaders: vi.fn(() => ({ "Retry-After": "30" })),
}));

vi.mock("@/lib/screen-llm-server", () => ({
  llmExtractServer: mocks.llmExtractServer,
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("https://app.caseloadselect.ca/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ALLOWED = { ok: true, active: false, remaining: 30, reset: 0, limit: 30 };
const DENIED = { ok: false, active: true, remaining: 0, reset: Date.now() + 30_000, limit: 30 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(ALLOWED);
  mocks.llmExtractServer.mockResolvedValue({
    extracted: { amount_at_stake: "$5,000–$25,000" },
    mode: "live",
  });
});

describe("/api/extract rate limiting", () => {
  it("returns 429 with rate-limit headers when the limiter denies", async () => {
    mocks.checkRateLimit.mockResolvedValue(DENIED);
    const res = await POST(makeRequest({ description: "rear-ended on the 401" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const json = await res.json();
    expect(json.error).toBe("rate limited");
    expect(typeof json.retry_after_seconds).toBe("number");
    expect(mocks.llmExtractServer).not.toHaveBeenCalled();
  });

  it("charges the extract bucket", async () => {
    await POST(makeRequest({ description: "rear-ended on the 401" }));
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("extract", "203.0.113.9");
  });

  it("returns 413 when the description exceeds the cap and never calls the LLM", async () => {
    const res = await POST(makeRequest({ description: "x".repeat(16_001) }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("description too long");
    expect(mocks.llmExtractServer).not.toHaveBeenCalled();
  });

  it("passes an allowed request through to the extractor unchanged", async () => {
    const res = await POST(
      makeRequest({ description: "A client has not paid our business invoice", matter_type: "corporate_general" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe("live");
    expect(json.extracted).toEqual({ amount_at_stake: "$5,000–$25,000" });
    expect(mocks.llmExtractServer).toHaveBeenCalledTimes(1);
  });

  it("passes the complete accepted long description to the provider helper", async () => {
    const description = "x".repeat(16_000);
    const res = await POST(makeRequest({ description }));
    expect(res.status).toBe(200);
    expect(mocks.llmExtractServer).toHaveBeenCalledWith(description, expect.anything(), 16_000);
  });

  it("keeps the empty-description short-circuit (no LLM call, no 4xx)", async () => {
    const res = await POST(makeRequest({ description: "   " }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe("disabled");
    expect(mocks.llmExtractServer).not.toHaveBeenCalled();
  });
});
