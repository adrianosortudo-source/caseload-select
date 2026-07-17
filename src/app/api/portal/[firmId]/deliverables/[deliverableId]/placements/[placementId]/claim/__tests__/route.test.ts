/**
 * Tests for POST .../placements/[placementId]/claim (corrective-release
 * finding 4): auth gate, idempotent replay, competing-claim rejection, and
 * that the route never calls an external publisher (there is none in this
 * workstream).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE = "d1111111-1111-1111-1111-111111111111";
const PLACEMENT = "pl111111-1111-1111-1111-111111111111";
const VERSION = "v1111111-1111-1111-1111-111111111111";

const state = {
  detail: null as { deliverable: { firm_id: string } } | null,
  placements: [] as Array<{ id: string; destination: string }>,
  resolvedActor: { role: "operator", id: "op-1", name: "Adriano", email: null } as {
    role: string;
    id: string | null;
    name: string | null;
    email: string | null;
  } | null,
  claimResult: { ok: true, claimId: "claim-1", idempotentReplay: false, status: "active" } as {
    ok: boolean;
    claimId?: string;
    idempotentReplay?: boolean;
    status?: string;
    error?: string;
    existingClaimId?: string;
    nextAction?: string;
  },
  claimCallArgs: null as unknown,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () => Promise.resolve(state.resolvedActor ? { actor: state.resolvedActor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
}));

vi.mock("@/lib/content-placements", () => ({
  listPlacementsForDeliverable: () => Promise.resolve(state.placements),
}));

vi.mock("@/lib/publication-placement-claims", () => ({
  claimPlacementForPublish: (args: unknown) => {
    state.claimCallArgs = args;
    return Promise.resolve(state.claimResult);
  },
}));

import { POST } from "../route";

function makeReq(body?: unknown): NextRequest {
  return { json: async () => body ?? {} } as unknown as NextRequest;
}

function params() {
  return {
    params: Promise.resolve({ firmId: FIRM, deliverableId: DELIVERABLE, placementId: PLACEMENT }),
  } as never;
}

beforeEach(() => {
  state.detail = { deliverable: { firm_id: FIRM } };
  state.placements = [{ id: PLACEMENT, destination: "linkedin_post" }];
  state.resolvedActor = { role: "operator", id: "op-1", name: "Adriano", email: null };
  state.claimResult = { ok: true, claimId: "claim-1", idempotentReplay: false, status: "active" };
  state.claimCallArgs = null;
});

describe("POST claim: auth gate", () => {
  it("401s when there is no session at all", async () => {
    state.resolvedActor = null;
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k1" }), params());
    expect(res.status).toBe(401);
  });

  it("403s when the resolved actor is a lawyer, not an operator", async () => {
    state.resolvedActor = { role: "lawyer", id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" };
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k1" }), params());
    expect(res.status).toBe(403);
    expect(state.claimCallArgs).toBeNull();
  });

  it("403s when the resolved actor is a client", async () => {
    state.resolvedActor = { role: "client", id: null, name: null, email: null };
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k1" }), params());
    expect(res.status).toBe(403);
  });
});

describe("POST claim: entity mismatches and validation", () => {
  it("404s when the deliverable does not belong to this firm", async () => {
    state.detail = { deliverable: { firm_id: "other-firm" } };
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k1" }), params());
    expect(res.status).toBe(404);
  });

  it("404s when the placement does not belong to this deliverable", async () => {
    state.placements = [];
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k1" }), params());
    expect(res.status).toBe(404);
  });

  it("400s when approved_version_id is missing", async () => {
    const res = await POST(makeReq({ idempotency_key: "k1" }), params());
    expect(res.status).toBe(400);
    expect(state.claimCallArgs).toBeNull();
  });

  it("400s when idempotency_key is missing or blank", async () => {
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "   " }), params());
    expect(res.status).toBe(400);
    expect(state.claimCallArgs).toBeNull();
  });
});

describe("POST claim: idempotency and competing claims", () => {
  it("returns 200 with idempotentReplay:true when the RPC reports a replay", async () => {
    state.claimResult = { ok: true, claimId: "claim-1", idempotentReplay: true, status: "active" };
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k1" }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotentReplay).toBe(true);
    expect(body.claimId).toBe("claim-1");
  });

  it("returns 409 when the RPC reports a competing active claim", async () => {
    state.claimResult = {
      ok: false,
      error: "placement already has an active claim",
      existingClaimId: "claim-other",
      nextAction: "needs_reverification",
    };
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k2" }), params());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existingClaimId).toBe("claim-other");
  });

  it("returns 409 when the RPC reports the placement is already published", async () => {
    state.claimResult = { ok: false, error: "placement is already published and verified", nextAction: "already_published" };
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k3" }), params());
    expect(res.status).toBe(409);
  });

  it("returns 422 when the RPC reports version drift or a non-approved deliverable", async () => {
    state.claimResult = { ok: false, error: "version drift", nextAction: "resolve_version_drift" };
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k4" }), params());
    expect(res.status).toBe(422);
  });

  it("returns 409 when the RPC reports the idempotency_key was reused for a different request (finding 4)", async () => {
    state.claimResult = {
      ok: false,
      error: "idempotency_key was already used for a different request",
      existingClaimId: "claim-other",
      nextAction: "use_new_idempotency_key",
    };
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k4b" }), params());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.nextAction).toBe("use_new_idempotency_key");
    expect(body.existingClaimId).toBe("claim-other");
  });

  it("passes supersedes_claim_id through to the RPC wrapper when supplied", async () => {
    await POST(
      makeReq({ approved_version_id: VERSION, idempotency_key: "k5", supersedes_claim_id: "claim-old" }),
      params(),
    );
    expect((state.claimCallArgs as { supersedesClaimId: string }).supersedesClaimId).toBe("claim-old");
  });

  it("passes the resolved operator's real identity as the claim actor, not a request-body value", async () => {
    state.resolvedActor = { role: "operator", id: "op-99", name: "Adriano Domingues", email: "adriano@caseloadselect.ca" };
    await POST(
      makeReq({ approved_version_id: VERSION, idempotency_key: "k6", actor: { id: "attacker-supplied", name: "Not Real" } }),
      params(),
    );
    const args = state.claimCallArgs as { actor: { id: string; name: string } };
    expect(args.actor.id).toBe("op-99");
    expect(args.actor.name).toBe("Adriano Domingues");
  });
});

describe("POST claim: no external publisher is ever invoked", () => {
  it("the successful response contains only claim metadata, never a publish/post result", async () => {
    const res = await POST(makeReq({ approved_version_id: VERSION, idempotency_key: "k7" }), params());
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["claimId", "idempotentReplay", "ok", "status"].sort());
  });
});
