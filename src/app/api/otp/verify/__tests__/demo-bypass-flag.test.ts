/**
 * Codex re-audit CP-03 pin: the OTP demo bypass is gated on the dedicated
 * intake_firms.is_demo boolean, NOT on a regex against intake_firms.name.
 *
 * Contract:
 *   - is_demo=true => any 6-digit code passes (sales-demo bypass)
 *   - is_demo=false => OTP enforcement is strict, even if the firm name
 *     happens to contain "[DEMO]" (rename should never weaken auth)
 *   - the bypass logs an informational line so an operator can audit if it
 *     ever fires unexpectedly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  firmIsDemo: false,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({
    ok: true, active: false, remaining: 10, reset: 0, limit: 10,
  })),
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  rateLimitHeaders: vi.fn(() => ({})),
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
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    if (table === "intake_firms") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                // Critical: the route MUST read is_demo, not name. A firm
                // whose name contains "[DEMO]" must NOT bypass unless
                // is_demo is also true.
                data: { is_demo: state.firmIsDemo, name: "Hartwell Law PC [DEMO]" },
                error: null,
              }),
          }),
        }),
      };
    }
    return {
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
      insert: () => Promise.resolve({ error: null }),
    };
  };
  return { supabaseAdmin: { from } };
});

import { POST } from "../route";

function makeRequest(code: string): Request {
  return new Request("https://app.caseloadselect.ca/api/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "sess-1", code }),
  });
}

beforeEach(() => {
  state.session = {
    id: "sess-1",
    firm_id: "firm-1",
    otp_verified: false,
    otp_code: "111111",
    otp_attempts: 0,
    otp_expires_at: new Date(Date.now() + 60_000).toISOString(),
    band: "B",
  };
  state.firmIsDemo = false;
});

describe("CP-03: OTP demo bypass keys on intake_firms.is_demo, not on name", () => {
  it("is_demo=true: any 6-digit code verifies (sales-demo path)", async () => {
    state.firmIsDemo = true;
    const res = await POST(makeRequest("999999")); // not the stored code
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
  });

  it("is_demo=false: wrong code is rejected even when firm name contains [DEMO]", async () => {
    state.firmIsDemo = false; // firm name still contains "[DEMO]" via the mock
    const res = await POST(makeRequest("999999"));
    const body = await res.json();
    expect(body.verified).toBe(false);
  });

  it("is_demo=false: correct code still verifies normally", async () => {
    state.firmIsDemo = false;
    const res = await POST(makeRequest("111111"));
    const body = await res.json();
    expect(body.verified).toBe(true);
  });

  it("is_demo=true bypass logs an informational line for operator audit", async () => {
    state.firmIsDemo = true;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await POST(makeRequest("123456"));
    expect(info).toHaveBeenCalled();
    const msg = info.mock.calls[0]![0] as string;
    expect(msg).toContain("demo bypass");
    info.mockRestore();
  });
});
