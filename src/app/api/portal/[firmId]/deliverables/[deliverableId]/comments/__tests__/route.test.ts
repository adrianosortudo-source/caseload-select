/**
 * Integration tests for the comment-add route
 * (POST /api/portal/[firmId]/deliverables/[deliverableId]/comments).
 *
 * Guards: auth (401), firm scope (404), the version_id must belong to this
 * deliverable (400), a non-empty body is required (400). The annotation is
 * validated by the real deliverables-pure validator (out-of-range pin coords
 * are clamped).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";
const V_CUR = "33333333-3333-3333-3333-333333333333";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

const state: {
  actor: Actor;
  detail: unknown;
  addArgs: Record<string, unknown> | null;
} = { actor: null, detail: null, addArgs: null };

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
  addComment: (args: Record<string, unknown>) => {
    state.addArgs = args;
    return Promise.resolve({ ok: true, comment: { id: "c1" } });
  },
}));

import { POST } from "../route";

const LAWYER: Actor = { role: "lawyer", id: "law1", name: "Damaris", email: "d@firm.ca" };

function makeDetail(firmId = FIRM) {
  return {
    deliverable: { id: DELIV, firm_id: firmId, title: "T" },
    versions: [{ id: V_CUR, version_number: 1 }],
    comments: [],
    approvals: [],
  };
}

function req(body: unknown) {
  return {
    json: async () => body,
    headers: { get: () => null },
    url: "https://app.caseloadselect.ca/x",
  } as never;
}

const params = () => ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV }) }) as never;

beforeEach(() => {
  state.actor = LAWYER;
  state.detail = makeDetail();
  state.addArgs = null;
});

describe("POST comments", () => {
  it("401 when unauthenticated", async () => {
    state.actor = null;
    const res = await POST(req({ version_id: V_CUR, body: "hi" }), params());
    expect(res.status).toBe(401);
  });

  it("404 when the deliverable is another firm's", async () => {
    state.detail = makeDetail("99999999-9999-9999-9999-999999999999");
    const res = await POST(req({ version_id: V_CUR, body: "hi" }), params());
    expect(res.status).toBe(404);
  });

  it("400 when the version_id is not part of this deliverable", async () => {
    const res = await POST(req({ version_id: "ffffffff-ffff-ffff-ffff-ffffffffffff", body: "hi" }), params());
    expect(res.status).toBe(400);
  });

  it("400 when the body is empty", async () => {
    const res = await POST(req({ version_id: V_CUR, body: "   " }), params());
    expect(res.status).toBe(400);
  });

  it("200 and clamps an out-of-range pin annotation", async () => {
    const res = await POST(
      req({ version_id: V_CUR, body: "move this up", annotation: { type: "pin", x: 1.4, y: -0.3 } }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.addArgs!.annotation).toEqual({ type: "pin", x: 1, y: 0 });
    expect(state.addArgs!.body).toBe("move this up");
  });

  it("200 with a null annotation (general comment) when annotation is omitted", async () => {
    const res = await POST(req({ version_id: V_CUR, body: "looks good overall" }), params());
    expect(res.status).toBe(200);
    expect(state.addArgs!.annotation).toBeNull();
  });
});
