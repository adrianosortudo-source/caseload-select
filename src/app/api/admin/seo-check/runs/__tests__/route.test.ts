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
  listRows: Array<Record<string, unknown>>;
  listError: { message: string } | null;
  selectedColumns: string | null;
  savedRun: Record<string, unknown> | null;
}

const state: MockState = {
  operatorSession: null,
  deleteError: null,
  listRows: [],
  listError: null,
  selectedColumns: null,
  savedRun: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: (columns: string) => {
        state.selectedColumns = columns;
        const query: Record<string, unknown> = {
          order: () => query,
          limit: () => query,
          eq: () => query,
          single: () => Promise.resolve({ data: state.savedRun, error: null }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: state.listRows, error: state.listError })),
        };
        return query;
      },
      delete: () => ({
        eq: (_col: string, _val: string) => Promise.resolve({ error: state.deleteError }),
      }),
    }),
  },
}));

vi.mock("../../../tools/seo-check/save-run", () => ({
  buildSeoCheckRunRow: () => null,
}));

import { DELETE, GET } from "../route";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function makeReq(query: string, method = "DELETE"): Request {
  return new Request(`https://app.caseloadselect.ca/api/admin/seo-check/runs${query}`, {
    method,
  });
}

beforeEach(() => {
  state.operatorSession = null;
  state.deleteError = null;
  state.listRows = [];
  state.listError = null;
  state.selectedColumns = null;
  state.savedRun = null;
});

describe("GET /api/admin/seo-check/runs history", () => {
  it("selects only the stored methodology version from result JSON and normalizes it", async () => {
    state.operatorSession = { firm_id: RUN_ID, role: "operator", lawyer_id: null };
    state.listRows = [
      { id: RUN_ID, domain: "example.com", methodologyVersion: "5" },
      { id: "22222222-2222-4222-8222-222222222222", domain: "old.example", methodologyVersion: null },
    ];

    const res = await GET(makeReq("?limit=15", "GET") as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.selectedColumns).toContain("methodologyVersion:result->>methodologyVersion");
    expect(state.selectedColumns).not.toContain(", result");
    expect(body.items.map((item: { methodologyVersion: number | null }) => item.methodologyVersion)).toEqual([5, null]);
  });

  it("returns a saved v4 result unchanged for historical replay", async () => {
    state.operatorSession = { firm_id: RUN_ID, role: "operator", lawyer_id: null };
    const savedResult = {
      methodologyVersion: 4,
      overallScore: 74,
      pages: [{ indexability: { metaNoindex: false, headerNoindex: false, indexable: true } }],
    };
    state.savedRun = { id: RUN_ID, domain: "example.com", result: savedResult };

    const res = await GET(makeReq(`?id=${RUN_ID}`, "GET") as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.run.result).toEqual(savedResult);
  });
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
