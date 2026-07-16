/**
 * DR-099: pins deactivatePeriodReadiness's contract with the
 * deactivate_period_readiness_atomic RPC (20260715210116_content_periods_
 * enforced_monotonic.sql, confirmed applied to production 2026-07-16 via
 * the Supabase migration ledger -- this test exercises only the TypeScript
 * call boundary, mocking the RPC response; the actual Postgres
 * trigger/function logic is covered separately by
 * scripts/verify-content-periods-enforced-monotonic.sql, run by hand
 * against a development branch or staging).
 *
 * The contract:
 *   - calls supabase.rpc('deactivate_period_readiness_atomic', { ...params })
 *     with the exact p_-prefixed argument names the SQL function expects
 *   - returns { ok: true, auditId, createdAt } on RPC success
 *   - returns { ok: false, error } when the RPC reports a Postgres/network
 *     error (rpcErr set)
 *   - returns { ok: false, error } when the RPC responds but reports
 *     ok:false (a refused actor_role, empty reason, or non-enforced period)
 *   - never throws; every failure path resolves to { ok: false, error }
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

interface State {
  rpcCalls: Array<{ name: string; params: unknown }>;
  rpcResult: { data: unknown; error: { message: string } | null };
}

const state: State = {
  rpcCalls: [],
  rpcResult: { data: { ok: true, audit_id: "audit-1", created_at: "2026-07-15T20:00:00Z" }, error: null },
};

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    rpc: (name: string, params: unknown) => {
      state.rpcCalls.push({ name, params });
      return Promise.resolve(state.rpcResult);
    },
  },
}));

import { deactivatePeriodReadiness } from "@/lib/deliverables";

const baseInput = {
  periodId: "950bad0b-fef6-4c5a-b949-fef5d9cbee90",
  firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
  toLifecycle: "legacy_unreconciled" as const,
  reason: "misclassified during backfill, correcting after operator review",
  actor: { role: "operator" as const, id: "op-1", name: "Operator" },
};

beforeEach(() => {
  state.rpcCalls = [];
  state.rpcResult = { data: { ok: true, audit_id: "audit-1", created_at: "2026-07-15T20:00:00Z" }, error: null };
});

describe("deactivatePeriodReadiness: RPC call shape", () => {
  it("calls deactivate_period_readiness_atomic with the exact p_-prefixed params", async () => {
    await deactivatePeriodReadiness(baseInput);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]).toEqual({
      name: "deactivate_period_readiness_atomic",
      params: {
        p_period_id: baseInput.periodId,
        p_firm_id: baseInput.firmId,
        p_to_lifecycle: "legacy_unreconciled",
        p_reason: baseInput.reason,
        p_actor_role: "operator",
        p_actor_id: "op-1",
        p_actor_name: "Operator",
      },
    });
  });
});

describe("deactivatePeriodReadiness: success path", () => {
  it("returns ok:true with auditId + createdAt on RPC success", async () => {
    const result = await deactivatePeriodReadiness(baseInput);
    expect(result).toEqual({ ok: true, auditId: "audit-1", createdAt: "2026-07-15T20:00:00Z" });
  });
});

describe("deactivatePeriodReadiness: failure mapping", () => {
  it("maps a transport/Postgres error (rpcErr set) to ok:false", async () => {
    state.rpcResult = { data: null, error: { message: "connection reset" } };
    const result = await deactivatePeriodReadiness(baseInput);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("connection reset");
  });

  it("maps an RPC-reported refusal (non-operator actor) to ok:false without throwing", async () => {
    state.rpcResult = { data: { ok: false, error: "only an operator may deactivate readiness enforcement" }, error: null };
    const result = await deactivatePeriodReadiness(baseInput);
    expect(result).toEqual({ ok: false, error: "only an operator may deactivate readiness enforcement" });
  });

  it("maps an RPC-reported refusal (empty reason) to ok:false", async () => {
    state.rpcResult = { data: { ok: false, error: "a reason is required to deactivate enforcement" }, error: null };
    const result = await deactivatePeriodReadiness(baseInput);
    expect(result).toEqual({ ok: false, error: "a reason is required to deactivate enforcement" });
  });

  it("maps an RPC-reported refusal (period not currently enforced) to ok:false", async () => {
    state.rpcResult = { data: { ok: false, error: "period is setup_required, not enforced; nothing to deactivate" }, error: null };
    const result = await deactivatePeriodReadiness(baseInput);
    expect(result).toEqual({ ok: false, error: "period is setup_required, not enforced; nothing to deactivate" });
  });

  it("falls back to a generic error message when the RPC returns ok:false with no error string", async () => {
    state.rpcResult = { data: { ok: false }, error: null };
    const result = await deactivatePeriodReadiness(baseInput);
    expect(result).toEqual({ ok: false, error: "deactivation failed" });
  });
});
