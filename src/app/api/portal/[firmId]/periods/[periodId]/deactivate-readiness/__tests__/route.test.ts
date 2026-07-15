/**
 * Tests for POST .../periods/[periodId]/deactivate-readiness (DR-099).
 * The HTTP boundary in front of deactivatePeriodReadiness: auth gate,
 * request-body validation, and status-code mapping. The database trigger
 * plus the deactivate_period_readiness_atomic RPC are the authoritative
 * enforcement, exercised separately by
 * scripts/verify-content-periods-enforced-monotonic.sql; this test covers
 * only the route layer, mocking deactivatePeriodReadiness itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

const state = {
  actor: null as Actor,
  deactivateResult: { ok: true, auditId: "audit-1", createdAt: "2026-07-15T20:00:00Z" } as
    | { ok: true; auditId: string; createdAt: string }
    | { ok: false; error: string },
  deactivateArgs: null as unknown,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  deactivatePeriodReadiness: (args: unknown) => {
    state.deactivateArgs = args;
    return Promise.resolve(state.deactivateResult);
  },
}));

import { POST } from "../route";

const LAWYER: Actor = { role: "lawyer", id: "law1", name: "Damaris", email: "damaris@firm.ca" };
const OPERATOR: Actor = { role: "operator", id: null, name: "Operator", email: null };

function makeReq(body?: unknown): NextRequest {
  return { json: async () => body ?? {} } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ firmId: FIRM, periodId: PERIOD }) } as never;
}

beforeEach(() => {
  state.actor = null;
  state.deactivateResult = { ok: true, auditId: "audit-1", createdAt: "2026-07-15T20:00:00Z" };
  state.deactivateArgs = null;
});

describe("POST deactivate-readiness: auth gate", () => {
  it("401 when there is no session; deactivatePeriodReadiness is never called", async () => {
    const res = await POST(makeReq({ toLifecycle: "setup_required", reason: "test" }), params());
    expect(res.status).toBe(401);
    expect(state.deactivateArgs).toBeNull();
  });

  it("403 for a lawyer session; deactivation is operator-only", async () => {
    state.actor = LAWYER;
    const res = await POST(makeReq({ toLifecycle: "setup_required", reason: "test" }), params());
    expect(res.status).toBe(403);
    expect(state.deactivateArgs).toBeNull();
  });
});

describe("POST deactivate-readiness: request validation", () => {
  it("400 when toLifecycle is missing or invalid", async () => {
    state.actor = OPERATOR;
    const res = await POST(makeReq({ toLifecycle: "enforced", reason: "test" }), params());
    expect(res.status).toBe(400);
    expect(state.deactivateArgs).toBeNull();
  });

  it("400 when reason is missing", async () => {
    state.actor = OPERATOR;
    const res = await POST(makeReq({ toLifecycle: "setup_required" }), params());
    expect(res.status).toBe(400);
    expect(state.deactivateArgs).toBeNull();
  });

  it("400 when reason is only whitespace", async () => {
    state.actor = OPERATOR;
    const res = await POST(makeReq({ toLifecycle: "setup_required", reason: "   " }), params());
    expect(res.status).toBe(400);
    expect(state.deactivateArgs).toBeNull();
  });

  it("400 on invalid JSON body", async () => {
    state.actor = OPERATOR;
    const badReq = { json: async () => { throw new Error("bad json"); } } as unknown as NextRequest;
    const res = await POST(badReq, params());
    expect(res.status).toBe(400);
  });
});

describe("POST deactivate-readiness: happy path", () => {
  it("200 for an operator with a valid reason; passes the exact actor and args through", async () => {
    state.actor = OPERATOR;
    const res = await POST(
      makeReq({ toLifecycle: "legacy_unreconciled", reason: "misclassified during backfill" }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, auditId: "audit-1", createdAt: "2026-07-15T20:00:00Z" });
    expect(state.deactivateArgs).toEqual({
      periodId: PERIOD,
      firmId: FIRM,
      toLifecycle: "legacy_unreconciled",
      reason: "misclassified during backfill",
      actor: { role: "operator", id: null, name: "Operator" },
    });
  });
});

describe("POST deactivate-readiness: RPC-reported refusal", () => {
  it("409 when the RPC reports the period is not currently enforced", async () => {
    state.actor = OPERATOR;
    state.deactivateResult = { ok: false, error: "period is setup_required, not enforced; nothing to deactivate" };
    const res = await POST(makeReq({ toLifecycle: "setup_required", reason: "test" }), params());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("not enforced");
  });
});
