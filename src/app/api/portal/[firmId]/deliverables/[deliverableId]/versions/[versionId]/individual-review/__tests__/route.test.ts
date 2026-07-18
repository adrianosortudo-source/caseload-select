/**
 * POST .../versions/[versionId]/individual-review: auth gate
 * (operator-only -- lawyer and client rejected), entity checks, and the
 * reason-required-when-true validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE = "d1111111-1111-1111-1111-111111111111";
const VERSION = "v1111111-1111-1111-1111-111111111111";

const state = {
  resolvedActor: { role: "operator", id: "op-1", name: "Adriano", email: null } as
    | { role: string; id: string | null; name: string | null; email: string | null }
    | null,
  detail: null as { deliverable: { firm_id: string }; versions: Array<{ id: string }> } | null,
  setResult: { ok: true, versionId: VERSION, requiresIndividualReview: true } as
    | { ok: true; versionId: string; requiresIndividualReview: boolean }
    | { ok: false; error: string },
  setCallArgs: null as unknown,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () => Promise.resolve(state.resolvedActor ? { actor: state.resolvedActor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
}));

vi.mock("@/lib/standing-publishing-authorization", () => ({
  setDeliverableVersionIndividualReviewRequirement: (args: unknown) => {
    state.setCallArgs = args;
    return Promise.resolve(state.setResult);
  },
}));

import { POST } from "../route";

function makeReq(body?: unknown): NextRequest {
  return { json: async () => body ?? {} } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ firmId: FIRM, deliverableId: DELIVERABLE, versionId: VERSION }) } as never;
}

beforeEach(() => {
  state.resolvedActor = { role: "operator", id: "op-1", name: "Adriano", email: null };
  state.detail = { deliverable: { firm_id: FIRM }, versions: [{ id: VERSION }] };
  state.setResult = { ok: true, versionId: VERSION, requiresIndividualReview: true };
  state.setCallArgs = null;
});

describe("POST individual-review: auth gate", () => {
  it("401s when there is no session", async () => {
    state.resolvedActor = null;
    const res = await POST(makeReq({ required: true, reason: "unusual" }), params());
    expect(res.status).toBe(401);
  });

  it("403s when the resolved actor is a lawyer (operator-only control)", async () => {
    state.resolvedActor = { role: "lawyer", id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" };
    const res = await POST(makeReq({ required: true, reason: "unusual" }), params());
    expect(res.status).toBe(403);
    expect(state.setCallArgs).toBeNull();
  });

  it("403s when the resolved actor is a client", async () => {
    state.resolvedActor = { role: "client", id: null, name: null, email: null };
    const res = await POST(makeReq({ required: true, reason: "unusual" }), params());
    expect(res.status).toBe(403);
  });
});

describe("POST individual-review: entity checks", () => {
  it("404s when the deliverable does not belong to this firm", async () => {
    state.detail = { deliverable: { firm_id: "other-firm" }, versions: [{ id: VERSION }] };
    const res = await POST(makeReq({ required: true, reason: "unusual" }), params());
    expect(res.status).toBe(404);
  });

  it("404s when the version does not belong to this deliverable", async () => {
    state.detail = { deliverable: { firm_id: FIRM }, versions: [] };
    const res = await POST(makeReq({ required: true, reason: "unusual" }), params());
    expect(res.status).toBe(404);
  });
});

describe("POST individual-review: validation", () => {
  it("400s when required is not a boolean", async () => {
    const res = await POST(makeReq({ required: "yes" }), params());
    expect(res.status).toBe(400);
    expect(state.setCallArgs).toBeNull();
  });

  it("400s when required=true with no reason", async () => {
    const res = await POST(makeReq({ required: true }), params());
    expect(res.status).toBe(400);
    expect(state.setCallArgs).toBeNull();
  });

  it("allows required=false with no reason (clearing the exception)", async () => {
    state.setResult = { ok: true, versionId: VERSION, requiresIndividualReview: false };
    const res = await POST(makeReq({ required: false }), params());
    expect(res.status).toBe(200);
  });
});

describe("POST individual-review: success", () => {
  it("passes the resolved operator identity, not a request-body actor", async () => {
    state.resolvedActor = { role: "operator", id: "op-99", name: "Adriano Domingues", email: null };
    await POST(
      makeReq({ required: true, reason: "unusual jurisdiction claim", actor: { id: "attacker", name: "Not Real" } }),
      params(),
    );
    const args = state.setCallArgs as { actor: { id: string; name: string } };
    expect(args.actor.id).toBe("op-99");
    expect(args.actor.name).toBe("Adriano Domingues");
  });

  it("200s with the resulting flag", async () => {
    const res = await POST(makeReq({ required: true, reason: "unusual" }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.requiresIndividualReview).toBe(true);
  });
});
