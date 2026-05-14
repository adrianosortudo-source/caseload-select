/**
 * Tests for src/lib/rate-limit.ts.
 *
 * What we DO test:
 *   - ipFromRequest: header parsing (x-forwarded-for chain, x-real-ip,
 *     fallback to "unknown")
 *   - checkRateLimit: fail-open posture when UPSTASH_REDIS_REST_URL /
 *     TOKEN are absent (active=false, ok=true)
 *   - rateLimitHeaders: header shape for active vs inactive decisions
 *
 * What we DON'T test:
 *   - Real Upstash round-trips. Those would need a network connection
 *     and a real Redis instance. The Upstash library is unit-tested by
 *     its maintainers; we trust their sliding-window math.
 *
 * The fail-open path matters most for this audit fix: if the operator
 * forgets to set the env vars, the limiter must NEVER block intake.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkRateLimit,
  ipFromRequest,
  rateLimitHeaders,
  type RateLimitDecision,
} from "../rate-limit";

// ─── ipFromRequest ─────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string>): Request {
  return new Request("https://example.com/test", { method: "POST", headers });
}

describe("ipFromRequest", () => {
  it("reads x-forwarded-for and takes the first entry in the chain", () => {
    const req = makeReq({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 172.16.0.1" });
    expect(ipFromRequest(req)).toBe("203.0.113.5");
  });

  it("trims whitespace around the first IP", () => {
    const req = makeReq({ "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" });
    expect(ipFromRequest(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", () => {
    const req = makeReq({ "x-real-ip": "198.51.100.42" });
    expect(ipFromRequest(req)).toBe("198.51.100.42");
  });

  it("returns 'unknown' when both headers are absent", () => {
    const req = makeReq({});
    expect(ipFromRequest(req)).toBe("unknown");
  });

  it("returns 'unknown' when x-forwarded-for is set but empty", () => {
    const req = makeReq({ "x-forwarded-for": "" });
    expect(ipFromRequest(req)).toBe("unknown");
  });

  it("returns 'unknown' when x-forwarded-for has only a comma (no IPs)", () => {
    const req = makeReq({ "x-forwarded-for": "," });
    expect(ipFromRequest(req)).toBe("unknown");
  });

  it("prefers x-forwarded-for over x-real-ip when both are set", () => {
    const req = makeReq({
      "x-forwarded-for": "203.0.113.5",
      "x-real-ip": "10.0.0.1",
    });
    expect(ipFromRequest(req)).toBe("203.0.113.5");
  });
});

// ─── checkRateLimit fail-open ──────────────────────────────────────────────

describe("checkRateLimit — fail-open when Upstash env vars are missing", () => {
  const origUrl = process.env.UPSTASH_REDIS_REST_URL;
  const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    if (origUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = origUrl;
    if (origToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
  });

  it("returns ok=true + active=false when env is empty (requestLink bucket)", async () => {
    const r = await checkRateLimit("requestLink", "203.0.113.5");
    expect(r.ok).toBe(true);
    expect(r.active).toBe(false);
    expect(r.limit).toBe(5);
  });

  it("returns ok=true + active=false for every bucket when env is empty", async () => {
    for (const bucket of ["requestLink", "intake", "screen", "firmOnboarding"] as const) {
      const r = await checkRateLimit(bucket, "203.0.113.5");
      expect(r.ok).toBe(true);
      expect(r.active).toBe(false);
    }
  });

  it("returns the configured bucket limit even when fail-open (informational)", async () => {
    const r1 = await checkRateLimit("requestLink", "x");
    const r2 = await checkRateLimit("intake", "x");
    const r3 = await checkRateLimit("screen", "x");
    const r4 = await checkRateLimit("firmOnboarding", "x");
    expect(r1.limit).toBe(5);
    expect(r2.limit).toBe(30);
    expect(r3.limit).toBe(30);
    expect(r4.limit).toBe(10);
  });

  it("never throws when env is missing", async () => {
    await expect(checkRateLimit("requestLink", "")).resolves.toBeDefined();
    await expect(checkRateLimit("requestLink", "definitely not an ip")).resolves.toBeDefined();
  });
});

// ─── rateLimitHeaders ──────────────────────────────────────────────────────

describe("rateLimitHeaders", () => {
  it("returns empty object when limiter is inactive (fail-open)", () => {
    const decision: RateLimitDecision = {
      ok: true,
      active: false,
      remaining: 30,
      reset: 0,
      limit: 30,
    };
    expect(rateLimitHeaders(decision)).toEqual({});
  });

  it("returns full header set when limiter is active", () => {
    const reset = Date.now() + 60 * 1000;
    const decision: RateLimitDecision = {
      ok: false,
      active: true,
      remaining: 0,
      reset,
      limit: 30,
    };
    const h = rateLimitHeaders(decision);
    expect(h["X-RateLimit-Limit"]).toBe("30");
    expect(h["X-RateLimit-Remaining"]).toBe("0");
    expect(h["X-RateLimit-Reset"]).toBe(String(Math.floor(reset / 1000)));
    expect(Number(h["Retry-After"])).toBeGreaterThan(0);
  });

  it("ensures Retry-After is at least 1 second", () => {
    const decision: RateLimitDecision = {
      ok: false,
      active: true,
      remaining: 0,
      reset: Date.now() - 5000, // reset is in the past
      limit: 5,
    };
    expect(Number(rateLimitHeaders(decision)["Retry-After"])).toBeGreaterThanOrEqual(1);
  });
});
