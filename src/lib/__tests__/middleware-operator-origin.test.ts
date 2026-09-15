import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
});

afterEach(() => vi.unstubAllEnvs());

function request(url: string, method = "GET", headers?: HeadersInit): NextRequest {
  return new NextRequest(url, { method, headers });
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

  it("moves standalone prospect demonstrations to the admin host", async () => {
    const res = await middleware(request("https://app.caseloadselect.ca/demo/prospect/walker-law?view=split"));
    expect(res.headers.get("location")).toBe(
      "https://admin.caseloadselect.ca/demo/prospect/walker-law?view=split",
    );
  });

  it("serves standalone prospect demonstrations on the admin host", async () => {
    const res = await middleware(request("https://admin.caseloadselect.ca/demo/prospect/walker-law"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
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
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await middleware(request("https://operator-origin-git-example.vercel.app/admin"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not let a production Vercel alias bypass the canonical operator origin", async () => {
    const res = await middleware(request("https://production-alias.vercel.app/admin/triage?firm=firm-1"));
    expect(res.headers.get("location")).toBe(
      "https://admin.caseloadselect.ca/admin/triage?firm=firm-1",
    );
  });
});

describe("preview QA middleware capability boundary", () => {
  const previewHost = "preview-qa-git-example.vercel.app";
  const qaCookie = "preview_qa_session=read-only-qa-token";

  it.each([
    ["POST", "/admin/prospects"],
    ["PUT", "/api/admin/prospect-operations/sources"],
    ["PATCH", "/admin/prospects/agent-drafts"],
    ["DELETE", "/_next/static/chunks/runtime.js"],
    ["OPTIONS", "/favicon.ico"],
  ])("rejects QA %s requests to an otherwise allowlisted path: %s", async (method, pathname) => {
    const res = await middleware(request(`https://${previewHost}${pathname}`, method, { cookie: qaCookie }));

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("allows only safe reads for the explicit app and runtime asset paths", async () => {
    const [appRead, assetHead] = await Promise.all([
      middleware(request(`https://${previewHost}/admin/prospects`, "GET", { cookie: qaCookie })),
      middleware(request(`https://${previewHost}/_next/static/chunks/runtime.js`, "HEAD", { cookie: qaCookie })),
    ]);

    expect(appRead.status).not.toBe(403);
    expect(assetHead.status).not.toBe(403);
    expect(appRead.headers.get("x-middleware-next")).toBe("1");
    expect(assetHead.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/admin/triage", "/api/operator/preview-qa-session", "/api/public/report.json"])(
    "rejects a QA GET outside its exact read allowlist: %s",
    async (pathname) => {
      const res = await middleware(request(`https://${previewHost}${pathname}`, "GET", { cookie: qaCookie }));

      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("does not let a mixed QA and operator-cookie request reach a mutation", async () => {
    const res = await middleware(request(
      `https://${previewHost}/admin/prospects/research-import`,
      "POST",
      { cookie: `portal_session=otherwise-valid-operator-token; ${qaCookie}` },
    ));

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
