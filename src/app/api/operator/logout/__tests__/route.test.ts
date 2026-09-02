import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

describe("POST /api/operator/logout", () => {
  it("returns to operator sign in and clears the session plus operator contexts", async () => {
    const req = new NextRequest("https://app.caseloadselect.ca/api/operator/logout", {
      method: "POST",
    });
    const res = await POST(req);
    const cookies = res.headers.get("set-cookie") ?? "";

    expect(res.headers.get("location")).toBe("https://app.caseloadselect.ca/operator/login");
    expect(cookies).toContain("portal_session=");
    expect(cookies).toContain("portal_preview=");
    expect(cookies).toContain("operator_workspace=");
    expect((cookies.match(/Max-Age=0/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
