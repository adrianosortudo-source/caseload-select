import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
});

describe("POST /api/operator/logout", () => {
  it("returns to operator sign in and clears the session plus operator contexts", async () => {
    const req = new NextRequest("https://admin.caseloadselect.ca/api/operator/logout", {
      method: "POST",
    });
    const res = await POST(req);
    const cookies = res.headers.get("set-cookie") ?? "";

    expect(res.headers.get("location")).toBe("https://admin.caseloadselect.ca/operator/login");
    expect(cookies).toContain("portal_session=");
    expect(cookies).toContain("portal_preview=");
    expect(cookies).toContain("operator_workspace=");
    expect((cookies.match(/Max-Age=0/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(cookies).not.toMatch(/\bDomain=/i);
  });

  it.each([
    "https://app.caseloadselect.ca/api/operator/logout",
    "https://production-alias.vercel.app/api/operator/logout",
  ])("fails closed without clearing cookies on another production host: %s", async (url) => {
    const req = new NextRequest(url, { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
