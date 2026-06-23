/**
 * Integration tests for the deliverables list + create route
 * (GET + POST /api/portal/[firmId]/deliverables).
 *
 * GET lists (auth). POST creates after validating title + content_kind.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "11111111-1111-1111-1111-111111111111";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

const state: { actor: Actor; createArgs: Record<string, unknown> | null } = {
  actor: null,
  createArgs: null,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  listDeliverables: () => Promise.resolve([{ id: "d1", title: "One" }]),
  createDeliverable: (args: Record<string, unknown>) => {
    state.createArgs = args;
    return Promise.resolve({ ok: true, deliverable: { id: "dNew", ...args } });
  },
}));

import { GET, POST } from "../route";

const OPERATOR: Actor = { role: "operator", id: null, name: "Operator", email: null };

function req(body?: unknown, query = "") {
  return {
    json: async () => body,
    headers: { get: () => null },
    url: `https://app.caseloadselect.ca/api/portal/${FIRM}/deliverables${query}`,
  } as never;
}

const params = () => ({ params: Promise.resolve({ firmId: FIRM }) }) as never;

beforeEach(() => {
  state.actor = OPERATOR;
  state.createArgs = null;
});

describe("GET deliverables", () => {
  it("401 when unauthenticated", async () => {
    state.actor = null;
    const res = await GET(req(undefined, ""), params());
    expect(res.status).toBe(401);
  });

  it("200 returns the list", async () => {
    const res = await GET(req(undefined, ""), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliverables).toHaveLength(1);
  });
});

describe("POST deliverables", () => {
  it("401 when unauthenticated", async () => {
    state.actor = null;
    const res = await POST(req({ title: "X", content_kind: "text" }), params());
    expect(res.status).toBe(401);
  });

  it("400 when the title is missing", async () => {
    const res = await POST(req({ content_kind: "text" }), params());
    expect(res.status).toBe(400);
    expect(state.createArgs).toBeNull();
  });

  it("400 when the content_kind is invalid", async () => {
    const res = await POST(req({ title: "X", content_kind: "video" }), params());
    expect(res.status).toBe(400);
  });

  it("200 creates with a cleaned title and the chosen kind", async () => {
    const res = await POST(req({ title: "  My   Draft  ", content_kind: "image" }), params());
    expect(res.status).toBe(200);
    expect(state.createArgs!.title).toBe("My Draft");
    expect(state.createArgs!.contentKind).toBe("image");
  });
});
