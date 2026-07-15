/**
 * GET .../publication-preflight (Workstream 7): the HTTP boundary in front
 * of loadPublicationPreflightForPeriod. Operator-only, 404s when the period
 * does not resolve for this firm, otherwise passes the report straight
 * through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

const state = {
  isOperator: true,
  report: { periodId: PERIOD, periodLifecycle: "enforced", placements: [] } as unknown,
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () =>
    Promise.resolve(state.isOperator ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
}));

vi.mock("@/lib/publication-preflight-loader", () => ({
  loadPublicationPreflightForPeriod: () => Promise.resolve(state.report),
}));

import { GET } from "../route";

function params() {
  return { params: Promise.resolve({ firmId: FIRM, periodId: PERIOD }) } as never;
}

beforeEach(() => {
  state.isOperator = true;
  state.report = { periodId: PERIOD, periodLifecycle: "enforced", placements: [] };
});

describe("GET publication-preflight", () => {
  it("rejects a non-operator session", async () => {
    state.isOperator = false;
    const res = await GET({} as never, params());
    expect(res.status).toBe(403);
  });

  it("404s when the period does not resolve for this firm", async () => {
    state.report = null;
    const res = await GET({} as never, params());
    expect(res.status).toBe(404);
  });

  it("returns the report for an operator", async () => {
    const res = await GET({} as never, params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.periodId).toBe(PERIOD);
  });
});
