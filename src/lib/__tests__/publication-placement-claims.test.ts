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
const CLAIM = "c1111111-1111-1111-1111-111111111111";

beforeEach(() => {
  state.rpcArgs = null;
  state.rpcResponse = { data: null, error: null };
});

describe("claimPlacementForPublish", () => {
  it("calls the RPC with snake_case params matching the migration's function signature", async () => {
    state.rpcResponse = { data: { ok: true, claim_id: CLAIM, idempotent_replay: false, status: "active" }, error: null };
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
    state.rpcResponse = { data: { ok: true, claim_id: CLAIM, idempotent_replay: true, status: "active" }, error: null };
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
      claimId: CLAIM,
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
    state.rpcResponse = {
      data: { ok: true, claim_id: CLAIM, idempotent_replay: false, status: "active" },
      error: null,
    };
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

  describe("malformed RPC response handling (runtime validation, not a bare cast)", () => {
    const baseInput = {
      firmId: FIRM,
      deliverableId: DELIVERABLE,
      placementId: PLACEMENT,
      approvedVersionId: VERSION,
      idempotencyKey: "key-1",
      actor: { role: "operator" as const, id: "op-1", name: "Adriano", email: null },
    };

    it.each([
      ["a string", "unexpected string"],
      ["a number", 42],
      ["an array", [1, 2, 3]],
    ])("fails closed when data is %s, not an object", async (_label, malformed) => {
      state.rpcResponse = { data: malformed, error: null };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/^malformed claim_placement_for_publish response:/);
    });

    it("fails closed when data is null", async () => {
      state.rpcResponse = { data: null, error: null };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/^malformed claim_placement_for_publish response:/);
    });

    it("fails closed when data is undefined", async () => {
      state.rpcResponse = { data: undefined, error: null };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/^malformed claim_placement_for_publish response:/);
    });

    it("fails closed when the ok field is missing entirely", async () => {
      state.rpcResponse = { data: { claim_id: "c1" }, error: null };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/"ok" must be a boolean/);
    });

    it.each([["the string \"true\"", "true"], ["the number 1", 1]])(
      "fails closed when ok is %s instead of a real boolean (regression: old Boolean(...) coercion failed open)",
      async (_label, badOkValue) => {
        state.rpcResponse = { data: { ok: badOkValue, claim_id: "c1" }, error: null };
        const result = await claimPlacementForPublish(baseInput);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/"ok" must be a boolean/);
      },
    );

    it("fails closed when ok:true but claim_id is missing", async () => {
      state.rpcResponse = { data: { ok: true }, error: null };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/"claim_id" must be a UUID string/);
    });

    it("fails closed when ok:true but claim_id is not a string", async () => {
      state.rpcResponse = { data: { ok: true, claim_id: 12345 }, error: null };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/"claim_id" must be a UUID string/);
    });

    it("fails closed when ok:true with an unrecognized status value", async () => {
      state.rpcResponse = { data: { ok: true, claim_id: "c1", status: "bogus" }, error: null };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/unrecognized "status" value/);
    });

    it("fails closed when ok:false with an unrecognized next_action value", async () => {
      state.rpcResponse = {
        data: { ok: false, error: "some rejection", next_action: "do_something_unknown" },
        error: null,
      };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/unrecognized "next_action" value/);
    });

    it.each([
      "approve_deliverable",
      "resolve_version_drift",
      "already_published",
      "needs_reverification",
    ] as const)("accepts and threads through the documented next_action value %s", async (nextAction) => {
      state.rpcResponse = {
        data: { ok: false, error: "rejected", next_action: nextAction },
        error: null,
      };
      const result = await claimPlacementForPublish(baseInput);
      expect(result.ok).toBe(false);
      expect(result.nextAction).toBe(nextAction);
      expect(result.error).toBe("rejected");
    });

    it.each(["active", "released", "superseded"] as const)(
      "accepts the documented status value %s when ok:true",
      async (status) => {
        state.rpcResponse = {
          data: { ok: true, claim_id: CLAIM, idempotent_replay: false, status },
          error: null,
        };
        const result = await claimPlacementForPublish(baseInput);
        expect(result.ok).toBe(true);
        expect(result.claimId).toBe(CLAIM);
        expect(result.status).toBe(status);
      },
    );

    describe("adversarial-review follow-up (finding 3: fail-closed on every ok:true shape gap)", () => {
      it.each([
        ["a non-empty non-UUID string", "not-a-uuid"],
        ["a numeric string", "12345"],
        ["a whitespace-only string", "   "],
        ["an array", ["c1111111-1111-1111-1111-111111111111"]],
        ["an object", { id: "c1111111-1111-1111-1111-111111111111" }],
      ])("fails closed when ok:true and claim_id is %s, not a UUID", async (_label, badClaimId) => {
        state.rpcResponse = {
          data: { ok: true, claim_id: badClaimId, idempotent_replay: false, status: "active" },
          error: null,
        };
        const result = await claimPlacementForPublish(baseInput);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/"claim_id" must be a UUID string/);
      });

      it("accepts an uppercase-hex UUID for claim_id (case-insensitive)", async () => {
        state.rpcResponse = {
          data: {
            ok: true,
            claim_id: "C1111111-1111-1111-1111-111111111111",
            idempotent_replay: false,
            status: "active",
          },
          error: null,
        };
        const result = await claimPlacementForPublish(baseInput);
        expect(result.ok).toBe(true);
        expect(result.claimId).toBe("C1111111-1111-1111-1111-111111111111");
      });

      it("fails closed when ok:true and status is missing entirely", async () => {
        state.rpcResponse = {
          data: { ok: true, claim_id: CLAIM, idempotent_replay: false },
          error: null,
        };
        const result = await claimPlacementForPublish(baseInput);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/"status" is required when ok is true/);
      });

      it("fails closed when ok:true and idempotent_replay is missing entirely", async () => {
        state.rpcResponse = {
          data: { ok: true, claim_id: CLAIM, status: "active" },
          error: null,
        };
        const result = await claimPlacementForPublish(baseInput);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/"idempotent_replay" is required when ok is true/);
      });

      it("fails closed when ok:false and next_action is an unrecognized value tacked onto an otherwise-valid rejection", async () => {
        state.rpcResponse = {
          data: {
            ok: false,
            error: "rejected",
            existing_claim_id: CLAIM,
            next_action: "use_new_idempotency_keyyy",
          },
          error: null,
        };
        const result = await claimPlacementForPublish(baseInput);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/unrecognized "next_action" value/);
      });

      it("accepts and threads through the new use_new_idempotency_key next_action (finding 4)", async () => {
        state.rpcResponse = {
          data: {
            ok: false,
            error: "idempotency_key was already used for a different request",
            existing_claim_id: CLAIM,
            next_action: "use_new_idempotency_key",
          },
          error: null,
        };
        const result = await claimPlacementForPublish(baseInput);
        expect(result.ok).toBe(false);
        expect(result.nextAction).toBe("use_new_idempotency_key");
        expect(result.existingClaimId).toBe(CLAIM);
      });
    });
  });
});
