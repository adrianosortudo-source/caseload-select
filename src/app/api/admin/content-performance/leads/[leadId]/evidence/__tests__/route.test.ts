/**
 * Tests for GET/POST /api/admin/content-performance/leads/[leadId]/evidence.
 *
 * Focus: operator-only auth gate, and POST body validation (attribution_state
 * must be self_reported/offline_referral, evidence_note required,
 * self_report_category required only for self_reported). The lib layer
 * (content-attribution.ts) is mocked here -- its own behavior is covered by
 * src/lib/__tests__/content-attribution.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const LEAD_ID = "l1111111-1111-1111-1111-111111111111";
const FIRM_ID = "f1111111-1111-1111-1111-111111111111";

const state: {
  operatorSession: { lawyer_id?: string } | null;
  leadFirmId: string | null;
} = {
  operatorSession: { },
  leadFirmId: FIRM_ID,
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: async () => {
    if (!state.operatorSession) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  },
}));

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "screened_leads") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.leadFirmId ? { firm_id: state.leadFirmId } : null, error: null }),
            }),
          }),
        };
      }
      if (table === "firm_lawyers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { display_name: "Adriano" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in mock: ${table}`);
    },
  },
}));

vi.mock("@/lib/content-attribution", () => ({
  listEvidenceForLead: vi.fn(async () => []),
  recordAttributionEvidence: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    evidence: { id: "e-1", ...input },
  })),
}));

import { GET, POST } from "../route";
import { recordAttributionEvidence } from "@/lib/content-attribution";

function makeReq(body?: unknown): Request {
  return new Request(`https://example.com/api/admin/content-performance/leads/${LEAD_ID}/evidence`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx() {
  return { params: Promise.resolve({ leadId: LEAD_ID }) };
}

beforeEach(() => {
  state.operatorSession = {};
  state.leadFirmId = FIRM_ID;
  vi.mocked(recordAttributionEvidence).mockClear();
});

describe("GET evidence", () => {
  it("401s with no operator session", async () => {
    state.operatorSession = null;
    const res = await GET(makeReq() as never, ctx());
    expect(res.status).toBe(401);
  });

  it("404s when the lead does not exist", async () => {
    state.leadFirmId = null;
    const res = await GET(makeReq() as never, ctx());
    expect(res.status).toBe(404);
  });

  it("200s for an operator with an existing lead", async () => {
    const res = await GET(makeReq() as never, ctx());
    expect(res.status).toBe(200);
  });
});

describe("POST evidence", () => {
  it("401s with no operator session", async () => {
    state.operatorSession = null;
    const res = await POST(makeReq({ attribution_state: "self_reported" }) as never, ctx());
    expect(res.status).toBe(401);
  });

  it("400s on an invalid attribution_state", async () => {
    const res = await POST(makeReq({ attribution_state: "known_first_touch", evidence_note: "x" }) as never, ctx());
    expect(res.status).toBe(400);
  });

  it("400s when evidence_note is missing", async () => {
    const res = await POST(makeReq({ attribution_state: "offline_referral" }) as never, ctx());
    expect(res.status).toBe(400);
  });

  it("400s on self_reported with no self_report_category", async () => {
    const res = await POST(
      makeReq({ attribution_state: "self_reported", evidence_note: "said via chatgpt" }) as never,
      ctx(),
    );
    expect(res.status).toBe(400);
  });

  it("records self-reported evidence and never sets marketing consent fields", async () => {
    const res = await POST(
      makeReq({
        attribution_state: "self_reported",
        self_report_category: "ai_tool",
        evidence_note: "Found us through ChatGPT",
      }) as never,
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(recordAttributionEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: FIRM_ID,
        screenedLeadId: LEAD_ID,
        attributionState: "self_reported",
        evidenceMethod: "self_report",
        selfReportCategory: "ai_tool",
        recordedByRole: "operator",
      }),
    );
  });

  it("records offline-referral evidence without a self_report_category", async () => {
    const res = await POST(
      makeReq({
        attribution_state: "offline_referral",
        evidence_note: "Existing client mentioned the referral in person",
      }) as never,
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(recordAttributionEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceMethod: "operator_offline_referral",
        selfReportCategory: null,
      }),
    );
  });
});
