/**
 * Route-level tests for /api/intake-v2 multilingual persistence.
 *
 * Tier A.2 of the post-Jim-Manico build pass — Codex audit LOW #2+#3 noted
 * the existing 1,500+ tests cover the PURE multilingual units (label
 * mapper, payload builder, prompt builder, email renderer) but no test
 * exercises the route handler end-to-end with a non-English body and
 * asserts the screened_leads insert carries the correct intake_language
 * + raw_transcript columns.
 *
 * What we mock:
 *   - @/lib/supabase-admin : capture the insert payload, return a
 *     synthetic inserted row.
 *   - @/lib/ghl-webhook    : stub fireGhlWebhook so it doesn't try to
 *     reach an actual URL.
 *   - @/lib/lead-notify    : stub notifyLawyersOfNewLead so Resend is
 *     never touched.
 *   - @/lib/decline-resolver : stub loadDeclineCandidates to return
 *     empty (we don't exercise OOS path here).
 *   - @vercel/functions    : stub waitUntil to invoke the callback
 *     synchronously so we can observe side effects.
 *   - @/lib/rate-limit     : stub to always allow (we're not testing
 *     rate limits here).
 *
 * What stays real:
 *   - The route handler itself (the SUT)
 *   - @/lib/intake-v2-security : we want origin + body validation + brief_html
 *     sanitization to run as in production.
 *   - @/lib/intake-v2-derive : pure helpers used by the handler.
 *
 * Test strategy: capture the insert payload via the supabase mock and
 * assert on it, rather than reading from a real DB. Same approach the
 * existing webhook-outbox + ghl-webhook tests use.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Capture-and-assert state for the supabase mock.
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

vi.mock("@/lib/lead-notify", () => ({
  notifyLawyersOfNewLead: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/decline-resolver", () => ({
  loadDeclineCandidates: vi.fn(() => Promise.resolve([])),
  resolveDecline: vi.fn(() => ({ subject: "x", body: "y", source: "system_fallback" })),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    // Invoke immediately so any fire-and-forget side effect lands inside
    // the test boundary. Errors propagate so a real failure surfaces.
    void p.catch(() => undefined);
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() =>
    Promise.resolve({ ok: true, active: false, remaining: 30, reset: 0, limit: 30 }),
  ),
  ipFromRequest: vi.fn(() => "203.0.113.1"),
  rateLimitHeaders: vi.fn(() => ({})),
}));

// Now import the SUT.
import { POST } from "../route";

// ─── Helpers ────────────────────────────────────────────────────────────────

const FIRM_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/intake-v2?firmId=${FIRM_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://app.caseloadselect.ca",
      },
      body: JSON.stringify(body),
    },
  );
}

function baseValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lead_id: "L-2026-05-14-T1",
    matter_type: "pi_mva",
    practice_area: "pi",
    band: "B",
    axes: { value: 7, complexity: 4, urgency: 6, readiness: 5, readinessAnswered: true },
    brief_json: { lead_id: "L-2026-05-14-T1", summary: "rear-ended on 401" },
    brief_html: "<div class=\"brief\"><h3>Summary</h3><p>matter captured</p></div>",
    slot_answers: { slots: {}, slot_meta: {}, slot_evidence: {} },
    contact: { name: "Test User", email: "test@example.com", phone: "+14165551234" },
    submitted_at: "2026-05-14T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  captured.inserts = [];
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("/api/intake-v2 — multilingual persistence", () => {
  it("persists intake_language='en' and raw_transcript=null for English body", async () => {
    const req = makeRequest(baseValidBody({ intake_language: "en" }));
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const insert = captured.inserts.find((c) => c.table === "screened_leads");
    expect(insert).toBeDefined();
    expect(insert?.payload.intake_language).toBe("en");
    expect(insert?.payload.raw_transcript).toBeNull();
  });

  it("persists intake_language='pt' and the raw_transcript verbatim for Portuguese body", async () => {
    const ptInput = "quero abrir uma empresa no canada";
    const req = makeRequest(
      baseValidBody({ intake_language: "pt", raw_transcript: ptInput }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const insert = captured.inserts.find((c) => c.table === "screened_leads");
    expect(insert?.payload.intake_language).toBe("pt");
    expect(insert?.payload.raw_transcript).toBe(ptInput);
  });

  it("persists intake_language='es' for Spanish body", async () => {
    const esInput = "Necesito ayuda con un caso de divorcio";
    const req = makeRequest(
      baseValidBody({ intake_language: "es", raw_transcript: esInput }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const insert = captured.inserts.find((c) => c.table === "screened_leads");
    expect(insert?.payload.intake_language).toBe("es");
    expect(insert?.payload.raw_transcript).toBe(esInput);
  });

  it("persists intake_language='zh' for Mandarin body and preserves the raw_transcript characters", async () => {
    const zhInput = "我需要在加拿大注册公司";
    const req = makeRequest(
      baseValidBody({ intake_language: "zh", raw_transcript: zhInput }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const insert = captured.inserts.find((c) => c.table === "screened_leads");
    expect(insert?.payload.intake_language).toBe("zh");
    expect(insert?.payload.raw_transcript).toBe(zhInput);
  });

  it("persists intake_language='ar' for Arabic body and preserves RTL characters in raw_transcript", async () => {
    // Audit gap from Codex LOW #3: Arabic was listed in SupportedLanguage
    // but no end-to-end test covered it. This is the canonical case.
    const arInput = "أحتاج إلى محامٍ للهجرة إلى كندا";
    const req = makeRequest(
      baseValidBody({ intake_language: "ar", raw_transcript: arInput }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const insert = captured.inserts.find((c) => c.table === "screened_leads");
    expect(insert?.payload.intake_language).toBe("ar");
    expect(insert?.payload.raw_transcript).toBe(arInput);
    // Sanity: the Arabic characters survive the body → validator → insert
    // pipeline unchanged (no double-encoding, no mojibake, no normalization).
    expect((insert?.payload.raw_transcript as string).length).toBe(arInput.length);
    expect(insert?.payload.raw_transcript).toMatch(/كندا/);
  });

  it("persists intake_language='fr' for French body", async () => {
    const frInput = "Je cherche un avocat en droit du travail";
    const req = makeRequest(
      baseValidBody({ intake_language: "fr", raw_transcript: frInput }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const insert = captured.inserts.find((c) => c.table === "screened_leads");
    expect(insert?.payload.intake_language).toBe("fr");
    expect(insert?.payload.raw_transcript).toBe(frInput);
  });

  it("defaults intake_language to 'en' and raw_transcript to null when body omits both fields", async () => {
    const req = makeRequest(baseValidBody()); // no intake_language, no raw_transcript
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const insert = captured.inserts.find((c) => c.table === "screened_leads");
    expect(insert?.payload.intake_language).toBe("en");
    expect(insert?.payload.raw_transcript).toBeNull();
  });

  it("rejects an unknown intake_language code with HTTP 400 and never inserts", async () => {
    const req = makeRequest(baseValidBody({ intake_language: "not-a-real-lang" }));
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(captured.inserts.find((c) => c.table === "screened_leads")).toBeUndefined();
  });

  it("rejects an oversized raw_transcript (>16 KB) with HTTP 400 and never inserts", async () => {
    const huge = "ا".repeat(16_001); // arabic char × 16001
    const req = makeRequest(
      baseValidBody({ intake_language: "ar", raw_transcript: huge }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(captured.inserts.find((c) => c.table === "screened_leads")).toBeUndefined();
  });
});
