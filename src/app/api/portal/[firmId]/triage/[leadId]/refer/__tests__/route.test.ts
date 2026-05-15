/**
 * Tests for the Refer endpoint introduced by the 2026-05-15 Band D doctrine.
 *
 * Mirrors the auth + idempotency + state-machine coverage of the existing
 * pass/take routes. We mock supabase-admin, portal-auth, and ghl-webhook so
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
  session: { firm_id: string; role: "lawyer" | "operator"; lawyer_id?: string } | null;
  lead: MockLead | null;
  fetchError: { message: string } | null;
  updateError: { message: string } | null;
  webhookFired: boolean;
  webhookPayload: unknown;
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "L-2026-05-15-RFR";

const state: MockState = {
  session: null,
  lead: null,
  fetchError: null,
  updateError: null,
  webhookFired: false,
  webhookPayload: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      // SELECT chain → maybeSingle()
      select: (_cols: string) => ({
        eq: (_field: string, _value: unknown) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: state.lead,
              error: state.fetchError,
            }),
        }),
      }),
      // UPDATE chain → eq().eq().eq()
      update: (_patch: unknown) => ({
        eq: (_f1: string, _v1: unknown) => ({
          eq: (_f2: string, _v2: unknown) => ({
            eq: (_f3: string, _v3: unknown) =>
              Promise.resolve({ error: state.updateError }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/ghl-webhook", () => ({
  buildReferredPayload: (args: unknown) => ({ __built: "referred", ...(args as object) }),
  fireGhlWebhook: (_firmId: string, payload: unknown) => {
    state.webhookFired = true;
    state.webhookPayload = payload;
    return Promise.resolve({ fired: true });
  },
}));

import { POST } from "../route";

function makeReq(body: unknown): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/portal/${FIRM_ID}/triage/${LEAD_ID}/refer`,
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

function bandDTriagingLead(overrides: Partial<MockLead> = {}): MockLead {
  return {
    lead_id: LEAD_ID,
    firm_id: FIRM_ID,
    status: "triaging",
    band: "D",
    matter_type: "out_of_scope",
    practice_area: "family",
    submitted_at: "2026-05-15T12:00:00.000Z",
    contact_name: "Mike Example",
    contact_email: null,
    contact_phone: "+14165550000",
    intake_language: "en",
    ...overrides,
  };
}

beforeEach(() => {
  state.session = null;
  state.lead = null;
  state.fetchError = null;
  state.updateError = null;
  state.webhookFired = false;
  state.webhookPayload = null;
});

describe("POST /api/portal/[firmId]/triage/[leadId]/refer", () => {
  it("returns 401 when no session is present", async () => {
    state.session = null;
    state.lead = bandDTriagingLead();
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the lawyer session firm_id mismatches the URL firmId", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("operator session is authorised even with a different firm_id token", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "operator" };
    state.lead = bandDTriagingLead();
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("referred");
  });

  it("returns 404 when the lead is not found", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = null;
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 404 when the lead belongs to a different firm (cross-firm leak)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead({ firm_id: OTHER_FIRM_ID });
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(404);
  });

  it("happy path: triaging → referred + fires the referred webhook", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "lawyer-id-1" };
    state.lead = bandDTriagingLead();
    const res = await POST(
      makeReq({ referredTo: "Jane Doe", note: "Trusted family law colleague." }) as never,
      makeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("referred");
    expect(body.lead_id).toBe(LEAD_ID);
    expect(body.referred_to).toBe("Jane Doe");
    expect(state.webhookFired).toBe(true);
    const payload = state.webhookPayload as Record<string, unknown>;
    expect(payload.__built).toBe("referred");
  });

  it("accepts empty body (lawyer marks as referred without naming recipient)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("referred");
    expect(body.referred_to).toBeNull();
  });

  it("trims and treats whitespace-only referredTo / note as null", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    const res = await POST(
      makeReq({ referredTo: "   ", note: "\t\n" }) as never,
      makeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.referred_to).toBeNull();
  });

  it("idempotency: already-referred returns 200 with already=true (no webhook re-fire)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead({ status: "referred" });
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(body.status).toBe("referred");
    expect(state.webhookFired).toBe(false);
  });

  it("409 when the lead is already taken (cannot refer a taken lead)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead({ status: "taken" });
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(409);
    expect(state.webhookFired).toBe(false);
  });

  it("409 when the lead is already passed", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead({ status: "passed" });
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(409);
  });

  it("works on a Band A/B/C lead too (lawyer can refer any band; engine misclassification edge case)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead({ band: "B", matter_type: "shareholder_dispute" });
    const res = await POST(
      makeReq({ referredTo: "Specialist colleague" }) as never,
      makeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("referred");
  });

  it("returns 500 when supabase fetch fails", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.fetchError = { message: "connection refused" };
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(500);
  });

  it("returns 500 when supabase update fails", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    state.updateError = { message: "write failed" };
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(500);
  });
});
