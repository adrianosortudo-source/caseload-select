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
    value: "firm-session",
    options: { httpOnly: true, path: "/" },
  })),
}));

vi.mock("@/lib/portal-auth", () => ({
  verifyPortalToken: () => state.payload,
  createSessionCookie: mocks.createSessionCookie,
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      const builder = { eq: () => builder };
      return { update: () => builder };
    },
  },
}));

import { GET } from "../route";

function req(token = "signed-token"): NextRequest {
  return new NextRequest(`https://app.caseloadselect.ca/api/portal/login?token=${token}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.payload = null;
});

describe("GET /api/portal/login role separation", () => {
  it("bridges an old unexpired operator link to the dedicated consumer", async () => {
    state.payload = {
      firm_id: "firm-1",
      role: "operator",
      lawyer_id: "operator-1",
      exp: Date.now() + 1_000,
    };

    const res = await GET(req("old-operator-token"));

    expect(res.headers.get("location")).toBe(
      "https://app.caseloadselect.ca/api/operator/login?token=old-operator-token",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it("continues to consume firm-scoped lawyer links", async () => {
    state.payload = {
      firm_id: "firm-1",
      role: "lawyer",
      lawyer_id: "lawyer-1",
      exp: Date.now() + 1_000,
    };

    const res = await GET(req());

    expect(res.headers.get("location")).toBe(
      "https://app.caseloadselect.ca/portal/firm-1/triage",
    );
    expect(res.headers.get("set-cookie")).toContain("portal_session=firm-session");
    expect(mocks.createSessionCookie).toHaveBeenCalledWith("firm-1", {
      role: "lawyer",
      lawyer_id: "lawyer-1",
    });
  });
});
