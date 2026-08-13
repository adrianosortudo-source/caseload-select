/**
 * Tests for PATCH /api/admin/firms/[firmId]/ownership/[rowId].
 * Focus: the operator gate, the firm-scoped 404, the credential-shaped
 * key rejection (DR-111: this register never stores a password/token),
 * and status validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  operatorSession: { firm_id: string; role: "operator"; exp: number } | null;
  updateResult: Record<string, unknown> | null;
}

const state: MockState = {
  operatorSession: null,
  updateResult: { id: "row-1", firm_id: "firm-1", status: "firm_controlled" },
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/asset-ownership", () => ({
  updateOwnershipRow: vi.fn(async () => state.updateResult),
}));

import { PATCH } from "../route";
import * as assetOwnership from "@/lib/asset-ownership";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const ROW_ID = "22222222-2222-2222-2222-222222222222";

function makeReq(body: unknown): Request {
  return new Request(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership/${ROW_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function ctx() {
  return { params: Promise.resolve({ firmId: FIRM_ID, rowId: ROW_ID }) };
}

beforeEach(() => {
  state.operatorSession = null;
  state.updateResult = { id: ROW_ID, firm_id: FIRM_ID, status: "firm_controlled" };
  vi.clearAllMocks();
});

describe("PATCH /api/admin/firms/[firmId]/ownership/[rowId]", () => {
  it("returns 401 without an operator session", async () => {
    const res = await PATCH(makeReq({ status: "firm_controlled" }) as never, ctx());
    expect(res.status).toBe(401);
  });

  it("rejects a body key that looks like a credential field", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    const res = await PATCH(makeReq({ password: "hunter2" }) as never, ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("password");
    expect(assetOwnership.updateOwnershipRow).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    const res = await PATCH(makeReq({ status: "totally_fine_probably" }) as never, ctx());
    expect(res.status).toBe(400);
  });

  it("drops keys not on the allow-list without erroring", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    await PATCH(makeReq({ status: "shared_access", firm_id: "some-other-firm" }) as never, ctx());
    expect(assetOwnership.updateOwnershipRow).toHaveBeenCalledWith(
      FIRM_ID,
      ROW_ID,
      expect.not.objectContaining({ firm_id: expect.anything() }),
    );
  });

  it("returns 404 when the row does not belong to this firm", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    state.updateResult = null;
    const res = await PATCH(makeReq({ status: "firm_controlled" }) as never, ctx());
    expect(res.status).toBe(404);
  });

  it("returns 200 and the updated row on success", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    const res = await PATCH(makeReq({ status: "firm_controlled", notes: "confirmed on call" }) as never, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.row.id).toBe(ROW_ID);
    expect(assetOwnership.updateOwnershipRow).toHaveBeenCalledWith(
      FIRM_ID,
      ROW_ID,
      expect.objectContaining({ status: "firm_controlled", notes: "confirmed on call" }),
    );
  });
});
