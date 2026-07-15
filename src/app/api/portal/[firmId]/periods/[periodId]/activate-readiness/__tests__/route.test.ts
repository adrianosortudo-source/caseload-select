/**
 * Tests for POST /api/portal/[firmId]/periods/[periodId]/activate-readiness
 * (DR-097 / DR-098). This is the route that flips a period's
 * readiness_lifecycle to "enforced" -- the boundary that turns off the
 * "Historical, not reconciled" / "Setup required" display and lets a
 * genuinely failing deliverable start reading "Blocked". The guards under
 * test:
 *   - unauthenticated                                          401
 *   - lawyer session (activation is operator-only)              403
 *   - operator, preflight passes                                200
 *   - operator, period already enforced (idempotent no-op)      200
 *   - operator, preflight refuses (incomplete metadata)         409, itemized
 *   - operator, period not found for this firm (no blocking ids) 400
 *
 * The DB-level trigger (trg_validate_readiness_activation) is the
 * authoritative, atomic enforcement and is exercised by the migration
 * itself, not by this route test; this test covers the HTTP boundary
 * (auth gate + status-code mapping) that sits in front of
 * activatePeriodReadiness, which is mocked here as the pre-existing
 * approve-route test pattern does for its own data-access layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

interface ActivateResult {
  ok: boolean;
  period?: { id: string; readiness_lifecycle: string };
  error?: string;
  blockingDeliverableIds?: string[];
}

interface State {
  actor: Actor;
  activateResult: ActivateResult;
  activateArgs: { periodId: string; firmId: string } | null;
}

const state: State = {
  actor: null,
  activateResult: { ok: true, period: { id: PERIOD, readiness_lifecycle: "enforced" } },
  activateArgs: null,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  activatePeriodReadiness: (args: { periodId: string; firmId: string }) => {
    state.activateArgs = args;
    return Promise.resolve(state.activateResult);
  },
}));

import { POST } from "../route";

const LAWYER: Actor = { role: "lawyer", id: "law1", name: "Damaris", email: "damaris@firm.ca" };
const OPERATOR: Actor = { role: "operator", id: null, name: "Operator", email: null };

function makeReq(): NextRequest {
  return {} as never;
}

function params(firmId: string, periodId: string) {
  return { params: Promise.resolve({ firmId, periodId }) } as never;
}

beforeEach(() => {
  state.actor = null;
  state.activateResult = { ok: true, period: { id: PERIOD, readiness_lifecycle: "enforced" } };
  state.activateArgs = null;
});

describe("POST activate-readiness: auth gate", () => {
  it("401 when there is no session; activatePeriodReadiness is never called", async () => {
    const res = await POST(makeReq(), params(FIRM, PERIOD));
    expect(res.status).toBe(401);
    expect(state.activateArgs).toBeNull();
  });

  it("403 for a lawyer session; activation is operator-only", async () => {
    state.actor = LAWYER;
    const res = await POST(makeReq(), params(FIRM, PERIOD));
    expect(res.status).toBe(403);
    expect(state.activateArgs).toBeNull();
  });
});

describe("POST activate-readiness: happy path", () => {
  it("200 for an operator when the preflight passes; passes firmId + periodId through", async () => {
    state.actor = OPERATOR;
    const res = await POST(makeReq(), params(FIRM, PERIOD));
    expect(res.status).toBe(200);
    expect(state.activateArgs).toEqual({ periodId: PERIOD, firmId: FIRM });
    const body = await res.json();
    expect(body).toEqual({ ok: true, period: { id: PERIOD, readiness_lifecycle: "enforced" } });
  });

  it("200 (idempotent no-op) when the period is already enforced; activatePeriodReadiness owns that check, the route just passes the result through", async () => {
    state.actor = OPERATOR;
    state.activateResult = { ok: true, period: { id: PERIOD, readiness_lifecycle: "enforced" } };
    const res = await POST(makeReq(), params(FIRM, PERIOD));
    expect(res.status).toBe(200);
  });
});

describe("POST activate-readiness: preflight refusal", () => {
  it("409 with the itemized blocking deliverable ids when metadata is incomplete", async () => {
    state.actor = OPERATOR;
    const blockingIds = ["22dde96c-9400-403c-8314-1402bcaaab23", "ba1f4aeb-54ef-442a-8d8c-e5ae99a54bb9"];
    state.activateResult = {
      ok: false,
      error: "2 active deliverables still missing role, locale, destination, or placement",
      blockingDeliverableIds: blockingIds,
    };
    const res = await POST(makeReq(), params(FIRM, PERIOD));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.blockingDeliverableIds).toEqual(blockingIds);
    expect(body.error).toContain("still missing role, locale, destination, or placement");
  });

  it("does not mark the period enforced when the preflight refuses (mocked activatePeriodReadiness never returns ok:true for this input)", async () => {
    state.actor = OPERATOR;
    state.activateResult = {
      ok: false,
      error: "1 active deliverable still missing role, locale, destination, or placement",
      blockingDeliverableIds: ["e3fb60fe-08c5-45ee-854b-889beaaa9136"],
    };
    const res = await POST(makeReq(), params(FIRM, PERIOD));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.ok).toBeUndefined();
    expect(body.period).toBeUndefined();
  });
});

describe("POST activate-readiness: other failures", () => {
  it("400 when the period is not found for this firm (no blocking ids to report)", async () => {
    state.actor = OPERATOR;
    state.activateResult = { ok: false, error: "period not found for this firm" };
    const res = await POST(makeReq(), params(FIRM, PERIOD));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("period not found for this firm");
  });
});
