/**
 * Tests for GET/POST .../placements/[placementId]/receipts. This route had
 * no test coverage before the adversarial-review follow-up to
 * corrective-release finding 5 switched POST from requireOperator() +
 * getOperatorSession() + a hardcoded "Operator" actor name to
 * resolveDeliverableActor(), the same real-identity resolver the verify
 * route uses.
 *
 * Corrective release (claim binding, workstream 1): every successful POST
 * now requires a claim_id naming an active publication_placement_claims row
 * matching this firm/deliverable/placement/approved_version_id. This file
 * mocks that lookup directly rather than the RPC wrapper, since the route
 * loads the claim itself (never inferring its identity from the request).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE = "d1111111-1111-1111-1111-111111111111";
const PLACEMENT = "pl111111-1111-1111-1111-111111111111";
const VERSION = "v1111111-1111-1111-1111-111111111111";
const CLAIM_ID = "cl111111-1111-1111-1111-111111111111";

interface ClaimFixture {
  id: string;
  firm_id: string;
  deliverable_id: string;
  placement_id: string;
  approved_version_id: string;
  status: "active" | "released" | "superseded";
  claimed_by_role: "operator" | "lawyer" | "system";
  claimed_by_id: string | null;
}

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
  claimsById: {} as Record<string, ClaimFixture | null>,
};

function defaultClaim(overrides: Partial<ClaimFixture> = {}): ClaimFixture {
  return {
    id: CLAIM_ID,
    firm_id: FIRM,
    deliverable_id: DELIVERABLE,
    placement_id: PLACEMENT,
    approved_version_id: VERSION,
    status: "active",
    claimed_by_role: "operator",
    // null == "no authenticated identity recorded on the claim" -- the
    // route's identity check is skipped in that case, matching "where
    // available" in the corrective-release spec. Tests that need to assert
    // the identity check itself set this explicitly.
    claimed_by_id: null,
    ...overrides,
  };
}

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

const createReceiptResult = {
  value: { ok: true, receipt: { id: "receipt-1" } } as
    | { ok: true; receipt: unknown }
    | { ok: false; error: string; code?: string },
};

vi.mock("@/lib/publication-receipts", () => ({
  createReceipt: (args: unknown) => {
    state.createReceiptArgs = args;
    if (createReceiptResult.value.ok) {
      return Promise.resolve({ ok: true, receipt: { id: "receipt-1", ...(args as object) } });
    }
    return Promise.resolve(createReceiptResult.value);
  },
  listReceiptsForPlacement: () => Promise.resolve(state.receipts),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "publication_placement_claims") {
        throw new Error(`unexpected table in mock: ${table}`);
      }
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: () => Promise.resolve({ data: state.claimsById[val] ?? null, error: null }),
          }),
        }),
      };
    },
  },
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
  state.claimsById = { [CLAIM_ID]: defaultClaim() };
  createReceiptResult.value = { ok: true, receipt: { id: "receipt-1" } };
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
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(401);
    expect(state.createReceiptArgs).toBeNull();
  });

  it("403s when the resolved actor is a lawyer, not an operator", async () => {
    state.resolvedActor = { role: "lawyer", id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" };
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(403);
    expect(state.createReceiptArgs).toBeNull();
  });

  it("403s when the resolved actor is a client", async () => {
    state.resolvedActor = { role: "client", id: null, name: null, email: null };
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(403);
  });
});

describe("POST receipts: real operator identity is recorded (adversarial-review follow-up)", () => {
  it("records the resolved operator's real id and name, not a hardcoded literal", async () => {
    state.resolvedActor = { role: "operator", id: "op-42", name: "Adriano Domingues", email: "adriano@caseloadselect.ca" };
    await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    const args = state.createReceiptArgs as { actorId: string; actorName: string };
    expect(args.actorId).toBe("op-42");
    expect(args.actorName).toBe("Adriano Domingues");
  });

  it("falls back to the literal Operator only when the resolver itself could not resolve a name", async () => {
    state.resolvedActor = { role: "operator", id: "op-legacy", name: null, email: null };
    await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    const args = state.createReceiptArgs as { actorName: string };
    expect(args.actorName).toBe("Operator");
  });

  it("never trusts an actor identity supplied in the request body", async () => {
    await POST(
      makePostReq({
        approved_version_id: VERSION,
        claim_id: CLAIM_ID,
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
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(404);
  });

  it("404s when the placement does not belong to this deliverable", async () => {
    state.placements = [];
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(404);
  });

  it("409s when approved_version_id does not match the deliverable's own current approved_version_id", async () => {
    const res = await POST(makePostReq({ approved_version_id: "some-other-version", claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(409);
  });

  it("400s when neither public_url nor external_post_id is supplied", async () => {
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID }), params());
    expect(res.status).toBe(400);
    expect(state.createReceiptArgs).toBeNull();
  });
});

describe("POST receipts: claim_id contract (corrective release, workstream 1)", () => {
  it("400s with next_action reclaim_placement when claim_id is missing entirely", async () => {
    const res = await POST(makePostReq({ approved_version_id: VERSION, public_url: "https://example.test" }), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.nextAction).toBe("reclaim_placement");
    expect(state.createReceiptArgs).toBeNull();
  });

  it("404s with next_action reclaim_placement when claim_id does not reference any claim", async () => {
    const res = await POST(
      makePostReq({ approved_version_id: VERSION, claim_id: "cl-does-not-exist", public_url: "https://example.test" }),
      params(),
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.nextAction).toBe("reclaim_placement");
    expect(state.createReceiptArgs).toBeNull();
  });

  it("422s when the claim belongs to a different approved_version_id (stale/version-mismatched claim)", async () => {
    state.claimsById[CLAIM_ID] = defaultClaim({ approved_version_id: "some-other-version" });
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.nextAction).toBe("reclaim_placement");
  });

  it("422s when the claim belongs to a different placement", async () => {
    state.claimsById[CLAIM_ID] = defaultClaim({ placement_id: "some-other-placement" });
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(422);
  });

  it("409s with next_action reclaim_placement when the claim is already released", async () => {
    state.claimsById[CLAIM_ID] = defaultClaim({ status: "released" });
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.nextAction).toBe("reclaim_placement");
  });

  it("409s when the claim has been superseded", async () => {
    state.claimsById[CLAIM_ID] = defaultClaim({ status: "superseded" });
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(409);
  });

  it("403s when the claim was reserved by a different authenticated operator", async () => {
    state.claimsById[CLAIM_ID] = defaultClaim({ claimed_by_id: "some-other-operator" });
    state.resolvedActor = { role: "operator", id: "op-1", name: "Adriano Domingues", email: "adriano@caseloadselect.ca" };
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.nextAction).toBe("reclaim_placement");
  });

  it("succeeds and threads claim_id through to createReceipt when the claim matches in full", async () => {
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(200);
    const args = state.createReceiptArgs as { claimId: string };
    expect(args.claimId).toBe(CLAIM_ID);
  });

  it("never accepts artifact_sha256 from the request body -- the field is no longer part of the contract", async () => {
    await POST(
      makePostReq({
        approved_version_id: VERSION,
        claim_id: CLAIM_ID,
        public_url: "https://example.test",
        artifact_sha256: "f".repeat(64),
      }),
      params(),
    );
    const args = state.createReceiptArgs as Record<string, unknown>;
    expect(args.artifactSha256).toBeUndefined();
  });
});

describe("POST receipts: placement-tracking release gate (Content Performance follow-up)", () => {
  it("400s a firm_website receipt whose public_url does not carry this placement's utm_content", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", locale: null }];
    const res = await POST(
      makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.com/article" }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(state.createReceiptArgs).toBeNull();
    const json = await res.json();
    expect(json.error).toContain(PLACEMENT);
  });

  it("succeeds when the firm_website public_url carries the exact utm_content=placementId", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", locale: null }];
    const res = await POST(
      makePostReq({
        approved_version_id: VERSION,
        claim_id: CLAIM_ID,
        public_url: `https://example.com/article?utm_source=content_studio&utm_medium=organic&utm_content=${PLACEMENT}`,
      }),
      params(),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a near-miss utm_content that only partially matches the placement id", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", locale: null }];
    const res = await POST(
      makePostReq({
        approved_version_id: VERSION,
        claim_id: CLAIM_ID,
        public_url: `https://example.com/article?utm_content=${PLACEMENT}-extra`,
      }),
      params(),
    );
    expect(res.status).toBe(400);
  });

  it("does not gate non-website destinations (LinkedIn/GBP public_url is the platform post, not the content link)", async () => {
    state.placements = [{ id: PLACEMENT, destination: "linkedin_post", locale: null }];
    const res = await POST(
      makePostReq({
        approved_version_id: VERSION,
        claim_id: CLAIM_ID,
        public_url: "https://www.linkedin.com/posts/some-post-id",
      }),
      params(),
    );
    expect(res.status).toBe(200);
  });

  it("does not gate a firm_website receipt recorded with only external_post_id (no public_url to check)", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", locale: null }];
    const res = await POST(
      makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, external_post_id: "some-id" }),
      params(),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST receipts: insert-time claim rejection classified by stable error code (finding 5)", () => {
  it("409s with next_action reclaim_placement when the DB insert fails with the CLM01 errcode (a genuine race after the route's own pre-check passed)", async () => {
    createReceiptResult.value = {
      ok: false,
      error: "publication receipt actor does not match the claim's authenticated operator identity",
      code: "CLM01",
    };
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.nextAction).toBe("reclaim_placement");
  });

  it("400s without a claim next_action when the DB insert fails for an unrelated reason (no CLM01 code)", async () => {
    createReceiptResult.value = {
      ok: false,
      error: "duplicate key value violates unique constraint",
      code: "23505",
    };
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.nextAction).toBeUndefined();
  });

  it("400s without a claim next_action when the DB insert fails with no error code at all", async () => {
    createReceiptResult.value = {
      ok: false,
      error: "some other rejection",
    };
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.nextAction).toBeUndefined();
  });

  it("classifies a claim-related rejection whose message does not literally contain the substring claim_id (regression: the prior /claim_id/i regex missed this)", async () => {
    createReceiptResult.value = {
      ok: false,
      error: "publication receipt actor_role (lawyer) does not match the claim's claimed_by_role (operator)",
      code: "CLM01",
    };
    const res = await POST(makePostReq({ approved_version_id: VERSION, claim_id: CLAIM_ID, public_url: "https://example.test" }), params());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.nextAction).toBe("reclaim_placement");
  });
});
