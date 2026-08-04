import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

const state = {
  isOperator: true,
  loadResult: { manifest: { pieces: [] }, assets: [] } as unknown,
  publicationInputs: { standingAuthorizationActive: false } as unknown,
  runResult: { ok: true, piecesClear: 16, piecesBlocked: 0, packageStatus: "release_ready" } as unknown,
  lastRunPreflightCall: null as unknown,
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () =>
    Promise.resolve(state.isOperator ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
}));

vi.mock("@/lib/publishing-package-control-room-loader", () => ({
  loadControlRoomPackage: () => Promise.resolve(state.loadResult),
  loadPublicationInputs: () => Promise.resolve(state.publicationInputs),
}));

vi.mock("@/lib/publishing-package-control-room-mutations", () => ({
  runPackagePreflight: (...args: unknown[]) => {
    state.lastRunPreflightCall = args;
    return Promise.resolve(state.runResult);
  },
}));

import { POST } from "../route";

function params() {
  return { params: Promise.resolve({ firmId: FIRM, periodId: PERIOD }) } as never;
}

beforeEach(() => {
  state.isOperator = true;
  state.loadResult = { manifest: { pieces: [] }, assets: [] };
  state.runResult = { ok: true, piecesClear: 16, piecesBlocked: 0, packageStatus: "release_ready" };
  state.lastRunPreflightCall = null;
});

describe("POST package-preflight-run", () => {
  it("rejects a non-operator session", async () => {
    state.isOperator = false;
    const res = await POST({} as never, params());
    expect(res.status).toBe(403);
  });

  it("an Authorization: Bearer header does not bypass a denied operator session", async () => {
    state.isOperator = false;
    const withBearer = { headers: { get: () => "Bearer x" } } as never;
    const res = await POST(withBearer, params());
    expect(res.status).toBe(403);
  });

  it("404s when no package resolves for this period", async () => {
    state.loadResult = null;
    const res = await POST({} as never, params());
    expect(res.status).toBe(404);
  });

  it("returns piecesClear/piecesBlocked/packageStatus for an operator", async () => {
    const res = await POST({} as never, params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.piecesClear).toBe(16);
    expect(body.packageStatus).toBe("release_ready");
  });

  it("passes the already-loaded package as runPackagePreflight's 4th (preloaded) argument, so the package is queried only once per request", async () => {
    await POST({} as never, params());
    expect(state.lastRunPreflightCall).toEqual([FIRM, PERIOD, state.publicationInputs, state.loadResult]);
  });

  it("422s when the mutations layer returns ok:false", async () => {
    state.runResult = { ok: false, error: "checks upsert failed: db error" };
    const res = await POST({} as never, params());
    expect(res.status).toBe(422);
  });
});
