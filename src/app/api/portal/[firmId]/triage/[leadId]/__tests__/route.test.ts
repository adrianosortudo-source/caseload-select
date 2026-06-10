/**
 * Tests for the single-lead brief API endpoint
 * (GET /api/portal/[firmId]/triage/[leadId]).
 *
 * Focus: the auth gate plus the cross-firm 404 shape. The brief carries the
 * lead's full record (contact details + brief HTML), so:
 *   - lawyer with matching firm_id: 200
 *   - operator (any firm_id): 200
 *   - lawyer with mismatched firm_id: 401
 *   - client session (B1): 401 even when its firm_id matches
 *   - no session: 401
 *   - lead exists but belongs to another firm: 404 (no existence leak)
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
  lead: Record<string, unknown> | null;
  error: { message: string } | null;
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "L-2026-06-09-BRF";

const state: MockState = {
  session: null,
  lead: null,
  error: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      // Brief query chain: select().eq("lead_id").maybeSingle()
      select: (_cols: string) => ({
        eq: (_field: string, _value: unknown) => ({
          maybeSingle: () =>
            Promise.resolve({ data: state.lead, error: state.error }),
        }),
      }),
    }),
  },
}));

import { GET } from "../route";

function makeReq(): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/portal/${FIRM_ID}/triage/${LEAD_ID}`,
    { method: "GET" },
  );
}

function makeParams(): { params: Promise<{ firmId: string; leadId: string }> } {
  return { params: Promise.resolve({ firmId: FIRM_ID, leadId: LEAD_ID }) };
}

function leadRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lead_id: LEAD_ID,
    firm_id: FIRM_ID,
    status: "triaging",
    brief_json: {},
    brief_html: "<div>brief</div>",
    slot_answers: {},
    band: "B",
    matter_type: "wrongful_dismissal",
    practice_area: "employment",
    contact_name: "Sarah Example",
    contact_email: "sarah@example.com",
    contact_phone: "+14165550000",
    submitted_at: "2026-06-09T12:00:00.000Z",
    created_at: "2026-06-09T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  state.session = null;
  state.lead = null;
  state.error = null;
});

describe("GET /api/portal/[firmId]/triage/[leadId]", () => {
  it("returns 401 when no session is present", async () => {
    state.lead = leadRow();
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 for a client session even when its firm_id matches (B1)", async () => {
    state.session = { firm_id: FIRM_ID, role: "client", matter_id: "matter-1" };
    state.lead = leadRow();
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the lawyer session firm_id mismatches the URL firmId", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = leadRow();
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 200 + lead for a matching lawyer session", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = leadRow();
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.lead_id).toBe(LEAD_ID);
  });

  it("operator session bypasses the firm-match check", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "operator" };
    state.lead = leadRow();
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
  });

  it("returns 404 when the lead belongs to a different firm (no existence leak)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = leadRow({ firm_id: OTHER_FIRM_ID });
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 404 when the lead does not exist", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = null;
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(404);
  });

  it("surfaces a 500 when the supabase query errors", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer" };
    state.error = { message: "connection refused" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(500);
  });
});
