/**
 * Tests for GET /api/portal/[firmId]/content-performance.
 *
 * Focus: the auth gate (same posture as the Tier 1 Partner Dashboard) --
 * client sessions excluded even with a matching firm_id, lawyer sessions
 * must match firm_id, operator sessions with a matching token pass. Also
 * asserts the response never leaks raw lead/contact fields -- only
 * aggregate counts and pre-built client-safe sentences.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM_ID = "f1111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "f2222222-2222-2222-2222-222222222222";

const state: {
  session: { firm_id: string; role: "lawyer" | "operator" | "client" } | null;
  current: Array<Record<string, unknown>>;
} = {
  session: { firm_id: FIRM_ID, role: "lawyer" },
  current: [],
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

vi.mock("@/lib/content-attribution", () => ({
  listCurrentAttributionForFirm: vi.fn(async () => state.current),
}));

import { GET } from "../route";

function makeReq(): Request {
  return new Request(`https://example.com/api/portal/${FIRM_ID}/content-performance`);
}

function ctx() {
  return { params: Promise.resolve({ firmId: FIRM_ID }) };
}

beforeEach(() => {
  state.session = { firm_id: FIRM_ID, role: "lawyer" };
  state.current = [];
});

describe("auth gate", () => {
  it("401s with no session", async () => {
    state.session = null;
    const res = await GET(makeReq(), ctx());
    expect(res.status).toBe(401);
  });

  it("401s for a client session even with a matching firm_id", async () => {
    state.session = { firm_id: FIRM_ID, role: "client" };
    const res = await GET(makeReq(), ctx());
    expect(res.status).toBe(401);
  });

  it("401s for a lawyer session scoped to a different firm", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "lawyer" };
    const res = await GET(makeReq(), ctx());
    expect(res.status).toBe(401);
  });

  it("200s for a lawyer session matching this firm", async () => {
    const res = await GET(makeReq(), ctx());
    expect(res.status).toBe(200);
  });

  it("200s for an operator session scoped to this firm", async () => {
    state.session = { firm_id: FIRM_ID, role: "operator" };
    const res = await GET(makeReq(), ctx());
    expect(res.status).toBe(200);
  });
});

describe("client-safe shape", () => {
  it("never exposes raw evidence_note, recorded_by fields, or lead contact fields", async () => {
    state.current = [
      {
        firm_id: FIRM_ID,
        screened_lead_id: "l-1",
        deliverable_id: "d-1",
        attribution_state: "self_reported",
        evidence_method: "self_report",
      },
    ];
    const res = await GET(makeReq(), ctx());
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("evidence_note");
    expect(body).not.toContain("recorded_by");
    expect(body).not.toContain("contact_name");
    expect(body).not.toContain("contact_email");
  });
});
