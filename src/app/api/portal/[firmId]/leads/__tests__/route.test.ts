/**
 * Tests for the legacy portal leads data API
 * (GET /api/portal/[firmId]/leads).
 *
 * Focus: the auth gate (adversarial-review fix, 2026-06-09). The route
 * serves lawyer-surface pipeline data (names, bands, CPI scores), so a
 * matter-scoped client session must never reach it, even though its
 * firm_id matches the route:
 *   - lawyer with matching firm_id: 200
 *   - client session with matching firm_id: 401
 *   - lawyer with mismatched firm_id: 401
 *   - no session: 401
 *
 * Unlike the triage routes there is no operator cross-firm bypass on the
 * legacy data routes; the session firm_id must match the URL exactly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  session: {
    firm_id: string;
    role: "lawyer" | "operator" | "client";
    lawyer_id?: string;
    matter_id?: string;
  } | null;
  rows: Array<Record<string, unknown>> | null;
  count: number | null;
  error: { message: string } | null;
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";

const state: MockState = {
  session: null,
  rows: [],
  count: 0,
  error: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => {
      // Thenable query chain: select().eq().order().range()[.eq()...] is
      // built up, then awaited. Resolves with { data, error, count }.
      const chain = {
        eq: (_f: string, _v: unknown) => chain,
        order: (_col: string, _opts?: unknown) => chain,
        range: (_from: number, _to: number) => chain,
        then: (
          resolve: (v: {
            data: unknown;
            error: { message: string } | null;
            count: number | null;
          }) => unknown,
        ) => resolve({ data: state.rows, error: state.error, count: state.count }),
      };
      return { select: (_cols: string, _opts?: unknown) => chain };
    },
  },
}));

import { GET } from "../route";

function makeReq(): Request {
  // The handler only touches req.nextUrl; a stub with a URL is enough.
  return {
    nextUrl: new URL(`https://app.caseloadselect.ca/api/portal/${FIRM_ID}/leads`),
  } as never;
}

function makeParams(): { params: Promise<{ firmId: string }> } {
  return { params: Promise.resolve({ firmId: FIRM_ID }) };
}

beforeEach(() => {
  state.session = null;
  state.rows = [];
  state.count = 0;
  state.error = null;
});

describe("GET /api/portal/[firmId]/leads", () => {
  it("returns 401 when no session is present", async () => {
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 for a client session even when its firm_id matches", async () => {
    state.session = { firm_id: FIRM_ID, role: "client", matter_id: "matter-1" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the lawyer session firm_id mismatches the URL firmId", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 200 + leads for a matching lawyer session", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.rows = [
      {
        id: "lead-1",
        name: "Sarah Example",
        case_type: "employment",
        stage: "new_lead",
        band: "B",
        cpi_score: 78,
        urgency: "high",
        created_at: "2026-06-09T12:00:00.000Z",
      },
    ];
    state.count = 1;
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0].id).toBe("lead-1");
    expect(body.total).toBe(1);
  });

  it("surfaces a 500 when the supabase query errors", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.rows = null;
    state.count = null;
    state.error = { message: "connection refused" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(500);
  });
});
