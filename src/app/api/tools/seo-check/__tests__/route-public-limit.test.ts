import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
  ipFromRequest: vi.fn(() => "198.51.100.25"),
  rateLimitHeaders: vi.fn(() => new Headers()),
}));

import { NextRequest } from "next/server";
import { POST } from "../route";

afterEach(() => {
  vi.unstubAllGlobals();
});

const pageHtml = (title: string) =>
  `<!doctype html><html><head><title>${title} | Example Law</title><meta name="description" content="Useful public information for clients." /><link rel="canonical" href="https://example.com/" /></head><body><h1>${title}</h1><p>Our lawyers explain legal options, service boundaries and useful next steps for people looking for help.</p></body></html>`;

function installMockSite() {
  const requestedUrls: string[] = [];
  const urls = Array.from(
    { length: 40 },
    (_, index) => `https://example.com/public-page-${String(index + 1).padStart(2, "0")}`
  );
  const sitemap = `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requestedUrls.push(url);
    const pathname = new URL(url).pathname;

    if (pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    if (pathname === "/sitemap.xml") {
      return new Response(sitemap, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    if (pathname === "/llms.txt") return new Response("", { status: 404 });
    if (pathname === "/") {
      return new Response(pageHtml("Example Law"), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const page = pathname.match(/^\/public-page-(\d+)$/);
    if (page) {
      return new Response(pageHtml(`Public page ${page[1]}`), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("", { status: 404 });
  }));

  return requestedUrls;
}

async function runPublicScan(body: Record<string, unknown>) {
  const request = new NextRequest("https://app.caseloadselect.ca/api/tools/seo-check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: "example.com", ...body }),
  });
  const response = await POST(request);
  return { response, result: await response.json() as Record<string, unknown> };
}

describe("public SEO scan page limit", () => {
  it("scans up to 25 public pages when maxPages is omitted, even with quick mode requested", async () => {
    const requestedUrls = installMockSite();
    const { response, result } = await runPublicScan({ scanMode: "quick" });

    expect(response.status).toBe(200);
    expect(result.scanMode).toBe("standard");
    expect(result.pagesScanned).toBe(25);
    expect(result).not.toHaveProperty("internalSummary");
    expect(result).not.toHaveProperty("intentAlignment");
    const crawledPages = requestedUrls
      .map((url) => new URL(url).pathname)
      .filter((path) => /^\/public-page-\d+$/.test(path));
    expect(crawledPages).toHaveLength(24);
    expect(crawledPages.some((path) => Number(path.match(/\d+$/)?.[0]) > 24)).toBe(false);
  });

  it("never crawls page 26 or later when a public caller requests deep mode and maxPages 75", async () => {
    const requestedUrls = installMockSite();
    const { response, result } = await runPublicScan({
      scanMode: "deep",
      maxPages: 75,
      targetMatter: "estate planning",
      targetKeyword: "wills lawyer",
      targetLocation: "Toronto",
    });

    expect(response.status).toBe(200);
    expect(result.scanMode).toBe("standard");
    expect(result.pagesScanned).toBe(25);
    expect(result).not.toHaveProperty("internalSummary");
    expect(result).not.toHaveProperty("intentAlignment");
    const issues = result.issues as Array<Record<string, unknown>>;
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.every((issue) => !("internalNote" in issue) && !("prospectingAngle" in issue))).toBe(true);
    const crawledPages = requestedUrls
      .map((url) => new URL(url).pathname)
      .filter((path) => /^\/public-page-\d+$/.test(path));
    expect(crawledPages).toHaveLength(24);
    expect(crawledPages.some((path) => Number(path.match(/\d+$/)?.[0]) >= 25)).toBe(false);
  });
});
