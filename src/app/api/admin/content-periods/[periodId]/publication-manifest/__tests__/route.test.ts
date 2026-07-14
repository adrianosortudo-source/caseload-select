/**
 * Tests for GET /api/admin/content-periods/[periodId]/publication-manifest.
 *
 * Auth surface under test: operator session (real requireOperator, backed by
 * a mocked getOperatorSession) OR a Bearer CRON_SECRET/PG_CRON_TOKEN (mocked
 * isCronAuthorized), matching the route's documented dual-gate contract. The
 * I/O layer (buildPublicationManifest, renderManifestMarkdown) is mocked so
 * these tests never touch Supabase; only the route's own branching (401 vs
 * 200, periodId plumbing, format=markdown, 404 vs 500 on failure) is under
 * test.
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

interface ManifestResult {
  ok: true;
  manifest: { schema_version: "1.0"; period_id: string; theme: string };
}
interface ManifestError {
  ok: false;
  error: string;
}

interface State {
  operatorSession: OperatorSession | null;
  cronAuthed: boolean;
  manifestResult: ManifestResult | ManifestError;
  manifestArgs: { periodId: string; operatorId: string | null } | null;
  markdownArg: unknown;
}

const state: State = {
  operatorSession: null,
  cronAuthed: false,
  manifestResult: { ok: true, manifest: { schema_version: "1.0", period_id: PERIOD, theme: "Test theme" } },
  manifestArgs: null,
  markdownArg: null,
};

// Only the cookie read is mocked; the real requireOperator (which wraps it)
// runs unmocked, same pattern as firm-metrics route tests.
vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/cron-auth", () => ({
  isCronAuthorized: () => state.cronAuthed,
}));

vi.mock("@/lib/publication-manifest", () => ({
  buildPublicationManifest: (periodId: string, operatorId: string | null) => {
    state.manifestArgs = { periodId, operatorId };
    return Promise.resolve(state.manifestResult);
  },
  renderManifestMarkdown: (manifest: unknown) => {
    state.markdownArg = manifest;
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

const BASE_URL = `https://app.caseloadselect.ca/api/admin/content-periods/${PERIOD}/publication-manifest`;

beforeEach(() => {
  state.operatorSession = null;
  state.cronAuthed = false;
  state.manifestResult = { ok: true, manifest: { schema_version: "1.0", period_id: PERIOD, theme: "Test theme" } };
  state.manifestArgs = null;
  state.markdownArg = null;
});

describe("GET publication-manifest: auth gate", () => {
  it("401 when there is no operator session and no cron token; buildPublicationManifest is never called", async () => {
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(401);
    expect(state.manifestArgs).toBeNull();
  });

  it("200 with a valid operator session: calls buildPublicationManifest with the periodId and operator id, returns {ok:true, manifest}", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(200);
    expect(state.manifestArgs).toEqual({ periodId: PERIOD, operatorId: "op-1" });
    const body = await res.json();
    expect(body).toEqual({ ok: true, manifest: (state.manifestResult as ManifestResult).manifest });
  });

  it("200 with a CRON_SECRET bearer and no operator session: succeeds without requiring getOperatorSession to resolve a session", async () => {
    state.cronAuthed = true;
    state.operatorSession = null;
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(200);
    // cron path passes null as generatedByOperatorId (route skips getOperatorSession() entirely)
    expect(state.manifestArgs).toEqual({ periodId: PERIOD, operatorId: null });
  });
});

describe("GET publication-manifest: buildPublicationManifest failure mapping", () => {
  beforeEach(() => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
  });

  it("404 when buildPublicationManifest reports period not found", async () => {
    state.manifestResult = { ok: false, error: "period not found" };
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "period not found" });
  });

  it("500 when buildPublicationManifest reports any other error", async () => {
    state.manifestResult = { ok: false, error: "connection reset" };
    const res = await GET(makeReq(BASE_URL), params(PERIOD));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "connection reset" });
  });
});

describe("GET publication-manifest: ?format=markdown", () => {
  it("calls renderManifestMarkdown with the manifest and returns text/markdown", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`${BASE_URL}?format=markdown`), params(PERIOD));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const text = await res.text();
    expect(text).toBe("# markdown output");
    expect(state.markdownArg).toEqual((state.manifestResult as ManifestResult).manifest);
  });

  it("any other format value falls back to json", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`${BASE_URL}?format=csv`), params(PERIOD));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("GET publication-manifest: determinism", () => {
  it("returns an identical body across repeated calls given identical mocked inputs (the route adds nothing nondeterministic of its own)", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    const res1 = await GET(makeReq(BASE_URL), params(PERIOD));
    const body1 = await res1.json();
    const res2 = await GET(makeReq(BASE_URL), params(PERIOD));
    const body2 = await res2.json();
    expect(body1).toEqual(body2);
  });
});
