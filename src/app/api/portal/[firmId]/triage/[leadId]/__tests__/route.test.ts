/**
 * Tests for the single-lead brief API endpoint
 * (GET /api/portal/[firmId]/triage/[leadId]).
 *
 * Focus: auth gate, cross-firm 404 shape, and scoring_port flag behavior.
 *   - lawyer with matching firm_id: 200
 *   - operator (any firm_id): 200
 *   - lawyer with mismatched firm_id: 401
 *   - client session (B1): 401 even when its firm_id matches
 *   - no session: 401
 *   - lead exists but belongs to another firm: 404 (no existence leak)
 *   - scoring_port: null when read_scoring_port is false (default)
 *   - scoring_port: populated when read_scoring_port is true
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
  firmConfig: Record<string, unknown> | null;
  error: { message: string } | null;
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "L-2026-06-09-BRF";

const state: MockState = {
  session: null,
  lead: null,
  firmConfig: { read_scoring_port: false },
  error: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

// Mock scoring-port-read so the route test stays focused on routing logic.
// The scoring-port logic itself is tested in scoring-port-read.test.ts.
vi.mock("@/lib/scoring-port-read", () => ({
  getScoringPortForRead: (row: Record<string, unknown>, config: { read_scoring_port: boolean }) => {
    if (!config.read_scoring_port) return null;
    return {
      score_confidence: row.score_confidence ?? null,
      score_completeness: row.score_completeness ?? null,
      score_explanation: row.score_explanation ?? null,
      score_missing_fields: row.score_missing_fields ?? null,
      field_provenance: row.field_provenance ?? null,
      score_version: row.score_version ?? null,
    };
  },
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    // Route does Promise.all([leadQuery, firmQuery]); distinguish by table name.
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_field: string, _value: unknown) => ({
          maybeSingle: () => {
            if (table === "intake_firms") {
              return Promise.resolve({ data: state.firmConfig, error: null });
            }
            return Promise.resolve({ data: state.lead, error: state.error });
          },
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
  state.firmConfig = { read_scoring_port: false };
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

  // Scoring-port flag gate tests (C3 phase 2)

  it("returns scoring_port: null when read_scoring_port is false (default)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = leadRow();
    state.firmConfig = { read_scoring_port: false };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoring_port).toBeNull();
  });

  it("returns scoring_port fields when read_scoring_port is true and columns are set", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.lead = leadRow({
      score_confidence: "high",
      score_completeness: 0.85,
      score_explanation: "Strong employment matter with clear facts.",
      score_missing_fields: [],
      field_provenance: {},
      score_version: 1,
    });
    state.firmConfig = { read_scoring_port: true };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoring_port).not.toBeNull();
    expect(body.scoring_port.score_confidence).toBe("high");
    expect(body.scoring_port.score_completeness).toBe(0.85);
    expect(body.scoring_port.score_explanation).toBe("Strong employment matter with clear facts.");
    expect(body.scoring_port.score_version).toBe(1);
  });

  it("returns scoring_port with null fields when flag is on but columns are pre-backfill", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    // Pre-backfill row: scoring-delta columns are absent (old intake before C3)
    state.lead = leadRow();
    state.firmConfig = { read_scoring_port: true };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Flag on, but no persisted data: scoring_port object present with null values
    expect(body.scoring_port).not.toBeNull();
    expect(body.scoring_port.score_confidence).toBeNull();
    expect(body.scoring_port.score_completeness).toBeNull();
    expect(body.scoring_port.score_version).toBeNull();
  });
});
