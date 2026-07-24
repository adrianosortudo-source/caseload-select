/**
 * POST .../package-assets: the HTTP boundary in front of registerCandidate.
 * Operator-only, mocked mutations layer -- proves routing/auth/status-code
 * behavior, not the mutations layer's own DB round-trips (see
 * publishing-package-control-room-mutations.ts's own header comment for
 * that boundary).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

const state = {
  isOperator: true,
  result: { ok: true, assetId: "asset-1" } as unknown,
  lastCall: null as unknown,
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () =>
    Promise.resolve(state.isOperator ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
}));

vi.mock("@/lib/publishing-package-control-room-mutations", () => ({
  registerCandidate: (...args: unknown[]) => {
    state.lastCall = args;
    return Promise.resolve(state.result);
  },
}));

import { POST } from "../route";

function req(body: unknown, badJson = false) {
  return {
    json: () => (badJson ? Promise.reject(new Error("bad json")) : Promise.resolve(body)),
  } as never;
}

function params() {
  return { params: Promise.resolve({ firmId: FIRM, periodId: PERIOD }) } as never;
}

beforeEach(() => {
  state.isOperator = true;
  state.result = { ok: true, assetId: "asset-1" };
  state.lastCall = null;
});

describe("POST package-assets", () => {
  it("rejects a non-operator session", async () => {
    state.isOperator = false;
    const res = await POST(req({}), params());
    expect(res.status).toBe(403);
  });

  it("an Authorization: Bearer header does not bypass a denied operator session -- this route consults only the session cookie via requireOperator, never a bearer credential (the Publishing Package Gateway's own credential included)", async () => {
    state.isOperator = false;
    const withBearer = {
      json: () => Promise.resolve({}),
      headers: { get: (name: string) => (name === "Authorization" ? "Bearer some-token" : null) },
    } as never;
    const res = await POST(withBearer, params());
    expect(res.status).toBe(403);
  });

  it("400s on invalid JSON body", async () => {
    const res = await POST(req(null, true), params());
    expect(res.status).toBe(400);
  });

  it("calls registerCandidate with the route's firmId/periodId and returns 200 on success", async () => {
    const res = await POST(req({ content_slot_id: "counsel-note-en", asset_role: "website_article_hero" }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.assetId).toBe("asset-1");
    expect(state.lastCall).toEqual([FIRM, PERIOD, expect.objectContaining({ contentSlotId: "counsel-note-en" })]);
  });

  it("422s when the mutations layer returns ok:false", async () => {
    state.result = { ok: false, error: "no matching requirement in manifest" };
    const res = await POST(req({}), params());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("no matching requirement in manifest");
  });
});
