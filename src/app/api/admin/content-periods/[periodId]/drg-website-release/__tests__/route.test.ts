import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PERIOD_ID = "period-drg-release-1";

const state: {
  operatorSession: { firm_id: string; role: "operator"; exp: number } | null;
  result: { ok: true; release: { package: { id: string } } } | { ok: false; error: string };
  builderArgs: string[];
} = {
  operatorSession: null,
  result: { ok: true, release: { package: { id: "drg-2026-w33" } } },
  builderArgs: [],
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/drg-authoritative-website-release", () => ({
  buildAuthoritativeDrgWebsiteRelease: (periodId: string) => {
    state.builderArgs.push(periodId);
    return Promise.resolve(state.result);
  },
}));

import { POST } from "../route";

function params() {
  return { params: Promise.resolve({ periodId: PERIOD_ID }) };
}

beforeEach(() => {
  state.operatorSession = null;
  state.result = { ok: true, release: { package: { id: "drg-2026-w33" } } };
  state.builderArgs = [];
});

describe("POST authoritative DRG website release", () => {
  it("is operator-only and never reaches issuance for an unauthenticated caller", async () => {
    const response = await POST(new Request("https://example.test", { method: "POST" }), params());
    expect(response.status).toBe(401);
    expect(state.builderArgs).toEqual([]);
  });

  it("does not read or use caller-supplied authority fields", async () => {
    state.operatorSession = { firm_id: "firm-1", role: "operator", exp: Date.now() + 60_000 };
    const json = vi.fn(() => {
      throw new Error("the release route must not parse caller authority");
    });
    const request = {
      json,
      body: JSON.stringify({
        releasePackage: { package_sha256: "fabricated" },
        approvalRecordId: "fabricated-approval",
        standingAuthorizationActive: true,
      }),
    } as unknown as Request;
    const response = await POST(request, params());
    expect(response.status).toBe(200);
    expect(json).not.toHaveBeenCalled();
    expect(state.builderArgs).toEqual([PERIOD_ID]);
  });

  it("fails closed when the server signer is unprovisioned", async () => {
    state.operatorSession = { firm_id: "firm-1", role: "operator", exp: Date.now() + 60_000 };
    const error = "website projection signer is unavailable: DRG release authorization signer is not provisioned";
    state.result = { ok: false, error };
    const response = await POST(new Request("https://example.test", { method: "POST" }), params());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error });
    expect(state.builderArgs).toEqual([PERIOD_ID]);
  });
});
