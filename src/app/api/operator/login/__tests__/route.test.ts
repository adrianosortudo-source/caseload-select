import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  payload: null as null | {
    firm_id: string;
    role: "operator" | "lawyer" | "client";
    lawyer_id?: string;
    exp: number;
  },
}));

const mocks = vi.hoisted(() => ({
  createSessionCookie: vi.fn(() => ({
    name: "portal_session",
    value: "signed-session",
    options: { httpOnly: true, path: "/", maxAge: 2592000 },
  })),
  revalidateOperatorMembership: vi.fn(),
}));

vi.mock("@/lib/portal-auth", () => ({
  verifyPortalToken: () => state.payload,
  createSessionCookie: mocks.createSessionCookie,
  revalidateOperatorMembership: mocks.revalidateOperatorMembership,
}));

import { GET } from "../route";

function req(query = "?token=signed-token"): NextRequest {
  return new NextRequest(`https://admin.caseloadselect.ca/api/operator/login${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  state.payload = null;
  mocks.revalidateOperatorMembership.mockResolvedValue(null);
});

describe("GET /api/operator/login", () => {
  it.each([
    ["missing token", "", null],
    ["invalid token", "?token=bad", null],
    ["lawyer token", "?token=lawyer", { firm_id: "firm-1", role: "lawyer", lawyer_id: "lawyer-1", exp: Date.now() + 1_000 }],
    ["client token", "?token=client", { firm_id: "firm-1", role: "client", exp: Date.now() + 1_000 }],
    ["operator token without member id", "?token=operator", { firm_id: "firm-1", role: "operator", exp: Date.now() + 1_000 }],
  ])("rejects %s", async (_label, query, payload) => {
    state.payload = payload as typeof state.payload;
    const res = await GET(req(query));
    expect(res.headers.get("location")).toContain(
      query ? "/operator/login?error=invalid" : "/operator/login?error=missing",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("revalidates exact active operator membership before setting the 30-day session", async () => {
    state.payload = {
      firm_id: "firm-1",
      role: "operator",
      lawyer_id: "operator-1",
      exp: Date.now() + 1_000,
    };
    mocks.revalidateOperatorMembership.mockResolvedValue({ id: "operator-1" });

    const res = await GET(req());

    expect(mocks.revalidateOperatorMembership).toHaveBeenCalledWith(state.payload, {
      recordSignIn: true,
    });
    expect(mocks.createSessionCookie).toHaveBeenCalledWith("firm-1", {
      role: "operator",
      lawyer_id: "operator-1",
    });
    expect(res.headers.get("location")).toBe("https://admin.caseloadselect.ca/admin");
    expect(res.headers.get("set-cookie")).toContain("portal_session=signed-session");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=2592000");
    expect(res.headers.get("set-cookie")).not.toMatch(/\bDomain=/i);
  });

  it("canonicalizes a wrong-host callback before consuming the token", async () => {
    const wrongHost = new NextRequest(
      "https://app.caseloadselect.ca/api/operator/login?token=operator-token&next=%2Fadmin%2Ftriage",
    );
    const res = await GET(wrongHost);
    expect(res.headers.get("location")).toBe(
      "https://admin.caseloadselect.ca/api/operator/login?token=operator-token&next=%2Fadmin%2Ftriage",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mocks.revalidateOperatorMembership).not.toHaveBeenCalled();
  });

  it.each(["disabled", "removed", "wrong role", "wrong firm"])(
    "rejects a signed operator token when membership is %s",
    async () => {
      state.payload = {
        firm_id: "firm-1",
        role: "operator",
        lawyer_id: "operator-1",
        exp: Date.now() + 1_000,
      };
      const res = await GET(req());

      expect(res.headers.get("location")).toContain("/operator/login?error=invalid");
      expect(res.headers.get("set-cookie")).toBeNull();
    },
  );

  it("fails closed when centralized membership revalidation rejects the identity", async () => {
    state.payload = {
      firm_id: "firm-1",
      role: "operator",
      lawyer_id: "operator-1",
      exp: Date.now() + 1_000,
    };
    mocks.revalidateOperatorMembership.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.headers.get("location")).toContain("/operator/login?error=invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
