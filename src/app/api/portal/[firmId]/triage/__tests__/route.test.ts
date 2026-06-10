/**
 * Tests for the triage queue API endpoint (GET /api/portal/[firmId]/triage).
 *
 * Focus: the auth gate. The queue returns every triaging lead's name,
 * phone, email, and brief snapshot for a firm, so the session check is the
 * whole trust boundary:
 *   - lawyer with matching firm_id: 200
 *   - operator (any firm_id): 200
 *   - lawyer with mismatched firm_id: 401
 *   - client session (B1): 401 even when its firm_id matches
 *   - no session: 401
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
  error: { message: string } | null;
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";

const state: MockState = {
  session: null,
  rows: [],
  error: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      // Queue query chain: select().eq("firm_id").eq("status").order()
      select: (_cols: string) => ({
        eq: (_f1: string, _v1: unknown) => ({
          eq: (_f2: string, _v2: unknown) => ({
            order: (_col: string, _opts: unknown) =>
              Promise.resolve({ data: state.rows, error: state.error }),
          }),
        }),
      }),
    }),
  },
}));

import { GET } from "../route";

function makeReq(): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/portal/${FIRM_ID}/triage`,
    { method: "GET" },
  );
}

function makeParams(): { params: Promise<{ firmId: string }> } {
  return { params: Promise.resolve({ firmId: FIRM_ID }) };
}

beforeEach(() => {
  state.session = null;
  state.rows = [];
  state.error = null;
});

describe("GET /api/portal/[firmId]/triage", () => {
  it("returns 401 when no session is present", async () => {
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 for a client session even when its firm_id matches (B1)", async () => {
    state.session = { firm_id: FIRM_ID, role: "client", matter_id: "matter-1" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the lawyer session firm_id mismatches the URL firmId", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 200 + items for a matching lawyer session", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.rows = [
      {
        lead_id: "L-1",
        band: "A",
        matter_type: "wrongful_dismissal",
        practice_area: "employment",
        value_score: 8,
        complexity_score: 5,
        urgency_score: 6,
        readiness_score: 7,
        readiness_answered: true,
        whale_nurture: false,
        band_c_subtrack: null,
        decision_deadline: "2026-06-10T12:00:00.000Z",
        contact_name: "Sarah Example",
        submitted_at: "2026-06-09T12:00:00.000Z",
        brief_json: { matter_snapshot: "snap", fee_estimate: "$5k" },
      },
    ];
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].lead_id).toBe("L-1");
    expect(body.items[0].snapshot).toBe("snap");
  });

  it("operator session bypasses the firm-match check", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "operator" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it("surfaces a 500 when the supabase query errors", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer" };
    state.rows = null;
    state.error = { message: "connection refused" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(500);
  });
});
