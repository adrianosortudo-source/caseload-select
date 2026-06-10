/**
 * Tests for the new-lead notification retry endpoint
 * (POST /api/admin/screened-leads/[id]/retry-notification).
 *
 * DR-046 invariant 3 (launch audit fix H4, 2026-06-09): the operator can
 * replay a failed or pending new-lead notification on demand. Coverage:
 *
 *   - 401 without an operator session (real @/lib/admin-auth is exercised;
 *     only its getOperatorSession dependency is mocked)
 *   - 404 for an unknown lead id
 *   - success path re-sends through notifyLawyersOfNewLead with
 *     replay: true and the args rebuilt from the stored row
 *   - transport failure still returns 200 with ok: false + the error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface LeadRow {
  lead_id: string;
  firm_id: string;
  status: string;
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  practice_area: string;
  contact_name: string | null;
  decision_deadline: string;
  whale_nurture: boolean;
  intake_language: string | null;
  slot_answers: { channel?: string } | null;
}

interface NotifyResult {
  attempted: number;
  sent: number;
  skipped: number;
  errors: string[];
}

interface MockState {
  operatorSession: { firm_id: string; role: "operator"; exp: number } | null;
  lead: LeadRow | null;
  lookupError: { message: string } | null;
  refreshed: {
    notification_sent_at: string | null;
    notification_error: string | null;
    notification_attempts: number;
    notification_last_attempt_at: string | null;
  } | null;
  notifyResult: NotifyResult;
  notifyCalls: unknown[];
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "L-2026-06-09-RTY";

const state: MockState = {
  operatorSession: null,
  lead: null,
  lookupError: null,
  refreshed: null,
  notifyResult: { attempted: 1, sent: 1, skipped: 0, errors: [] },
  notifyCalls: [],
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      // Dispatch on the column list: the refreshed-state read selects the
      // notification_* columns; anything else is the initial lead lookup.
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: () => {
            if (cols.includes("notification_attempts")) {
              return Promise.resolve({ data: state.refreshed, error: null });
            }
            const result = Promise.resolve({ data: state.lead, error: state.lookupError });
            // The lead lookup chains .returns<LeadRow>() after maybeSingle;
            // the refreshed read awaits maybeSingle directly. Support both.
            return Object.assign(result, { returns: () => result });
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/lead-notify", () => ({
  notifyLawyersOfNewLead: (args: unknown) => {
    state.notifyCalls.push(args);
    return Promise.resolve(state.notifyResult);
  },
}));

import { POST } from "../route";

function makeReq(): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/admin/screened-leads/${LEAD_ID}/retry-notification`,
    { method: "POST" },
  );
}

function makeParams(id: string = LEAD_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function leadFixture(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    lead_id: LEAD_ID,
    firm_id: FIRM_ID,
    status: "triaging",
    band: "B",
    matter_type: "wrongful_dismissal",
    practice_area: "employment",
    contact_name: "Sarah Example",
    decision_deadline: "2026-06-11T12:00:00.000Z",
    whale_nurture: false,
    intake_language: "pt",
    slot_answers: { channel: "whatsapp" },
    ...overrides,
  };
}

beforeEach(() => {
  state.operatorSession = null;
  state.lead = null;
  state.lookupError = null;
  state.refreshed = {
    notification_sent_at: "2026-06-09T13:00:00.000Z",
    notification_error: null,
    notification_attempts: 2,
    notification_last_attempt_at: "2026-06-09T13:00:00.000Z",
  };
  state.notifyResult = { attempted: 1, sent: 1, skipped: 0, errors: [] };
  state.notifyCalls = [];
});

function asOperator(): void {
  state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
}

describe("POST /api/admin/screened-leads/[id]/retry-notification", () => {
  it("returns 401 without an operator session and does not re-send", async () => {
    state.lead = leadFixture();
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(401);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("returns 404 for an unknown lead id", async () => {
    asOperator();
    state.lead = null;
    const res = await POST(makeReq(), makeParams("L-DOES-NOT-EXIST"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("returns 500 when the lookup itself fails", async () => {
    asOperator();
    state.lookupError = { message: "connection refused" };
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(500);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("success: re-sends with replay: true and args rebuilt from the row", async () => {
    asOperator();
    state.lead = leadFixture();
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.notification_attempts).toBe(2);
    expect(body.notification_sent_at).toBe("2026-06-09T13:00:00.000Z");

    expect(state.notifyCalls).toHaveLength(1);
    const args = state.notifyCalls[0] as Record<string, unknown>;
    expect(args.replay).toBe(true);
    expect(args.firmId).toBe(FIRM_ID);
    expect(args.leadId).toBe(LEAD_ID);
    expect(args.contactName).toBe("Sarah Example");
    expect(args.matterType).toBe("wrongful_dismissal");
    expect(args.practiceArea).toBe("employment");
    expect(args.band).toBe("B");
    expect(args.decisionDeadlineIso).toBe("2026-06-11T12:00:00.000Z");
    expect(args.whaleNurture).toBe(false);
    expect(args.intakeLanguage).toBe("pt");
    expect(args.channel).toBe("whatsapp");
    expect(args.lifecycleStatus).toBe("triaging");
  });

  it("declined rows replay with the declined treatment", async () => {
    asOperator();
    state.lead = leadFixture({ status: "declined" });
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(200);
    const args = state.notifyCalls[0] as Record<string, unknown>;
    expect(args.lifecycleStatus).toBe("declined");
  });

  it("transport failure: 200 with ok false and the error surfaced", async () => {
    asOperator();
    state.lead = leadFixture();
    state.notifyResult = {
      attempted: 1,
      sent: 0,
      skipped: 0,
      errors: ["lawyer@example.com: smtp boom"],
    };
    state.refreshed = {
      notification_sent_at: null,
      notification_error: "lawyer@example.com: smtp boom",
      notification_attempts: 3,
      notification_last_attempt_at: "2026-06-09T13:05:00.000Z",
    };
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("smtp boom");
    expect(body.notification_error).toContain("smtp boom");
    expect(body.notification_attempts).toBe(3);
  });
});
