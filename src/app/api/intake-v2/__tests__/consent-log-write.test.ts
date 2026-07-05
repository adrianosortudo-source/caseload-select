/**
 * Route-level test: /api/intake-v2 writes a consent_log audit row alongside
 * the screened_leads insert (H5/DR-075 WP-2). The consent columns on
 * screened_leads already existed; this proves the append-only audit trail
 * now gets written too, for both the explicit (widget checkbox) and implied
 * (bare inquiry) paths.
 *
 * Mock shape matches route.test.ts's supabase-admin mock exactly so both
 * files can run in the same suite without divergent behavior.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

interface CapturedInsert {
  table: string;
  payload: Record<string, unknown>;
}
const captured: { inserts: CapturedInsert[] } = { inserts: [] };

vi.mock("@/lib/supabase-admin", () => {
  const makeChain = (table: string) => ({
    select: (_cols: string) => makeChain(table),
    eq: (_field: string, _v: unknown) => makeChain(table),
    maybeSingle: () =>
      Promise.resolve(
        table === "intake_firms"
          ? { data: { id: "11111111-1111-1111-1111-111111111111" }, error: null }
          : { data: null, error: null },
      ),
    single: () => Promise.resolve({ data: null, error: null }),
    insert: (payload: Record<string, unknown>) => {
      captured.inserts.push({ table, payload });
      return {
        select: (_cols: string) => ({
          single: () =>
            Promise.resolve({
              data: {
                id: "row-uuid",
                lead_id: payload.lead_id,
                status: payload.status,
                decision_deadline: payload.decision_deadline,
                whale_nurture: payload.whale_nurture,
              },
              error: null,
            }),
        }),
        // consent_log's insert path awaits the insert() call directly
        // (no .select().single() chain), so it must itself be a thenable.
        then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
      };
    },
    not: (_field: string, _op: string, _v: unknown) =>
      Promise.resolve({ data: [{ custom_domain: "client.drglaw.ca" }], error: null }),
  });
  return {
    supabaseAdmin: {
      from: (table: string) => makeChain(table),
    },
  };
});

vi.mock("@/lib/ghl-webhook", () => ({
  buildDeclinedOosPayload: vi.fn(() => ({})),
  fireGhlWebhook: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/lead-notify", () => ({ notifyLawyersOfNewLead: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/decline-resolver", () => ({
  loadDeclineCandidates: vi.fn(() => Promise.resolve([])),
  resolveDecline: vi.fn(() => ({ subject: "x", body: "y", source: "system_fallback" })),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => { void p.catch(() => undefined); },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => Promise.resolve({ ok: true, active: false, remaining: 30, reset: 0, limit: 30 })),
  ipFromRequest: vi.fn(() => "203.0.113.1"),
  rateLimitHeaders: vi.fn(() => ({})),
}));

import { POST } from "../route";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request(`https://app.caseloadselect.ca/api/intake-v2?firmId=${FIRM_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.caseloadselect.ca" },
    body: JSON.stringify(body),
  });
}

function baseValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lead_id: "L-2026-07-05-C1",
    matter_type: "pi_mva",
    practice_area: "pi",
    band: "B",
    axes: { value: 7, complexity: 4, urgency: 6, readiness: 5, readinessAnswered: true },
    brief_json: { lead_id: "L-2026-07-05-C1", summary: "rear-ended on 401" },
    brief_html: "<div class=\"brief\"><h3>Summary</h3><p>matter captured</p></div>",
    slot_answers: { slots: {}, slot_meta: {}, slot_evidence: {} },
    contact: { name: "Test User", email: "test@example.com", phone: "+14165551234" },
    submitted_at: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => { captured.inserts = []; });

describe("/api/intake-v2, consent_log audit write (H5/DR-075 WP-2)", () => {
  it("writes an implied_set consent_log row when the widget checkbox was not checked", async () => {
    const res = await POST(makeRequest(baseValidBody()) as never);
    expect(res.status).toBe(200);

    const leadInsert = captured.inserts.find((c) => c.table === "screened_leads");
    const consentInsert = captured.inserts.find((c) => c.table === "consent_log");
    expect(consentInsert).toBeDefined();
    expect(consentInsert?.payload).toMatchObject({
      firm_id: FIRM_ID,
      subject_id: "row-uuid",
      channel: "email",
      event_type: "implied_set",
      consent_type: "implied_inquiry",
      consent_status: "granted",
      basis_source: "screen_inquiry",
      created_by: "system",
    });
    expect(consentInsert?.payload.expires_at).toBeTruthy();
    // Sanity: the screened_leads row itself still carries the matching columns.
    expect(leadInsert?.payload.email_consent_status).toBe("implied");
  });

  it("writes a consent_granted/express consent_log row when the widget checkbox was checked", async () => {
    const res = await POST(makeRequest(baseValidBody({ email_consent_explicit: true })) as never);
    expect(res.status).toBe(200);

    const consentInsert = captured.inserts.find((c) => c.table === "consent_log");
    expect(consentInsert?.payload).toMatchObject({
      event_type: "consent_granted",
      consent_type: "express",
      basis_source: "widget_optin",
    });
    expect(consentInsert?.payload.expires_at).toBeNull();
  });

  it("never blocks or fails the intake response when the consent_log write path runs", async () => {
    const res = await POST(makeRequest(baseValidBody()) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.persisted).toBe(true);
  });
});
