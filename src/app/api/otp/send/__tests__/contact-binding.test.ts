/**
 * Codex re-audit CP-02 pin: /api/otp/send must bind the OTP recipient to the
 * email captured during intake (intake_sessions.contact.email), not the email
 * supplied in the request body. The previous shape let an attacker who learned
 * a valid session_id receive the OTP at an arbitrary address and verify the
 * session.
 *
 * Contract:
 *   - email matches captured contact -> 200, OTP delivered to captured email
 *   - email does NOT match contact -> 403, no email sent, no DB write
 *   - contact has no email yet -> 422, no email sent, no DB write
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  session: {
    data: {
      id: "sess-1",
      status: "in_progress",
      contact: { email: "captured@example.com" } as { email?: string } | Record<string, unknown>,
    },
    error: null as { message: string } | null,
  },
}));

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({
    ok: true,
    active: false,
    remaining: 5,
    reset: 0,
    limit: 5,
  })),
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  rateLimitHeaders: vi.fn(() => ({})),
}));

vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));

vi.mock("@/lib/supabase-admin", () => {
  const from = (table: string) => ({
    select: () => ({
      eq: () => ({
        single: () =>
          Promise.resolve(
            table === "intake_sessions"
              ? state.session
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

function makeRequest(email: string): Request {
  return new Request("https://app.caseloadselect.ca/api/otp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "sess-1", email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendEmail.mockResolvedValue({ skipped: true });
  state.updates = [];
  state.session = {
    data: {
      id: "sess-1",
      status: "in_progress",
      contact: { email: "captured@example.com" },
    },
    error: null,
  };
});

describe("CP-02: OTP send binds to captured contact email", () => {
  it("happy path: requested email matches captured contact, OTP delivered", async () => {
    const res = await POST(makeRequest("captured@example.com"));
    expect(res.status).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const recipient = mocks.sendEmail.mock.calls[0]![0];
    expect(recipient).toBe("captured@example.com");
    expect(state.updates).toHaveLength(1); // OTP code written
  });

  it("case-insensitive match (the captured email is canonicalized lowercase)", async () => {
    const res = await POST(makeRequest("CAPTURED@Example.COM"));
    expect(res.status).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0]![0]).toBe("captured@example.com");
  });

  it("403 when the request email does not match the captured contact", async () => {
    const res = await POST(makeRequest("attacker@evil.tld"));
    expect(res.status).toBe(403);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0); // no OTP stored
  });

  it("422 when the session has no captured contact email yet", async () => {
    state.session.data = {
      id: "sess-1",
      status: "in_progress",
      contact: {},
    };
    const res = await POST(makeRequest("anybody@example.com"));
    expect(res.status).toBe(422);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });
});
