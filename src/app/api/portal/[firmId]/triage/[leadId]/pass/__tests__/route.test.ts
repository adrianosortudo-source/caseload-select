/**
 * Tests for the Pass endpoint.
 *
 * Coverage matches the refer-route suite plus the launch-audit fixes:
 *   B1: client-role sessions get 401 (matter-scoped magic links must not
 *       reach the triage surface even with a matching firm_id).
 *   H2: already-referred returns 409; a lost status-guarded UPDATE race
 *       (count 0 / null) fires NO webhook and resolves NO decline copy.
 *
 * We mock supabase-admin, portal-auth, ghl-webhook, and decline-resolver so
 * the route handler can be exercised in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockLead {
  lead_id: string;
  firm_id: string;
  status: "triaging" | "taken" | "passed" | "declined" | "referred";
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  practice_area: string;
  submitted_at: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  intake_language: string | null;
}

interface MockState {
  session: {
    firm_id: string;
    role: "lawyer" | "operator" | "client";
    lawyer_id?: string;
    matter_id?: string;
  } | null;
  lead: MockLead | null;
  fetchError: { message: string } | null;
  updateError: { message: string } | null;
  // Affected-row count returned by the status-guarded UPDATE. 1 = won the
  // race (normal); 0 / null = the row was flipped between SELECT and UPDATE.
  updateCount: number | null;
  // What the post-race re-read of the row returns (select("status")).
  racedRow: { status: string } | null;
  webhookFired: boolean;
  webhookPayload: unknown;
  declineResolved: boolean;
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "L-2026-06-09-PSS";

const state: MockState = {
  session: null,
  lead: null,
  fetchError: null,
  updateError: null,
  updateCount: 1,
  racedRow: null,
  webhookFired: false,
  webhookPayload: null,
  declineResolved: false,
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

interface SelectChain {
  eq: (field: string, value: unknown) => SelectChain;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      // SELECT chain: eq()...eq().maybeSingle(). The bare "status" column
      // list is the lost-the-race probe; anything else is the lead fetch.
      select: (cols: string) => {
        const isRaceReread = cols.trim() === "status";
        const chain: SelectChain = {
          eq: () => chain,
          maybeSingle: () =>
            isRaceReread
              ? Promise.resolve({ data: state.racedRow, error: null })
              : Promise.resolve({ data: state.lead, error: state.fetchError }),
        };
        return chain;
      },
      // UPDATE chain: eq().eq().eq(), resolving with the affected-row count.
      // Supabase only returns a count when the caller passes
      // { count: "exact" } as the update options; without it, count is
      // null. The mock mirrors that so a route that drops the option
      // fails its race guard here, exactly as it would in production.
      update: (_patch: unknown, opts?: { count?: string }) => ({
        eq: (_f1: string, _v1: unknown) => ({
          eq: (_f2: string, _v2: unknown) => ({
            eq: (_f3: string, _v3: unknown) =>
              Promise.resolve({
                error: state.updateError,
                count: opts?.count === "exact" ? state.updateCount : null,
              }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/ghl-webhook", () => ({
  buildPassedPayload: (args: unknown) => ({ __built: "passed", ...(args as object) }),
  fireGhlWebhook: (_firmId: string, payload: unknown) => {
    state.webhookFired = true;
    state.webhookPayload = payload;
    return Promise.resolve({ fired: true });
  },
}));

vi.mock("@/lib/decline-resolver", () => ({
  loadDeclineCandidates: (_args: unknown) => {
    state.declineResolved = true;
    return Promise.resolve({});
  },
  resolveDecline: (_candidates: unknown, _trigger: string) => ({
    subject: "About your inquiry",
    body: "Thank you for reaching out.",
    source: "system_fallback",
  }),
}));

import { POST } from "../route";

function makeReq(body: unknown = {}): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/portal/${FIRM_ID}/triage/${LEAD_ID}/pass`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeParams(): { params: Promise<{ firmId: string; leadId: string }> } {
  return { params: Promise.resolve({ firmId: FIRM_ID, leadId: LEAD_ID }) };
}

function triagingLead(overrides: Partial<MockLead> = {}): MockLead {
  return {
    lead_id: LEAD_ID,
    firm_id: FIRM_ID,
    status: "triaging",
    band: "C",
    matter_type: "employment_general",
    practice_area: "employment",
    submitted_at: "2026-06-09T12:00:00.000Z",
    contact_name: "Mike Example",
    contact_email: "mike@example.com",
    contact_phone: null,
    intake_language: "en",
    ...overrides,
  };
}

beforeEach(() => {
  state.session = null;
  state.lead = null;
  state.fetchError = null;
  state.updateError = null;
  state.updateCount = 1;
  state.racedRow = null;
  state.webhookFired = false;
  state.webhookPayload = null;
  state.declineResolved = false;
});

describe("POST /api/portal/[firmId]/triage/[leadId]/pass", () => {
  it("returns 401 when no session is present", async () => {
    state.lead = triagingLead();
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
    expect(state.webhookFired).toBe(false);
  });

  it("returns 401 for a client session even when its firm_id matches (B1)", async () => {
    state.session = { firm_id: FIRM_ID, role: "client", matter_id: "matter-1" };
    state.lead = triagingLead();
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
    expect(state.webhookFired).toBe(false);
  });

  it("returns 401 when the lawyer session firm_id mismatches the URL firmId", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead();
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("operator session is authorised even with a different firm_id token", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "operator" };
    state.lead = triagingLead();
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("passed");
    expect(state.webhookFired).toBe(true);
  });

  it("returns 404 when the lead belongs to a different firm (cross-firm leak)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ firm_id: OTHER_FIRM_ID });
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(404);
  });

  it("happy path: triaging to passed + fires the passed webhook", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "lawyer-id-1" };
    state.lead = triagingLead();
    const res = await POST(makeReq({ note: "Not a fit for the firm." }) as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("passed");
    expect(body.lead_id).toBe(LEAD_ID);
    expect(state.webhookFired).toBe(true);
    const payload = state.webhookPayload as Record<string, unknown>;
    expect(payload.__built).toBe("passed");
  });

  it("idempotency: already-passed returns 200 with already=true (no webhook re-fire)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ status: "passed" });
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(state.webhookFired).toBe(false);
  });

  it("409 when the lead is already taken", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ status: "taken" });
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(409);
    expect(state.webhookFired).toBe(false);
  });

  it("409 when the lead is already referred, NO webhook (H2 guard gap)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ status: "referred" });
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current_status).toBe("referred");
    expect(state.webhookFired).toBe(false);
    expect(state.declineResolved).toBe(false);
  });

  it("lost race (count 0, row now taken): 409, NO webhook, NO decline resolution (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead();
    state.updateCount = 0;
    state.racedRow = { status: "taken" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current_status).toBe("taken");
    expect(state.webhookFired).toBe(false);
    expect(state.declineResolved).toBe(false);
  });

  it("lost race (count 0, row now passed): 200 already=true, NO webhook (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead();
    state.updateCount = 0;
    state.racedRow = { status: "passed" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(body.status).toBe("passed");
    expect(state.webhookFired).toBe(false);
    expect(state.declineResolved).toBe(false);
  });

  it("lost race (count null with no error): treated as lost, NO webhook (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead();
    state.updateCount = null;
    state.racedRow = { status: "declined" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current_status).toBe("declined");
    expect(state.webhookFired).toBe(false);
  });

  it("returns 500 when supabase update fails", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead();
    state.updateError = { message: "write failed" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(500);
    expect(state.webhookFired).toBe(false);
  });
});
