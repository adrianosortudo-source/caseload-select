/**
 * Tests for GET/POST /api/admin/firms/[firmId]/ownership.
 * Focus: the operator gate, firm-existence check, and that the response
 * shape (register + derived transfer_list) matches what the pure layer
 * would produce. IO (@/lib/asset-ownership) and the firm-existence lookup
 * (@/lib/supabase-admin) are both mocked; the real route + pure logic run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  operatorSession: { firm_id: string; role: "operator"; exp: number } | null;
  firmExists: boolean;
  register: Array<Record<string, unknown>>;
}

const state: MockState = {
  operatorSession: null,
  firmExists: true,
  register: [],
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: state.firmExists ? { id: FIRM_ID } : null,
            error: null,
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/asset-ownership", () => ({
  getOwnershipRegister: vi.fn(async () => state.register),
  seedOwnershipRegister: vi.fn(async () => state.register),
}));

import { GET, POST } from "../route";
import * as assetOwnership from "@/lib/asset-ownership";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";

function makeReq(url: string, init?: { method?: string; body?: unknown }): Request {
  const req = new Request(url, {
    method: init?.method ?? "GET",
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
  }) as Request & { nextUrl: URL };
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return req;
}

function ctx(firmId = FIRM_ID) {
  return { params: Promise.resolve({ firmId }) };
}

beforeEach(() => {
  state.operatorSession = null;
  state.firmExists = true;
  state.register = [];
  vi.clearAllMocks();
});

describe("GET /api/admin/firms/[firmId]/ownership", () => {
  it("returns 401 without an operator session", async () => {
    const res = await GET(makeReq(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership`) as never, ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the firm does not exist", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    state.firmExists = false;
    const res = await GET(makeReq(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership`) as never, ctx());
    expect(res.status).toBe(404);
  });

  it("defaults to the onboarding phase and reports seeded=false on an empty register", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    state.register = [];
    const res = await GET(makeReq(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership`) as never, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phase).toBe("onboarding");
    expect(body.seeded).toBe(false);
    expect(body.register).toEqual([]);
    expect(body.transfer_list).toEqual([]);
    expect(assetOwnership.getOwnershipRegister).toHaveBeenCalledWith(FIRM_ID, "onboarding");
  });

  it("passes through an explicit offboarding phase", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    const res = await GET(
      makeReq(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership?phase=offboarding`) as never,
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(assetOwnership.getOwnershipRegister).toHaveBeenCalledWith(FIRM_ID, "offboarding");
  });

  it("derives the transfer list from a non-empty register", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    state.register = [
      { id: "a", status: "firm_controlled", action_done: false },
      { id: "b", status: "provider_controlled", action_done: false },
    ];
    const res = await GET(makeReq(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership`) as never, ctx());
    const body = await res.json();
    expect(body.seeded).toBe(true);
    expect(body.transfer_list).toHaveLength(1);
    expect(body.transfer_list[0].id).toBe("b");
  });
});

describe("POST /api/admin/firms/[firmId]/ownership", () => {
  it("returns 401 without an operator session", async () => {
    const res = await POST(
      makeReq(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership`, { method: "POST" }) as never,
      ctx(),
    );
    expect(res.status).toBe(401);
  });

  it("seeds the register and returns it", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    state.register = [{ id: "a", status: "unknown", action_done: false }];
    const res = await POST(
      makeReq(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership`, { method: "POST", body: {} }) as never,
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(assetOwnership.seedOwnershipRegister).toHaveBeenCalledWith(FIRM_ID, "onboarding");
    const body = await res.json();
    expect(body.register).toHaveLength(1);
  });

  it("accepts an explicit phase in the body", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    await POST(
      makeReq(`https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/ownership`, {
        method: "POST",
        body: { phase: "offboarding" },
      }) as never,
      ctx(),
    );
    expect(assetOwnership.seedOwnershipRegister).toHaveBeenCalledWith(FIRM_ID, "offboarding");
  });
});
