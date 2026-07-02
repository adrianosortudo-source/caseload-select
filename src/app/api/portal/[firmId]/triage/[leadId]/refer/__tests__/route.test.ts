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
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "L-2026-05-15-RFR";

const state: MockState = {
  session: null,
  lead: null,
  fetchError: null,
  updateError: null,
  updateCount: 1,
  racedRow: null,
  webhookFired: false,
  webhookPayload: null,
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
      // SELECT chain → eq()...eq().maybeSingle(). Dispatches on the column
      // list: the bare "status" re-read is the lost-the-race probe; anything
      // else is the initial lead fetch.
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
      // UPDATE chain → eq().eq().eq(), resolving with the affected-row count.
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
  state.updateCount = 1;
  state.racedRow = null;
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

  it("returns 401 for a client session even when its firm_id matches (B1)", async () => {
    state.session = { firm_id: FIRM_ID, role: "client", matter_id: "matter-1" };
    state.lead = bandDTriagingLead();
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(401);
    expect(state.webhookFired).toBe(false);
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

  it("lost race (count 0, row now declined): 409 with current_status, NO webhook (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    state.updateCount = 0;
    state.racedRow = { status: "declined" };
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current_status).toBe("declined");
    expect(state.webhookFired).toBe(false);
  });

  it("lost race (count 0, row now referred): 200 already=true, NO webhook (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    state.updateCount = 0;
    state.racedRow = { status: "referred" };
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(body.status).toBe("referred");
    expect(state.webhookFired).toBe(false);
  });

  it("lost race (count null with no error): treated as lost, NO webhook (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    state.updateCount = null;
    state.racedRow = { status: "taken" };
    const res = await POST(makeReq({}) as never, makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current_status).toBe("taken");
    expect(state.webhookFired).toBe(false);
  });

  // Decision reason-code taxonomy (qualification audit item 6, 2026-07-02).
  it("accepts a valid reason_code and still refers the lead", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    const res = await POST(makeReq({ reason_code: "conflict" }) as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("referred");
  });

  it("rejects an invalid reason_code with 400 before any state change", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = bandDTriagingLead();
    const res = await POST(makeReq({ reason_code: "nonsense" }) as never, makeParams());
    expect(res.status).toBe(400);
    expect(state.webhookFired).toBe(false);
  });
});
