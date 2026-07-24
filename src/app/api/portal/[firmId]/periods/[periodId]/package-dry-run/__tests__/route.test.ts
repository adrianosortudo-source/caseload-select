import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

const state = {
  isOperator: true,
  loadResult: { manifest: { pieces: [] }, assets: [] } as unknown,
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () =>
    Promise.resolve(state.isOperator ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
}));

vi.mock("@/lib/publishing-package-control-room-loader", () => ({
  loadControlRoomPackage: () => Promise.resolve(state.loadResult),
}));

vi.mock("@/lib/publishing-package-gateway-export", () => ({
  buildGatewayExportManifest: () => ({ raw: { operations: [] } }),
  runAssetBindingDryRun: () => ({ ok: true, operations: [], errors: [] }),
}));

import { POST } from "../route";

function params() {
  return { params: Promise.resolve({ firmId: FIRM, periodId: PERIOD }) } as never;
}

beforeEach(() => {
  state.isOperator = true;
  state.loadResult = { manifest: { pieces: [] }, assets: [] };
});

describe("POST package-dry-run", () => {
  it("rejects a non-operator session", async () => {
    state.isOperator = false;
    const res = await POST({} as never, params());
    expect(res.status).toBe(403);
  });

  it("an Authorization: Bearer header does not bypass a denied operator session", async () => {
    state.isOperator = false;
    const withBearer = { headers: { get: () => "Bearer x" } } as never;
    const res = await POST(withBearer, params());
    expect(res.status).toBe(403);
  });

  it("404s when no package resolves for this period", async () => {
    state.loadResult = null;
    const res = await POST({} as never, params());
    expect(res.status).toBe(404);
  });

  it("returns the dry-run result shape for an operator", async () => {
    const res = await POST({} as never, params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.operations).toEqual([]);
  });
});
