/**
 * Tests for GET/POST .../placements/[placementId]/receipts. This route had
 * no test coverage before the adversarial-review follow-up to
 * corrective-release finding 5 switched POST from requireOperator() +
 * getOperatorSession() + a hardcoded "Operator" actor name to
 * resolveDeliverableActor(), the same real-identity resolver the verify
 * route uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE = "d1111111-1111-1111-1111-111111111111";
const PLACEMENT = "pl111111-1111-1111-1111-111111111111";
const VERSION = "v1111111-1111-1111-1111-111111111111";

const state = {
  operatorSession: { role: "operator" } as { role: string } | null,
  resolvedActor: { role: "operator", id: "op-1", name: "Adriano Domingues", email: "adriano@caseloadselect.ca" } as {
    role: string;
    id: string | null;
    name: string | null;
    email: string | null;
  } | null,
  detail: null as { deliverable: { firm_id: string; status: string; approved_version_id: string | null; current_version_id: string | null } } | null,
  placements: [] as Array<{ id: string; destination: string; locale: string | null }>,
  createReceiptArgs: null as unknown,
  receipts: [] as unknown[],
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: async () => {
    if (!state.operatorSession) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  },
}));

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () => Promise.resolve(state.resolvedActor ? { actor: state.resolvedActor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
}));

vi.mock("@/lib/content-placements", () => ({
  listPlacementsForDeliverable: () => Promise.resolve(state.placements),
}));

vi.mock("@/lib/publication-receipts", () => ({
  createReceipt: (args: unknown) => {
    state.createReceiptArgs = args;
    return Promise.resolve({ ok: true, receipt: { id: "receipt-1", ...(args as object) } });
  },
  listReceiptsForPlacement: () => Promise.resolve(state.receipts),
}));

import { GET, POST } from "../route";

function makeGetReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function makePostReq(body?: unknown): NextRequest {
  return { json: async () => body ?? {} } as unknown as NextRequest;
}

function params() {
  return {
    params: Promise.resolve({ firmId: FIRM, deliverableId: DELIVERABLE, placementId: PLACEMENT }),
  } as never;
}

beforeEach(() => {
  state.operatorSession = { role: "operator" };
  state.resolvedActor = { role: "operator", id: "op-1", name: "Adriano Domingues", email: "adriano@caseloadselect.ca" };
  state.detail = {
    deliverable: { firm_id: FIRM, status: "approved", approved_version_id: VERSION, current_version_id: VERSION },
  };
  state.placements = [{ id: PLACEMENT, destination: "linkedin_post", locale: null }];
  state.createReceiptArgs = null;
  state.receipts = [];
});

describe("GET receipts: auth gate (unchanged)", () => {
  it("401s when there is no operator session", async () => {
    state.operatorSession = null;
    const res = await GET(makeGetReq(), params());
    expect(res.status).toBe(401);
  });

  it("200s and lists receipts for an authenticated operator", async () => {
    const res = await GET(makeGetReq(), params());
    expect(res.status).toBe(200);
  });
});

describe("POST receipts: auth gate (adversarial-review follow-up)", () => {
  it("401s when there is no session at all", async () => {
    state.resolvedActor = null;
    const res = await POST(makePostReq({ approved_version_id: VERSION, public_url: "https://example.test" }), params());
    expect(res.status).toBe(401);
    expect(state.createReceiptArgs).toBeNull();
  });

  it("403s when the resolved actor is a lawyer, not an operator", async () => {
    state.resolvedActor = { role: "lawyer", id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" };
    const res = await POST(makePostReq({ approved_version_id: VERSION, public_url: "https://example.test" }), params());
    expect(res.status).toBe(403);
    expect(state.createReceiptArgs).toBeNull();
  });

  it("403s when the resolved actor is a client", async () => {
    state.resolvedActor = { role: "client", id: null, name: null, email: null };
    const res = await POST(makePostReq({ approved_version_id: VERSION, public_url: "https://example.test" }), params());
    expect(res.status).toBe(403);
  });
});

describe("POST receipts: real operator identity is recorded (adversarial-review follow-up)", () => {
  it("records the resolved operator's real id and name, not a hardcoded literal", async () => {
    state.resolvedActor = { role: "operator", id: "op-42", name: "Adriano Domingues", email: "adriano@caseloadselect.ca" };
    await POST(makePostReq({ approved_version_id: VERSION, public_url: "https://example.test" }), params());
    const args = state.createReceiptArgs as { actorId: string; actorName: string };
    expect(args.actorId).toBe("op-42");
    expect(args.actorName).toBe("Adriano Domingues");
  });

  it("falls back to the literal Operator only when the resolver itself could not resolve a name", async () => {
    state.resolvedActor = { role: "operator", id: "op-legacy", name: null, email: null };
    await POST(makePostReq({ approved_version_id: VERSION, public_url: "https://example.test" }), params());
    const args = state.createReceiptArgs as { actorName: string };
    expect(args.actorName).toBe("Operator");
  });

  it("never trusts an actor identity supplied in the request body", async () => {
    await POST(
      makePostReq({
        approved_version_id: VERSION,
        public_url: "https://example.test",
        actorId: "attacker-supplied",
        actorName: "Not Real",
      }),
      params(),
    );
    const args = state.createReceiptArgs as { actorId: string; actorName: string };
    expect(args.actorId).toBe("op-1");
    expect(args.actorName).toBe("Adriano Domingues");
  });
});

describe("POST receipts: entity and validation gates (regression)", () => {
  it("404s when the deliverable does not belong to this firm", async () => {
    state.detail = { deliverable: { firm_id: "other-firm", status: "approved", approved_version_id: VERSION, current_version_id: VERSION } };
    const res = await POST(makePostReq({ approved_version_id: VERSION, public_url: "https://example.test" }), params());
    expect(res.status).toBe(404);
  });

  it("404s when the placement does not belong to this deliverable", async () => {
    state.placements = [];
    const res = await POST(makePostReq({ approved_version_id: VERSION, public_url: "https://example.test" }), params());
    expect(res.status).toBe(404);
  });

  it("409s when approved_version_id does not match the deliverable's own current approved_version_id", async () => {
    const res = await POST(makePostReq({ approved_version_id: "some-other-version", public_url: "https://example.test" }), params());
    expect(res.status).toBe(409);
  });

  it("400s when neither public_url nor external_post_id is supplied", async () => {
    const res = await POST(makePostReq({ approved_version_id: VERSION }), params());
    expect(res.status).toBe(400);
  });
});
