/**
 * Web-session expiry sweep (qualification audit F2/F6/item 5, 2026-07-02).
 * Mirrors the contact-aware split coverage of expire-channel-intake-sessions:
 *   - contact-complete expired session finalizes into screened_leads,
 *     fires the new-lead notification, marks the session finalized with
 *     screened_lead_id
 *   - contact-incomplete session moves to unconfirmed_inquiries with
 *     reason='abandoned'
 *   - duplicate lead_id (race with a real /api/intake-v2 submit) finalizes
 *     the session without erroring
 *   - auth
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  expiredRows: [] as Record<string, unknown>[],
  selectError: null as { message: string } | null,
  firmRow: { location: null } as Record<string, unknown> | null,
  screenedInserts: [] as Record<string, unknown>[],
  insertError: null as { code?: string; message: string } | null,
  sessionUpdates: [] as Record<string, unknown>[],
  notifyLawyersOfNewLead: vi.fn(),
  persistUnconfirmedInquiry: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => {
  function from(table: string) {
    if (table === "web_intake_sessions") {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.lt = () => chain;
      chain.order = () => chain;
      chain.limit = () =>
        mocks.selectError
          ? Promise.resolve({ data: null, error: mocks.selectError })
          : Promise.resolve({ data: mocks.expiredRows, error: null });
      chain.update = (payload: Record<string, unknown>) => {
        mocks.sessionUpdates.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      };
      return chain;
    }
    if (table === "intake_firms") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mocks.firmRow, error: null }),
          }),
        }),
      };
    }
    if (table === "screened_leads") {
      return {
        insert: (payload: Record<string, unknown>) => {
          mocks.screenedInserts.push(payload);
          return {
            select: () => ({
              single: () =>
                mocks.insertError
                  ? Promise.resolve({ data: null, error: mocks.insertError })
                  : Promise.resolve({
                      data: {
                        id: "screened-row-uuid",
                        lead_id: payload.lead_id,
                        status: payload.status,
                        decision_deadline: payload.decision_deadline,
                        whale_nurture: payload.whale_nurture,
                      },
                      error: null,
                    }),
            }),
          };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  }
  return { supabaseAdmin: { from } };
});

vi.mock("@/lib/screen-brief-html", () => ({
  renderBriefHtmlServer: vi.fn(() => '<div class="brief">brief</div>'),
}));

vi.mock("@/lib/lead-notify", () => ({
  notifyLawyersOfNewLead: mocks.notifyLawyersOfNewLead,
}));

vi.mock("@/lib/unconfirmed-inquiry", () => ({
  persistUnconfirmedInquiry: mocks.persistUnconfirmedInquiry,
}));

import { GET } from "../route";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const CRON_TOKEN = "test-cron-secret";

function makeRequest(authorized = true): NextRequest {
  return new Request("https://app.caseloadselect.ca/api/cron/expire-web-intake-sessions", {
    method: "GET",
    headers: authorized ? { authorization: `Bearer ${CRON_TOKEN}` } : {},
  }) as unknown as NextRequest;
}

function engineState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input: "I have a contract dispute about unpaid invoices around $75k.",
    practice_area: "corporate",
    matter_type: "contract_dispute",
    intent_family: "business_dispute",
    dispute_family: "agreement_performance",
    advisory_subtrack: "unknown",
    slots: {
      client_name: "Sarah Example",
      client_phone: "+16475492106",
    },
    slot_meta: {
      client_name: { source: "answered", confidence: 1.0 },
      client_phone: { source: "answered", confidence: 1.0 },
    },
    slot_evidence: {},
    raw: {
      mentions_urgency: false,
      mentions_money: true,
      mentions_access: false,
      mentions_ownership: false,
      mentions_documents: false,
      mentions_payment: true,
      mentions_agreement: true,
      mentions_vendor: false,
      mentions_fraud: false,
      mentions_property: false,
      mentions_closing: false,
      mentions_lease: false,
      mentions_construction: false,
      mentions_mortgage: false,
      mentions_preconstruction: false,
      input_length: 20,
    },
    confidence: 0,
    coreCompleteness: 0,
    answeredQuestionGroups: [],
    questionHistory: [],
    insightShown: false,
    contactCaptureStarted: true,
    lead_id: "L-2026-07-02-WEB",
    submitted_at: "2026-07-01T10:00:00.000Z",
    language: "en",
    ...overrides,
  };
}

function expiredWebSessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "web-session-1",
    firm_id: FIRM_ID,
    lead_id: "L-2026-07-02-WEB",
    engine_state: engineState(),
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    referrer: "https://drglaw.ca/contact",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_TOKEN;
  mocks.expiredRows = [];
  mocks.selectError = null;
  mocks.firmRow = { location: null };
  mocks.screenedInserts = [];
  mocks.insertError = null;
  mocks.sessionUpdates = [];
  mocks.notifyLawyersOfNewLead.mockReset();
  mocks.notifyLawyersOfNewLead.mockResolvedValue({ attempted: 1, sent: 1, skipped: 0, errors: [] });
  mocks.persistUnconfirmedInquiry.mockReset();
  mocks.persistUnconfirmedInquiry.mockResolvedValue({ ok: true, id: "inquiry-1" });
});

describe("GET /api/cron/expire-web-intake-sessions", () => {
  it("returns 401 when unauthorized", async () => {
    const res = await GET(makeRequest(false));
    expect(res.status).toBe(401);
  });

  it("returns empty sweep when nothing has expired", async () => {
    mocks.expiredRows = [];
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.swept).toBe(0);
  });

  it("finalizes a contact-complete session into screened_leads and notifies", async () => {
    mocks.expiredRows = [expiredWebSessionRow()];
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.finalized).toBe(1);
    expect(body.abandoned).toBe(0);
    expect(mocks.screenedInserts).toHaveLength(1);
    expect(mocks.screenedInserts[0]).toMatchObject({
      lead_id: "L-2026-07-02-WEB",
      firm_id: FIRM_ID,
      utm_source: "google",
      contact_name: "Sarah Example",
      contact_phone: "+16475492106",
    });
    expect(mocks.notifyLawyersOfNewLead).toHaveBeenCalledTimes(1);
    const finalizeUpdate = mocks.sessionUpdates.find((u) => u.screened_lead_id);
    expect(finalizeUpdate).toMatchObject({ finalized: true, screened_lead_id: "screened-row-uuid" });
    expect(mocks.persistUnconfirmedInquiry).not.toHaveBeenCalled();
  });

  it("moves a contact-incomplete session to unconfirmed_inquiries", async () => {
    mocks.expiredRows = [
      expiredWebSessionRow({
        engine_state: engineState({
          slots: { client_name: "Sarah Example" }, // no phone/email: fails the gate
          slot_meta: { client_name: { source: "answered", confidence: 1.0 } },
        }),
      }),
    ];
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.finalized).toBe(0);
    expect(body.abandoned).toBe(1);
    expect(mocks.screenedInserts).toHaveLength(0);
    expect(mocks.persistUnconfirmedInquiry).toHaveBeenCalledTimes(1);
    expect(mocks.persistUnconfirmedInquiry.mock.calls[0][0]).toMatchObject({
      firmId: FIRM_ID,
      channel: "web",
      reason: "abandoned",
    });
    const finalizeUpdate = mocks.sessionUpdates.find((u) => u.finalized);
    expect(finalizeUpdate).toMatchObject({ finalized: true });
  });

  it("finalizes without erroring on a duplicate lead_id (race with a real submit)", async () => {
    mocks.expiredRows = [expiredWebSessionRow()];
    mocks.insertError = { code: "23505", message: "duplicate key" };
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.finalized).toBe(1);
    expect(body.outcomes[0].reason).toBe("duplicate lead_id");
    expect(mocks.notifyLawyersOfNewLead).not.toHaveBeenCalled();
  });

  it("leaves the session open on a transient (non-duplicate) insert error", async () => {
    mocks.expiredRows = [expiredWebSessionRow()];
    mocks.insertError = { message: "connection reset" };
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.finalized).toBe(0);
    expect(body.outcomes[0].moved).toBe(false);
    // No finalize update for this row: leave it open so the next sweep retries.
    expect(mocks.sessionUpdates.some((u) => u.finalized)).toBe(false);
  });

  it("treats an unrestorable engine_state as abandoned rather than throwing", async () => {
    mocks.expiredRows = [expiredWebSessionRow({ engine_state: null })];
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.abandoned).toBe(1);
  });
});
