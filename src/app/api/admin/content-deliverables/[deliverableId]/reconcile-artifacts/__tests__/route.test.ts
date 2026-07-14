/**
 * Tests for POST /api/admin/content-deliverables/[deliverableId]/reconcile-artifacts.
 *
 * Operator-only, read-only reconciliation trigger. The auth surface (real
 * requireOperator, backed by a mocked getOperatorSession) and the
 * reconcileDeliverableArtifacts I/O call are under test; the reconciliation
 * logic itself is covered separately and is mocked here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const DELIVERABLE = "d1111111-1111-1111-1111-111111111111";

interface OperatorSession {
  firm_id: string;
  role: "operator";
  lawyer_id?: string;
  exp: number;
}

interface ReconcileResult {
  ok: true;
  results: { artifact_id: string; validator: string; result: "pass" | "fail" | "error"; details: Record<string, unknown> }[];
}
interface ReconcileError {
  ok: false;
  error: string;
}

interface State {
  operatorSession: OperatorSession | null;
  reconcileResult: ReconcileResult | ReconcileError;
  reconcileArgs: { deliverableId: string; operatorId: string | null } | null;
}

const state: State = {
  operatorSession: null,
  reconcileResult: { ok: true, results: [] },
  reconcileArgs: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/publication-reconciliation", () => ({
  reconcileDeliverableArtifacts: (deliverableId: string, operatorId: string | null) => {
    state.reconcileArgs = { deliverableId, operatorId };
    return Promise.resolve(state.reconcileResult);
  },
}));

import { POST } from "../route";

function makeReq(): Request {
  return {} as never;
}

function params(deliverableId: string) {
  return { params: Promise.resolve({ deliverableId }) } as never;
}

beforeEach(() => {
  state.operatorSession = null;
  state.reconcileResult = { ok: true, results: [] };
  state.reconcileArgs = null;
});

describe("POST reconcile-artifacts: auth gate", () => {
  it("401 when there is no operator session; reconcileDeliverableArtifacts is never called", async () => {
    const res = await POST(makeReq(), params(DELIVERABLE));
    expect(res.status).toBe(401);
    expect(state.reconcileArgs).toBeNull();
  });
});

describe("POST reconcile-artifacts: happy path", () => {
  it("200 with a valid operator session: calls reconcileDeliverableArtifacts with deliverableId + the operator's id, returns {ok:true, results}", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    const results = [
      { artifact_id: "a1", validator: "storage_object_check", result: "pass" as const, details: {} },
    ];
    state.reconcileResult = { ok: true, results };
    const res = await POST(makeReq(), params(DELIVERABLE));
    expect(res.status).toBe(200);
    expect(state.reconcileArgs).toEqual({ deliverableId: DELIVERABLE, operatorId: "op-1" });
    const body = await res.json();
    expect(body).toEqual({ ok: true, results });
  });

  it("passes null as the operator id when the session has no lawyer_id", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", exp: Date.now() + 1000 };
    const res = await POST(makeReq(), params(DELIVERABLE));
    expect(res.status).toBe(200);
    expect(state.reconcileArgs).toEqual({ deliverableId: DELIVERABLE, operatorId: null });
  });
});

describe("POST reconcile-artifacts: failure mapping", () => {
  it("500 when reconcileDeliverableArtifacts reports an error", async () => {
    state.operatorSession = { firm_id: "f1", role: "operator", lawyer_id: "op-1", exp: Date.now() + 1000 };
    state.reconcileResult = { ok: false, error: "connection reset" };
    const res = await POST(makeReq(), params(DELIVERABLE));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "connection reset" });
  });
});
