/**
 * Route-level tests for /api/otp/verify brute-force cap (H6).
 *
 * The route previously allowed unlimited tries against a 6-digit code in
 * its 15-minute window. Pins the new behavior:
 *   - happy path unchanged (correct code verifies, counter resets)
 *   - wrong codes return { verified: false, reason: "invalid" } and
 *     increment otp_attempts
 *   - the 5th wrong attempt burns the code and returns 410 "locked"
 *   - once locked, even the correct code stays locked
 *   - a fresh code (as /api/otp/send issues it, with otp_attempts reset
 *     to 0) gets its own counter; attempts are per code, not per session
 *   - 429 when the per-IP limiter denies
 *
 * The supabase mock is a stateful in-memory session row so increments
 * and code invalidation are observable across sequential calls, same
 * capture-and-assert approach as the intake-v2 route tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  rateLimitHeaders: vi.fn(() => ({ "Retry-After": "30" })),
}));

vi.mock("@/lib/supabase-admin", () => {
  const from = (table: string) => {
    if (table === "intake_sessions") {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { ...state.session }, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => {
            Object.assign(state.session, payload);
            state.updates.push(payload);
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    if (table === "intake_firms") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { name: "Test Firm" }, error: null }),
          }),
        }),
      };
    }
    // leads table (promoteToLead path, not exercised with band=null)
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
      insert: () => Promise.resolve({ error: null }),
    };
  };
  return { supabaseAdmin: { from } };
});

import { POST } from "../route";

const CORRECT_CODE = "482913";

function freshSession(): Record<string, unknown> {
  return {
    id: "sess-1",
    otp_code: CORRECT_CODE,
    otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    otp_verified: false,
    otp_attempts: 0,
    band: null,
    firm_id: null,
    contact: {},
    practice_area: null,
    situation_summary: null,
    scoring: null,
  };
}

function makeRequest(code: string): Request {
  return new Request("https://app.caseloadselect.ca/api/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "sess-1", code }),
  });
}

const ALLOWED = { ok: true, active: false, remaining: 10, reset: 0, limit: 10 };
const DENIED = { ok: false, active: true, remaining: 0, reset: Date.now() + 30_000, limit: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(ALLOWED);
  state.session = freshSession();
  state.updates = [];
});

describe("/api/otp/verify attempt cap", () => {
  it("happy path unchanged: correct code verifies and resets the counter", async () => {
    const res = await POST(makeRequest(CORRECT_CODE));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verified).toBe(true);
    expect(state.session.otp_verified).toBe(true);
    expect(state.session.otp_code).toBeNull();
    expect(state.session.otp_attempts).toBe(0);
  });

  it("wrong codes return invalid and increment otp_attempts through attempt 4", async () => {
    for (let i = 1; i <= 4; i++) {
      const res = await POST(makeRequest("000000"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ verified: false, reason: "invalid" });
      expect(state.session.otp_attempts).toBe(i);
    }
    // Code survives until the cap is hit
    expect(state.session.otp_code).toBe(CORRECT_CODE);
  });

  it("the 5th wrong attempt returns 410 locked and burns the code", async () => {
    for (let i = 1; i <= 4; i++) {
      await POST(makeRequest("000000"));
    }
    const res = await POST(makeRequest("000000"));
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json).toEqual({ verified: false, reason: "locked" });
    expect(state.session.otp_code).toBeNull();
    expect(state.session.otp_expires_at).toBeNull();
    expect(state.session.otp_attempts).toBe(5);
  });

  it("stays locked even when the correct code is supplied afterward", async () => {
    for (let i = 1; i <= 5; i++) {
      await POST(makeRequest("000000"));
    }
    const res = await POST(makeRequest(CORRECT_CODE));
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json).toEqual({ verified: false, reason: "locked" });
    expect(state.session.otp_verified).toBe(false);
  });

  it("attempt counter is per code, not per session: a fresh code gets 5 new tries", async () => {
    // 3 failed attempts against the first code
    for (let i = 1; i <= 3; i++) {
      await POST(makeRequest("000000"));
    }
    expect(state.session.otp_attempts).toBe(3);

    // /api/otp/send issues a fresh code and resets the counter (the send
    // route's update payload; mirrored here against the in-memory row)
    Object.assign(state.session, {
      otp_code: "111222",
      otp_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      otp_attempts: 0,
    });

    // 4 more wrong tries (7 cumulative) stay "invalid", not locked
    for (let i = 1; i <= 4; i++) {
      const res = await POST(makeRequest("000000"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ verified: false, reason: "invalid" });
    }

    // and the correct fresh code still verifies
    const res = await POST(makeRequest("111222"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verified).toBe(true);
  });

  it("returns 429 with rate-limit headers when the limiter denies", async () => {
    mocks.checkRateLimit.mockResolvedValue(DENIED);
    const res = await POST(makeRequest(CORRECT_CODE));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("otpVerify", "203.0.113.9");
    expect(state.session.otp_verified).toBe(false);
  });
});
