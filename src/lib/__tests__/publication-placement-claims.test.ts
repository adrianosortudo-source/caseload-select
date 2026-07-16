/**
 * claimPlacementForPublish (corrective-release finding 4): the RPC call
 * shape and the snake_case -> camelCase response mapping. Real
 * concurrency/idempotency/lock behavior is proven at the database layer
 * (scripts/verify-publication-placement-claim.sql, run against
 * production); this test covers the I/O wrapper only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const state = {
  rpcArgs: null as unknown,
  rpcResponse: { data: null as unknown, error: null as { message: string } | null },
};

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: unknown) => {
      state.rpcArgs = { name, args };
      return Promise.resolve(state.rpcResponse);
    },
  },
}));

import { claimPlacementForPublish } from "../publication-placement-claims";

const FIRM = "f1111111-1111-1111-1111-111111111111";
const DELIVERABLE = "d1111111-1111-1111-1111-111111111111";
const PLACEMENT = "p1111111-1111-1111-1111-111111111111";
const VERSION = "v1111111-1111-1111-1111-111111111111";

beforeEach(() => {
  state.rpcArgs = null;
  state.rpcResponse = { data: null, error: null };
});

describe("claimPlacementForPublish", () => {
  it("calls the RPC with snake_case params matching the migration's function signature", async () => {
    state.rpcResponse = { data: { ok: true, claim_id: "c1", idempotent_replay: false, status: "active" }, error: null };
    await claimPlacementForPublish({
      firmId: FIRM,
      deliverableId: DELIVERABLE,
      placementId: PLACEMENT,
      approvedVersionId: VERSION,
      idempotencyKey: "key-1",
      actor: { role: "operator", id: "op-1", name: "Adriano", email: null },
      supersedesClaimId: "prior-claim",
    });
    const call = state.rpcArgs as { name: string; args: Record<string, unknown> };
    expect(call.name).toBe("claim_placement_for_publish");
    expect(call.args).toEqual({
      p_firm_id: FIRM,
      p_deliverable_id: DELIVERABLE,
      p_placement_id: PLACEMENT,
      p_approved_version_id: VERSION,
      p_idempotency_key: "key-1",
      p_actor_role: "operator",
      p_actor_id: "op-1",
      p_actor_name: "Adriano",
      p_supersedes_claim_id: "prior-claim",
    });
  });

  it("maps a successful RPC response into camelCase, non-throwing", async () => {
    state.rpcResponse = { data: { ok: true, claim_id: "c1", idempotent_replay: true, status: "active" }, error: null };
    const result = await claimPlacementForPublish({
      firmId: FIRM,
      deliverableId: DELIVERABLE,
      placementId: PLACEMENT,
      approvedVersionId: VERSION,
      idempotencyKey: "key-1",
      actor: { role: "operator", id: "op-1", name: "Adriano", email: null },
    });
    expect(result).toEqual({
      ok: true,
      claimId: "c1",
      idempotentReplay: true,
      status: "active",
      error: undefined,
      existingClaimId: undefined,
      nextAction: undefined,
    });
  });

  it("maps a rejected RPC response (ok:false) without throwing", async () => {
    state.rpcResponse = {
      data: { ok: false, error: "placement already has an active claim", existing_claim_id: "c-other", next_action: "needs_reverification" },
      error: null,
    };
    const result = await claimPlacementForPublish({
      firmId: FIRM,
      deliverableId: DELIVERABLE,
      placementId: PLACEMENT,
      approvedVersionId: VERSION,
      idempotencyKey: "key-2",
      actor: { role: "operator", id: "op-1", name: "Adriano", email: null },
    });
    expect(result.ok).toBe(false);
    expect(result.existingClaimId).toBe("c-other");
    expect(result.nextAction).toBe("needs_reverification");
  });

  it("returns ok:false, does not throw, when the RPC call itself errors (network/DB failure)", async () => {
    state.rpcResponse = { data: null, error: { message: "connection reset" } };
    const result = await claimPlacementForPublish({
      firmId: FIRM,
      deliverableId: DELIVERABLE,
      placementId: PLACEMENT,
      approvedVersionId: VERSION,
      idempotencyKey: "key-3",
      actor: { role: "operator", id: "op-1", name: "Adriano", email: null },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/connection reset/);
  });

  it("defaults supersedesClaimId to null when omitted", async () => {
    state.rpcResponse = { data: { ok: true, claim_id: "c1" }, error: null };
    await claimPlacementForPublish({
      firmId: FIRM,
      deliverableId: DELIVERABLE,
      placementId: PLACEMENT,
      approvedVersionId: VERSION,
      idempotencyKey: "key-1",
      actor: { role: "operator", id: "op-1", name: "Adriano", email: null },
    });
    const call = state.rpcArgs as { args: Record<string, unknown> };
    expect(call.args.p_supersedes_claim_id).toBeNull();
  });
});
