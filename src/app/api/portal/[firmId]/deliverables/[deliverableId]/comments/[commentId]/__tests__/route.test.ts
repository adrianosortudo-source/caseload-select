/**
 * Integration tests for the comment resolve/reopen route
 * (PATCH .../comments/[commentId]).
 *
 * Guards: auth (401), a boolean `resolved` is required (400), firm scope and
 * comment membership (404).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";
const COMMENT = "55555555-5555-5555-5555-555555555555";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

const state: { actor: Actor; detail: unknown; resolveArgs: Record<string, unknown> | null } = {
  actor: null,
  detail: null,
  resolveArgs: null,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
  setCommentResolved: (args: Record<string, unknown>) => {
    state.resolveArgs = args;
    return Promise.resolve({ ok: true });
  },
}));

import { PATCH } from "../route";

const LAWYER: Actor = { role: "lawyer", id: "law1", name: "Damaris", email: "d@firm.ca" };

function makeDetail(firmId = FIRM, comments = [{ id: COMMENT }]) {
  return {
    deliverable: { id: DELIV, firm_id: firmId, title: "T" },
    versions: [],
    comments,
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

const params = () =>
  ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV, commentId: COMMENT }) }) as never;

beforeEach(() => {
  state.actor = LAWYER;
  state.detail = makeDetail();
  state.resolveArgs = null;
});

describe("PATCH comments/[commentId]", () => {
  it("401 when unauthenticated", async () => {
    state.actor = null;
    const res = await PATCH(req({ resolved: true }), params());
    expect(res.status).toBe(401);
  });

  it("400 when resolved is not a boolean", async () => {
    const res = await PATCH(req({ resolved: "yes" }), params());
    expect(res.status).toBe(400);
  });

  it("404 when the comment is not part of this deliverable", async () => {
    state.detail = makeDetail(FIRM, [{ id: "other" }]);
    const res = await PATCH(req({ resolved: true }), params());
    expect(res.status).toBe(404);
  });

  it("200 resolves the comment", async () => {
    const res = await PATCH(req({ resolved: true }), params());
    expect(res.status).toBe(200);
    expect(state.resolveArgs!.resolved).toBe(true);
    expect(state.resolveArgs!.commentId).toBe(COMMENT);
    expect(state.resolveArgs!.actorRole).toBe("lawyer");
  });

  it("200 reopens the comment", async () => {
    const res = await PATCH(req({ resolved: false }), params());
    expect(res.status).toBe(200);
    expect(state.resolveArgs!.resolved).toBe(false);
  });
});
