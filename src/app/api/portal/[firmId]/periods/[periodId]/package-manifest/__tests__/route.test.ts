import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

const state = {
  isOperator: true,
  result: { ok: true, packageId: "pkg-1", manifestRevision: 1 } as unknown,
  lastCall: null as unknown,
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () =>
    Promise.resolve(state.isOperator ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
}));

vi.mock("@/lib/publishing-package-control-room-mutations", () => ({
  createPackageManifest: (...args: unknown[]) => {
    state.lastCall = args;
    return Promise.resolve(state.result);
  },
}));

import { POST } from "../route";

function req(body: unknown, badJson = false) {
  return { json: () => (badJson ? Promise.reject(new Error("bad json")) : Promise.resolve(body)) } as never;
}

function params() {
  return { params: Promise.resolve({ firmId: FIRM, periodId: PERIOD }) } as never;
}

beforeEach(() => {
  state.isOperator = true;
  state.result = { ok: true, packageId: "pkg-1", manifestRevision: 1 };
  state.lastCall = null;
});

describe("POST package-manifest", () => {
  it("rejects a non-operator session", async () => {
    state.isOperator = false;
    const res = await POST(req({ manifest: {}, expected_piece_count: 16 }), params());
    expect(res.status).toBe(403);
  });

  it("an Authorization: Bearer header does not bypass a denied operator session", async () => {
    state.isOperator = false;
    const withBearer = { json: () => Promise.resolve({ manifest: {}, expected_piece_count: 16 }), headers: { get: () => "Bearer x" } } as never;
    const res = await POST(withBearer, params());
    expect(res.status).toBe(403);
  });

  it("400s on invalid JSON body", async () => {
    const res = await POST(req(null, true), params());
    expect(res.status).toBe(400);
  });

  it("400s when expected_piece_count is missing or not a number", async () => {
    const res = await POST(req({ manifest: {} }), params());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("expected_piece_count is required");
  });

  it("calls createPackageManifest with the route's firmId/periodId and returns 200 on success", async () => {
    const manifest = { schema_version: 1 };
    const res = await POST(req({ manifest, expected_piece_count: 16 }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.packageId).toBe("pkg-1");
    expect(state.lastCall).toEqual([FIRM, PERIOD, manifest, 16]);
  });

  it("422s when the mutations layer returns ok:false", async () => {
    state.result = { ok: false, error: "manifest failed validation: pieces: wrong count" };
    const res = await POST(req({ manifest: {}, expected_piece_count: 16 }), params());
    expect(res.status).toBe(422);
  });
});
