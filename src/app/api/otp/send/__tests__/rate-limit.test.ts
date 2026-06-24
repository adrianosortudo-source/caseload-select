/**
 * Route-level tests for /api/otp/send rate limiting + counter reset (H6).
 *
 * /api/otp/send emails a code to an arbitrary address on demand, so the
 * per-IP bucket is the mail-bombing gate. Pins:
 *   - 429 when the limiter denies (no DB write, no email)
 *   - a regenerated code resets otp_attempts to 0 in the same update,
 *     which is what makes the verify-side cap per code rather than
 *     per session
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  rateLimitHeaders: vi.fn(() => ({ "Retry-After": "120" })),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: mocks.sendEmail,
}));

vi.mock("@/lib/supabase-admin", () => {
  const from = (table: string) => ({
    select: () => ({
      eq: () => ({
        single: () =>
          Promise.resolve(
            table === "intake_sessions"
              ? {
                  // CP-02: include contact.email so the session-captured email
                  // matches the request body in the happy-path tests.
                  data: {
                    id: "sess-1",
                    status: "in_progress",
                    contact: { email: "lead@example.com" },
                  },
                  error: null,
                }
              : { data: null, error: null },
          ),
      }),
    }),
    update: (payload: Record<string, unknown>) => ({
      eq: () => {
        state.updates.push(payload);
        return Promise.resolve({ error: null });
      },
    }),
  });
  return { supabaseAdmin: { from } };
});

import { POST } from "../route";

function makeRequest(): Request {
  return new Request("https://app.caseloadselect.ca/api/otp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "sess-1", email: "lead@example.com" }),
  });
}

const ALLOWED = { ok: true, active: false, remaining: 5, reset: 0, limit: 5 };
const DENIED = { ok: false, active: true, remaining: 0, reset: Date.now() + 120_000, limit: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(ALLOWED);
  mocks.sendEmail.mockResolvedValue({ skipped: true });
  state.updates = [];
  delete process.env.OTP_TEST_CODE;
});

describe("/api/otp/send rate limiting", () => {
  it("returns 429 with rate-limit headers when the limiter denies, sends nothing", async () => {
    mocks.checkRateLimit.mockResolvedValue(DENIED);
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    const json = await res.json();
    expect(json.error).toBe("rate limited");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("charges the otpSend bucket", async () => {
    await POST(makeRequest());
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("otpSend", "203.0.113.9");
  });

  it("stores a fresh 6-digit code with otp_attempts reset to 0", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: true });

    expect(state.updates).toHaveLength(1);
    const update = state.updates[0];
    expect(update.otp_code).toMatch(/^\d{6}$/);
    expect(typeof update.otp_expires_at).toBe("string");
    expect(update.otp_attempts).toBe(0);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });
});
