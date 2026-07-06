/**
 * Tests for the client-provisioning endpoint (POST /api/admin/provision-clients).
 *
 * Focus: the dual auth gate (hardening pass, 2026-07-06). This was the only
 * route under /api/admin/** that accepted ONLY a shared secret; it now also
 * accepts the operator session used everywhere else in that tree. Also
 * covers the fixed bug where an unset ADMIN_API_SECRET used to 500 the
 * whole route even for a legitimate operator session.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  operatorSession: { firm_id: string; role: "operator"; exp: number } | null;
}

const state: MockState = {
  operatorSession: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

// Minimal one-entry fixture matching the real ClientConfig shape closely
// enough for provisionClient() to run its Supabase calls without throwing.
vi.mock("@/lib/client-configs", () => ({
  CLIENT_CONFIGS: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      slug: "fixture-firm",
      name: "Fixture Firm",
      description: "a fixture firm for tests",
      location: "Toronto, Ontario",
      website: "https://fixture.example",
      practice_areas: [{ id: "civ", label: "Civil Litigation", classification: "primary" }],
      geographic_config: { service_area: "Toronto, Ontario", gta_core_description: "Toronto" },
      branding: {
        accent_color: "#000000",
        firm_description: "fixture",
        tagline: "fixture",
        assistant_name: "Fixture",
        phone_number: "000-000-0000",
        phone_tel: "+10000000000",
        booking_url: "https://fixture.example/book",
        privacy_policy_url: "https://fixture.example/privacy",
      },
    },
  ],
  buildClientQuestionSets: () => ({}),
}));

const selectMaybeSingle = vi.fn();
const upsert = vi.fn();
const updateEq = vi.fn();

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: selectMaybeSingle,
        }),
      }),
      upsert: (...args: unknown[]) => upsert(...args),
      update: () => ({
        eq: updateEq,
      }),
    }),
  },
}));

const ORIGINAL_SECRET = "test-admin-secret-value";

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/provision-clients", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  state.operatorSession = null;
  process.env.ADMIN_API_SECRET = ORIGINAL_SECRET;
  selectMaybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  upsert.mockReset().mockResolvedValue({ error: null });
  updateEq.mockReset().mockResolvedValue({ error: null });
});

describe("POST /api/admin/provision-clients auth gate", () => {
  it("returns 401 when neither an operator session nor x-admin-secret is present", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 for an invalid x-admin-secret with no operator session", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeReq({ "x-admin-secret": "wrong-secret" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("succeeds with a valid x-admin-secret header", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeReq({ "x-admin-secret": ORIGINAL_SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
  });

  it("succeeds with a valid operator session even when ADMIN_API_SECRET is unset", async () => {
    delete process.env.ADMIN_API_SECRET;
    state.operatorSession = { firm_id: "any", role: "operator", exp: Date.now() + 1000 };
    const { POST } = await import("../route");
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
  });

  it("returns 401 for an x-admin-secret request when ADMIN_API_SECRET is unset (no operator session)", async () => {
    delete process.env.ADMIN_API_SECRET;
    const { POST } = await import("../route");
    const res = await POST(makeReq({ "x-admin-secret": "anything" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("succeeds via the session path when both a valid operator session AND ADMIN_API_SECRET are present", async () => {
    state.operatorSession = { firm_id: "any", role: "operator", exp: Date.now() + 1000 };
    const { POST } = await import("../route");
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
  });
});
