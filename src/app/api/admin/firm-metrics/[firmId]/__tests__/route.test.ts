/**
 * Tests for GET /api/admin/firm-metrics/[firmId].
 *
 * Focus: the requireOperator gate (Codex audit 2026-07-07, finding 1). The
 * route previously inverted requireOperator()'s contract (null = authorized,
 * NextResponse = denied), so unauthenticated callers fell through to the firm
 * analytics + GA4 + Vercel reads while real operators got 401. These tests
 * pin both directions AND prove that an unauthorized request never reaches
 * Supabase, GA4, or Vercel.
 *
 * The real @/lib/admin-auth is exercised; only its getOperatorSession
 * dependency (cookie read) is mocked. Supabase and the two analytics clients
 * are mocked with call spies so we can assert they are NOT touched on the
 * denied path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  operatorSession: { firm_id: string; role: "operator"; exp: number } | null;
  firmRow: { ga4_property_id: string | null; vercel_project_id: string | null } | null;
  firmError: { message: string } | null;
}

const state: MockState = {
  operatorSession: null,
  firmRow: null,
  firmError: null,
};

const spies = {
  from: vi.fn(),
  fetchGA4Metrics: vi.fn(),
  fetchVercelProjectStatus: vi.fn(),
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      spies.from(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: state.firmRow, error: state.firmError }),
      };
      return chain;
    },
  },
}));

vi.mock("@/lib/google-analytics", () => ({
  fetchGA4Metrics: (id: string) => {
    spies.fetchGA4Metrics(id);
    return Promise.resolve({ configured: true, sessions: 1 });
  },
}));

vi.mock("@/lib/vercel-analytics-api", () => ({
  fetchVercelProjectStatus: (id: string) => {
    spies.fetchVercelProjectStatus(id);
    return Promise.resolve({ configured: true, projectName: "p", deepLinks: { analytics: "a", speedInsights: "s", deployments: "d" } });
  },
}));

import { GET } from "../route";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";

function makeReq(): Request {
  return {} as never;
}
function params(firmId: string): { params: Promise<{ firmId: string }> } {
  return { params: Promise.resolve({ firmId }) };
}

beforeEach(() => {
  state.operatorSession = null;
  state.firmRow = null;
  state.firmError = null;
  spies.from.mockClear();
  spies.fetchGA4Metrics.mockClear();
  spies.fetchVercelProjectStatus.mockClear();
});

describe("GET /api/admin/firm-metrics/[firmId]", () => {
  it("returns 401 for an unauthenticated caller and never touches Supabase/GA4/Vercel", async () => {
    state.operatorSession = null;
    const res = await GET(makeReq() as never, params(FIRM_ID));
    expect(res.status).toBe(401);
    // The whole point of the finding: the denied path must short-circuit
    // BEFORE the firm read and both analytics providers.
    expect(spies.from).not.toHaveBeenCalled();
    expect(spies.fetchGA4Metrics).not.toHaveBeenCalled();
    expect(spies.fetchVercelProjectStatus).not.toHaveBeenCalled();
  });

  it("proceeds for a valid operator session", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    state.firmRow = { ga4_property_id: null, vercel_project_id: null };
    const res = await GET(makeReq() as never, params(FIRM_ID));
    expect(res.status).toBe(200);
    expect(spies.from).toHaveBeenCalledWith("intake_firms");
    const body = await res.json();
    // No provider config on this firm, so both report unconfigured and the
    // provider clients are not called.
    expect(body.ga4).toEqual({ configured: false });
    expect(body.vercel).toEqual({ configured: false });
    expect(spies.fetchGA4Metrics).not.toHaveBeenCalled();
    expect(spies.fetchVercelProjectStatus).not.toHaveBeenCalled();
  });

  it("calls the configured providers for an operator when the firm has ids", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    state.firmRow = { ga4_property_id: "GA-1", vercel_project_id: "prj_1" };
    const res = await GET(makeReq() as never, params(FIRM_ID));
    expect(res.status).toBe(200);
    expect(spies.fetchGA4Metrics).toHaveBeenCalledWith("GA-1");
    expect(spies.fetchVercelProjectStatus).toHaveBeenCalledWith("prj_1");
  });

  it("returns 404 for an operator when the firm is not found", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    state.firmRow = null;
    const res = await GET(makeReq() as never, params(FIRM_ID));
    expect(res.status).toBe(404);
    expect(spies.fetchGA4Metrics).not.toHaveBeenCalled();
  });
});
