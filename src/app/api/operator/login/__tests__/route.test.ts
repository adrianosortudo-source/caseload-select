import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  payload: null as null | {
    firm_id: string;
    role: "operator" | "lawyer" | "client";
    lawyer_id?: string;
    exp: number;
  },
  member: null as { id: string } | null,
  dbError: null as { message: string } | null,
  filters: [] as Array<[string, unknown]>,
}));

const mocks = vi.hoisted(() => ({
  createSessionCookie: vi.fn(() => ({
    name: "portal_session",
    value: "signed-session",
    options: { httpOnly: true, path: "/", maxAge: 2592000 },
  })),
}));

vi.mock("@/lib/portal-auth", () => ({
  verifyPortalToken: () => state.payload,
  createSessionCookie: mocks.createSessionCookie,
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      const builder = {
        eq: (column: string, value: unknown) => {
          state.filters.push([column, value]);
          return builder;
        },
        select: () => builder,
        maybeSingle: () => Promise.resolve({ data: state.member, error: state.dbError }),
      };
      return { update: () => builder };
    },
  },
}));

import { GET } from "../route";

function req(query = "?token=signed-token"): NextRequest {
  return new NextRequest(`https://app.caseloadselect.ca/api/operator/login${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.payload = null;
  state.member = null;
  state.dbError = null;
  state.filters = [];
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
    state.member = { id: "operator-1" };

    const res = await GET(req());

    expect(state.filters).toEqual([
      ["id", "operator-1"],
      ["firm_id", "firm-1"],
      ["role", "operator"],
      ["disabled", false],
    ]);
    expect(mocks.createSessionCookie).toHaveBeenCalledWith("firm-1", {
      role: "operator",
      lawyer_id: "operator-1",
    });
    expect(res.headers.get("location")).toBe("https://app.caseloadselect.ca/admin");
    expect(res.headers.get("set-cookie")).toContain("portal_session=signed-session");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=2592000");
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
    state.member = null;

    const res = await GET(req());

    expect(res.headers.get("location")).toContain("/operator/login?error=invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
    },
  );

  it("fails closed on membership lookup errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    state.payload = {
      firm_id: "firm-1",
      role: "operator",
      lawyer_id: "operator-1",
      exp: Date.now() + 1_000,
    };
    state.dbError = { message: "database unavailable" };

    const res = await GET(req());

    expect(res.headers.get("location")).toContain("/operator/login?error=invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("membership revalidation failed"),
    );
    consoleError.mockRestore();
  });
});
