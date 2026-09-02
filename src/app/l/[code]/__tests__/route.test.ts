import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state: {
  target: { firmId: string; lawyerId: string | null; role: "lawyer" | "operator" } | null;
} = { target: null };

vi.mock("@/lib/portal-signin-codes", () => ({
  resolveSigninCode: () => Promise.resolve(state.target),
}));

vi.mock("@/lib/portal-auth", () => ({
  generatePortalToken: () => "token.sig",
}));

import { GET } from "../route";

const context = { params: Promise.resolve({ code: "short-code" }) };

beforeEach(() => {
  state.target = null;
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  vi.stubEnv("VERCEL_ENV", "production");
});

describe("short-link canonical origin", () => {
  it("redeems an operator code through the admin login consumer", async () => {
    state.target = { firmId: "firm-1", lawyerId: "operator-1", role: "operator" };
    const response = await GET(
      new NextRequest("https://app.caseloadselect.ca/l/short-code"),
      context,
    );

    expect(response.headers.get("location")).toBe(
      "https://admin.caseloadselect.ca/api/operator/login?token=token.sig",
    );
  });

  it("redeems a lawyer code through the app login consumer", async () => {
    state.target = { firmId: "firm-1", lawyerId: "lawyer-1", role: "lawyer" };
    const response = await GET(
      new NextRequest("https://admin.caseloadselect.ca/l/short-code"),
      context,
    );

    expect(response.headers.get("location")).toBe(
      "https://app.caseloadselect.ca/api/portal/login?token=token.sig",
    );
  });

  it("sends invalid codes to the login surface for the request host", async () => {
    const operatorResponse = await GET(
      new NextRequest("https://admin.caseloadselect.ca/l/bad-code"),
      context,
    );
    const lawyerResponse = await GET(
      new NextRequest("https://app.caseloadselect.ca/l/bad-code"),
      context,
    );

    expect(operatorResponse.headers.get("location")).toBe(
      "https://admin.caseloadselect.ca/operator/login?error=expired",
    );
    expect(lawyerResponse.headers.get("location")).toBe(
      "https://app.caseloadselect.ca/portal/login?error=expired",
    );
  });
});
