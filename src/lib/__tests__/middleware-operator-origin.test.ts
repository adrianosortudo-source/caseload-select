import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
});

afterEach(() => vi.unstubAllEnvs());

function request(url: string, method = "GET"): NextRequest {
  return new NextRequest(url, { method });
}

describe("operator origin middleware policy", () => {
  it("moves operator UI navigation from the app host and preserves the query", async () => {
    const res = await middleware(request("https://app.caseloadselect.ca/admin/triage?firm=firm-1"));
    expect(res.headers.get("location")).toBe(
      "https://admin.caseloadselect.ca/admin/triage?firm=firm-1",
    );
  });

  it("moves legacy operator pages to the admin host", async () => {
    const res = await middleware(request("https://app.caseloadselect.ca/pipeline?band=A"));
    expect(res.headers.get("location")).toBe("https://admin.caseloadselect.ca/pipeline?band=A");
  });

  it("lands the admin origin root on the console", async () => {
    const res = await middleware(request("https://admin.caseloadselect.ca/?firm=firm-1"));
    expect(res.headers.get("location")).toBe("https://admin.caseloadselect.ca/admin?firm=firm-1");
  });

  it("returns lawyer sign in to the app origin", async () => {
    const res = await middleware(request("https://admin.caseloadselect.ca/portal/login?error=invalid"));
    expect(res.headers.get("location")).toBe(
      "https://app.caseloadselect.ca/portal/login?error=invalid",
    );
  });

  it("allows operator portal previews and marks them noindex", async () => {
    const res = await middleware(request("https://admin.caseloadselect.ca/portal/firm-1/files"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  });

  it("does not redirect cookie-writing API posts across origins", async () => {
    const res = await middleware(request("https://app.caseloadselect.ca/api/operator/logout", "POST"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("preserves single-origin Vercel preview behavior", async () => {
    const res = await middleware(request("https://operator-origin-git-example.vercel.app/admin"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
