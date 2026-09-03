import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
});

describe("POST /api/portal/logout origin policy", () => {
  it("clears the lawyer session on the app host", async () => {
    const req = new NextRequest("https://app.caseloadselect.ca/api/portal/logout", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.headers.get("location")).toBe("https://app.caseloadselect.ca/portal/login");
    expect(res.headers.get("set-cookie")).toContain("portal_session=");
    expect(res.headers.get("set-cookie")).not.toMatch(/\bDomain=/i);
  });

  it("does not clear the operator-origin session through the lawyer logout route", async () => {
    const req = new NextRequest("https://admin.caseloadselect.ca/api/portal/logout", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
