/**
 * Tests for GET /api/admin/content-periods/[periodId]/content-export.
 *
 * Auth surface under test: operator session only (real requireOperator,
 * backed by a mocked getOperatorSession), matching the route's documented
 * single-gate contract (no cron-bearer bypass, unlike publication-manifest
 * in the sibling directory). The I/O layer (buildContentExportBundle,
 * renderContentExportMarkdown) is mocked so these tests never touch
 * Supabase; only the route's own branching (401 vs 200, periodId plumbing,
 * format=markdown, 404 vs 500 on failure) is under test. The bundle-
 * assembly logic itself is covered in content-period-export.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const PERIOD = "p1111111-1111-1111-1111-111111111111";

interface OperatorSession {
  firm_id: string;
  role: "operator";
  lawyer_id?: string;
  exp: number;
}

interface BundleResult {
  ok: true;
  bundle: { schema_version: "1.0"; period: { id: string; title: string } };
}
interface BundleError {
  ok: false;
  error: string;
}

interface State {
  operatorSession: OperatorSession | null;
  bundleResult: BundleResult | BundleError;
  bundleArgs: string | null;
  markdownArg: unknown;
}

const state: State = {
  operatorSession: null,
  bundleResult: { ok: true, bundle: { schema_version: "1.0", period: { id: PERIOD, title: "Test period" } } },
  bundleArgs: null,
  markdownArg: null,
};

// Only the cookie read is mocked; the real requireOperator (which wraps it)
// runs unmocked, same pattern as the publication-manifest route tests.
vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/content-period-export", () => ({
  buildContentExportBundle: (periodId: string) => {
    state.bundleArgs = periodId;
    return Promise.resolve(state.bundleResult);
  },
  renderContentExportMarkdown: (bundle: unknown) => {
    state.markdownArg = bundle;
    return "# markdown output";
  },
}));

import { GET } from "../route";

function makeReq(url: string) {
  return {
    url,
    headers: { get: () => null },
  } as never;
}

function params(periodId: string) {
  return { params: Promise.resolve({ periodId }) } as never;
}

const BASE_URL = `https://app.caseloadselect.ca/api/admin/content-periods/${PERIOD}/content-export`;

beforeEach(() => {
  state.operatorSession = null;
  state.bundleResult = { ok: true, bundle: { schema_version: "1.0", period: { id: PERIOD, title: "Test period" } } };
  state.bundleArgs = null;
  state.markdownArg = null;
});

describe("GET content-export: operator export success", () => {
  it("200 with a valid operator session: calls buildContentExportBundle with the periodId, returns {ok:true, bundle}", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(200);
    expect(state.bundleArgs).toBe(PERIOD);
    const body = await res.json();
    expect(body).toEqual({ ok: true, bundle: (state.bundleResult as BundleResult).bundle });
  });

  it("?format=markdown calls renderContentExportMarkdown with the bundle and returns text/markdown", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`${BASE_URL}?format=markdown`), params(PERIOD));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const text = await res.text();
    expect(text).toBe("# markdown output");
    expect(state.markdownArg).toEqual((state.bundleResult as BundleResult).bundle);
  });

  it("404 when buildContentExportBundle reports period not found", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    state.bundleResult = { ok: false, error: "period not found" };
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(404);
  });
});

describe("GET content-export: non-operator sessions are rejected", () => {
  it("401 with no session at all; buildContentExportBundle is never called", async () => {
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(401);
    expect(state.bundleArgs).toBeNull();
  });

  it("401 for a lawyer or client session: getOperatorSession only resolves for role==='operator', so any firm-scoped lawyer session (or a client session) is rejected the same as no session", async () => {
    // getOperatorSession's mock in this file only ever returns an operator
    // session or null; a lawyer/client session is exactly the null case from
    // this route's point of view, since the real getOperatorSession (see
    // portal-auth.ts) returns null unless session.role === "operator".
    state.operatorSession = null;
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(401);
    expect(state.bundleArgs).toBeNull();
  });
});
