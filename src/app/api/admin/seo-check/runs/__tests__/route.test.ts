/**
 * Tests for DELETE /api/admin/seo-check/runs (saved SEO audit removal).
 *
 * Focus: the operator gate, id validation, and error passthrough on the
 * hard-delete path added alongside the "delete any saved audit" feature.
 * GET/POST on this route predate this test file and are unchanged.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  operatorSession: { firm_id: string; role: "operator"; lawyer_id: string | null } | null;
  deleteError: { message: string } | null;
}

const state: MockState = {
  operatorSession: null,
  deleteError: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      delete: () => ({
        eq: (_col: string, _val: string) => Promise.resolve({ error: state.deleteError }),
      }),
    }),
  },
}));

vi.mock("../../../tools/seo-check/save-run", () => ({
  buildSeoCheckRunRow: () => null,
}));

import { DELETE } from "../route";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function makeReq(query: string): Request {
  return new Request(`https://app.caseloadselect.ca/api/admin/seo-check/runs${query}`, {
    method: "DELETE",
  });
}

beforeEach(() => {
  state.operatorSession = null;
  state.deleteError = null;
});

describe("DELETE /api/admin/seo-check/runs", () => {
  it("returns 401 when no operator session is present", async () => {
    const res = await DELETE(makeReq(`?id=${RUN_ID}`) as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is missing", async () => {
    state.operatorSession = { firm_id: RUN_ID, role: "operator", lawyer_id: null };
    const res = await DELETE(makeReq("") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when id is not a UUID", async () => {
    state.operatorSession = { firm_id: RUN_ID, role: "operator", lawyer_id: null };
    const res = await DELETE(makeReq("?id=not-a-uuid") as never);
    expect(res.status).toBe(400);
  });

  it("returns 200 on a successful delete", async () => {
    state.operatorSession = { firm_id: RUN_ID, role: "operator", lawyer_id: null };
    const res = await DELETE(makeReq(`?id=${RUN_ID}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 500 when the delete fails", async () => {
    state.operatorSession = { firm_id: RUN_ID, role: "operator", lawyer_id: null };
    state.deleteError = { message: "boom" };
    const res = await DELETE(makeReq(`?id=${RUN_ID}`) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
  });
});
