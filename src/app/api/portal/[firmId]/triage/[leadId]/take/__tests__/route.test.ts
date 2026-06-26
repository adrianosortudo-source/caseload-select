/**
 * Tests for the Take endpoint.
 *
 * Coverage matches the refer-route suite plus the launch-audit fixes:
 *   B1: client-role sessions get 401 (matter-scoped magic links must not
 *       reach the triage surface even with a matching firm_id).
 *   H2: already-referred returns 409; a lost status-guarded UPDATE race
 *       (count 0 / null) fires NO webhook and creates NO matter.
 *
 * We mock supabase-admin, portal-auth, ghl-webhook, and matter-stage so the
 * route handler can be exercised in isolation.
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
  brief_json: { matter_snapshot?: string; fee_estimate?: string } | null;
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
  // What the Band A UUID lookup returns (select("id")).
  uuidRow: { id: string } | null;
  webhookFired: boolean;
  webhookPayload: unknown;
  matterCreated: boolean;
  // Controllable result for createMatterFromBandATake. Defaults to success.
  matterResult: { ok: true; matter: { id: string } } | { ok: false; error: string };
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "L-2026-06-09-TKE";

const state: MockState = {
  session: null,
  lead: null,
  fetchError: null,
  updateError: null,
  updateCount: 1,
  racedRow: null,
  uuidRow: null,
  webhookFired: false,
  webhookPayload: null,
  matterCreated: false,
  matterResult: { ok: true, matter: { id: "matter-uuid-1" } },
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
      // SELECT chain: eq()...eq().maybeSingle(). Dispatches on the column
      // list: "status" is the lost-the-race probe, "id" is the Band A UUID
      // lookup, anything else is the initial lead fetch.
      select: (cols: string) => {
        const trimmed = cols.trim();
        const chain: SelectChain = {
          eq: () => chain,
          maybeSingle: () => {
            if (trimmed === "status") {
              return Promise.resolve({ data: state.racedRow, error: null });
            }
            if (trimmed === "id") {
              return Promise.resolve({ data: state.uuidRow, error: null });
            }
            return Promise.resolve({ data: state.lead, error: state.fetchError });
          },
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
  buildTakenPayload: (args: unknown) => ({ __built: "taken", ...(args as object) }),
  fireGhlWebhook: (_firmId: string, payload: unknown) => {
    state.webhookFired = true;
    state.webhookPayload = payload;
    return Promise.resolve({ fired: true });
  },
}));

vi.mock("@/lib/matter-stage", () => ({
  createMatterFromBandATake: (_args: unknown) => {
    state.matterCreated = true;
    return Promise.resolve(state.matterResult);
  },
}));

import { POST } from "../route";

function makeReq(): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/portal/${FIRM_ID}/triage/${LEAD_ID}/take`,
    { method: "POST" },
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
    band: "B",
    matter_type: "wrongful_dismissal",
    practice_area: "employment",
    submitted_at: "2026-06-09T12:00:00.000Z",
    contact_name: "Sarah Example",
    contact_email: "sarah@example.com",
    contact_phone: "+14165550000",
    brief_json: { matter_snapshot: "snap", fee_estimate: "$5k-$10k" },
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
  state.uuidRow = null;
  state.webhookFired = false;
  state.webhookPayload = null;
  state.matterCreated = false;
  state.matterResult = { ok: true, matter: { id: "matter-uuid-1" } };
});

describe("POST /api/portal/[firmId]/triage/[leadId]/take", () => {
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
    expect(state.matterCreated).toBe(false);
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
    expect(body.status).toBe("taken");
    expect(state.webhookFired).toBe(true);
  });

  it("returns 404 when the lead belongs to a different firm (cross-firm leak)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ firm_id: OTHER_FIRM_ID });
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(404);
  });

  it("happy path: triaging to taken + fires the taken webhook", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "lawyer-id-1" };
    state.lead = triagingLead();
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("taken");
    expect(body.lead_id).toBe(LEAD_ID);
    expect(state.webhookFired).toBe(true);
    const payload = state.webhookPayload as Record<string, unknown>;
    expect(payload.__built).toBe("taken");
    // Band B take creates no matter.
    expect(state.matterCreated).toBe(false);
  });

  it("Band A take creates a client matter", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "lawyer-id-1" };
    state.lead = triagingLead({ band: "A" });
    state.uuidRow = { id: "uuid-row-1" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matter_id).toBe("matter-uuid-1");
    expect(state.matterCreated).toBe(true);
  });

  it("idempotency: already-taken returns 200 with already=true (no webhook re-fire)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ status: "taken" });
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(state.webhookFired).toBe(false);
  });

  it("409 when the lead is already passed", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ status: "passed" });
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
  });

  it("lost race (count 0, row now declined): 409, NO webhook, NO matter (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ band: "A" });
    state.uuidRow = { id: "uuid-row-1" };
    state.updateCount = 0;
    state.racedRow = { status: "declined" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current_status).toBe("declined");
    expect(state.webhookFired).toBe(false);
    expect(state.matterCreated).toBe(false);
  });

  it("lost race (count 0, row now taken): 200 already=true, NO webhook, NO matter (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead({ band: "A" });
    state.uuidRow = { id: "uuid-row-1" };
    state.updateCount = 0;
    state.racedRow = { status: "taken" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(body.status).toBe("taken");
    expect(state.webhookFired).toBe(false);
    expect(state.matterCreated).toBe(false);
  });

  it("lost race (count null with no error): treated as lost, NO webhook (H2)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = triagingLead();
    state.updateCount = null;
    state.racedRow = { status: "passed" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current_status).toBe("passed");
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

  // Matter-creation path tests (P4 hardening)

  it("Band A take with missing contact info: take succeeds, matter skipped, matter_id null", async () => {
    // Route pre-check: contact_name && (email || phone). When both email and phone
    // are null, createMatterFromBandATake is never called; matter_id is null in
    // the response. The take itself still goes through.
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "lawyer-id-1" };
    state.lead = triagingLead({ band: "A", contact_email: null, contact_phone: null });
    state.uuidRow = { id: "uuid-row-1" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("taken");
    expect(body.matter_id).toBeNull();
    expect(state.matterCreated).toBe(false);
    expect(state.webhookFired).toBe(true);
  });

  it("Band A take: matter-creation failure returns 200 with matter_id null (best-effort)", async () => {
    // createMatterFromBandATake returns ok:false (DB insert fail, duplicate, etc.).
    // The route logs the error and continues: take 200, webhook fired, matter_id null.
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "lawyer-id-1" };
    state.lead = triagingLead({ band: "A" });
    state.uuidRow = { id: "uuid-row-1" };
    state.matterResult = { ok: false, error: "insert failed" };
    const res = await POST(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("taken");
    expect(body.matter_id).toBeNull();
    expect(state.matterCreated).toBe(true);
    expect(state.webhookFired).toBe(true);
  });
});
