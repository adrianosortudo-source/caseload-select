import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";
const ASSET = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

const state = { isOperator: true, result: { ok: true, assetId: ASSET } as unknown, lastCall: null as unknown };

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () =>
    Promise.resolve(state.isOperator ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
}));

vi.mock("@/lib/publishing-package-control-room-mutations", () => ({
  selectCandidate: (...args: unknown[]) => {
    state.lastCall = args;
    return Promise.resolve(state.result);
  },
}));

import { POST } from "../route";

function params() {
  return { params: Promise.resolve({ firmId: FIRM, periodId: PERIOD, assetId: ASSET }) } as never;
}

beforeEach(() => {
  state.isOperator = true;
  state.result = { ok: true, assetId: ASSET };
  state.lastCall = null;
});

describe("POST package-assets/[assetId]/select", () => {
  it("rejects a non-operator session", async () => {
    state.isOperator = false;
    const res = await POST({} as never, params());
    expect(res.status).toBe(403);
  });

  it("an Authorization: Bearer header does not bypass a denied operator session", async () => {
    state.isOperator = false;
    const withBearer = { headers: { get: () => "Bearer some-token" } } as never;
    const res = await POST(withBearer, params());
    expect(res.status).toBe(403);
  });

  it("calls selectCandidate with firmId/periodId/assetId and returns 200 on success", async () => {
    const res = await POST({} as never, params());
    expect(res.status).toBe(200);
    expect(state.lastCall).toEqual([FIRM, PERIOD, ASSET]);
  });

  it("422s when the mutations layer returns ok:false", async () => {
    state.result = { ok: false, error: "candidate has been superseded and cannot be bound" };
    const res = await POST({} as never, params());
    expect(res.status).toBe(422);
  });
});
