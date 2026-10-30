import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
  ipFromRequest: vi.fn(() => "198.51.100.25"),
  rateLimitHeaders: vi.fn(() => new Headers()),
}));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: vi.fn() };
});

import { NextRequest } from "next/server";
import { Agent, fetch as undiciFetch, Response as UndiciResponse } from "undici";
import { POST } from "../route";

afterEach(() => {
  vi.mocked(undiciFetch).mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubUndiciFetch(implementation: typeof undiciFetch) {
  vi.mocked(undiciFetch).mockImplementation(implementation);
}

function requestUrl(input: Parameters<typeof undiciFetch>[0]): string {
  if (typeof input === "string") return input;
  return "href" in input ? input.href : input.url;
}

const pageHtml = (title: string) =>
  `<!doctype html><html><head><title>${title} | Example Law</title><meta name="description" content="Useful public information for clients." /><link rel="canonical" href="https://example.com/" /></head><body><h1>${title}</h1><p>Our lawyers explain legal options, service boundaries and useful next steps for people looking for help.</p></body></html>`;

function installMockSite(onDispatch?: (init: Parameters<typeof undiciFetch>[1]) => void) {
  const requestedUrls: string[] = [];
  const urls = Array.from(
    { length: 40 },
    (_, index) => `https://example.com/public-page-${String(index + 1).padStart(2, "0")}`
  );
  const sitemap = `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;

  stubUndiciFetch(vi.fn(async (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) => {
    onDispatch?.(init);
    const url = requestUrl(input);
    requestedUrls.push(url);
    const pathname = new URL(url).pathname;

    if (pathname === "/robots.txt") {
      return new UndiciResponse("User-agent: *\nAllow: /\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    if (pathname === "/sitemap.xml") {
      return new UndiciResponse(sitemap, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    if (pathname === "/llms.txt") return new UndiciResponse("", { status: 404 });
    if (pathname === "/") {
      return new UndiciResponse(pageHtml("Example Law"), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const page = pathname.match(/^\/public-page-(\d+)$/);
    if (page) {
      return new UndiciResponse(pageHtml(`Public page ${page[1]}`), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new UndiciResponse("", { status: 404 });
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

function installSitemapSite(options: { robotsSitemap?: string; rootSitemap?: string; childResponses?: Record<string, { body: string; status: number }> } = {}) {
  const requestedUrls: string[] = [];
  stubUndiciFetch(vi.fn(async (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) => {
    const url = requestUrl(input);
    requestedUrls.push(url);
    const pathname = new URL(url).pathname;
    if (pathname === "/robots.txt") {
      const declared = options.robotsSitemap ? `Sitemap: ${options.robotsSitemap}\n` : "";
      return new UndiciResponse(`User-agent: *\nAllow: /\n${declared}`, { status: 200 });
    }
    if (pathname === "/llms.txt") return new UndiciResponse("", { status: 404 });
    if (pathname === "/sitemap.xml") return options.rootSitemap
      ? new UndiciResponse(options.rootSitemap, { status: 200, headers: { "content-type": "application/xml" } })
      : new UndiciResponse("", { status: 404 });
    const child = options.childResponses?.[pathname];
    if (child) return new UndiciResponse(child.body, { status: child.status, headers: { "content-type": "application/xml" } });
    if (pathname === "/") return new UndiciResponse(pageHtml("Example Law"), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (pathname === "/listed-page") return new UndiciResponse(pageHtml("Listed page"), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    return new UndiciResponse("", { status: 404 });
  }));
  return requestedUrls;
}

describe("public SEO scan page limit", () => {
  it("uses Undici fetch with the matching SSRF Agent and reads its response stream", async () => {
    const dispatchers: Array<NonNullable<Parameters<typeof undiciFetch>[1]>["dispatcher"]> = [];
    const globalFetch = vi.fn(async () => { throw new Error("Unexpected global fetch"); });
    vi.stubGlobal("fetch", globalFetch);
    const requestedUrls = installMockSite((init) => {
      if (init?.dispatcher) dispatchers.push(init.dispatcher);
    });

    const { response } = await runPublicScan({ maxPages: 1 });

    expect(response.status).toBe(200);
    expect(requestedUrls).toContain("https://example.com");
    expect(undiciFetch).toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(dispatchers.length).toBeGreaterThan(0);
    expect(dispatchers.every((dispatcher) => dispatcher instanceof Agent)).toBe(true);
    expect(new Set(dispatchers).size).toBe(1);
  });

  it("does not call an optional missing default sitemap incomplete", async () => {
    installSitemapSite();
    const { response, result } = await runPublicScan({ maxPages: 1 });
    const coverage = result.coverage as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(coverage.sitemapIncomplete).toBe(false);
    expect(coverage.partial).toBe(false);
    expect(result.partial).toBe(false);
  });

  it("marks a robots-declared sitemap retrieval failure incomplete without asserting absent membership", async () => {
    installSitemapSite({ robotsSitemap: "https://example.com/declared.xml", childResponses: { "/declared.xml": { body: "", status: 503 } } });
    const { response, result } = await runPublicScan({ maxPages: 1 });
    const coverage = result.coverage as Record<string, unknown>;
    const homepage = (result.pages as Array<Record<string, unknown>>).find((page) => new URL(String(page.url)).pathname === "/");
    if (!homepage) throw new Error("The homepage result was not returned.");
    const indexability = homepage.indexability as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(coverage.sitemapIncomplete).toBe(true);
    expect(coverage.partial).toBe(true);
    expect(indexability.sitemapComplete).toBe(false);
    expect(indexability.inSitemap).toBeNull();
  });

  it("preserves a retrieved sitemap child while reporting another failed child as incomplete", async () => {
    const index = `<sitemapindex><sitemap><loc>https://example.com/child-a.xml</loc></sitemap><sitemap><loc>https://example.com/child-b.xml</loc></sitemap></sitemapindex>`;
    const urls = `<urlset><url><loc>https://example.com/listed-page</loc></url></urlset>`;
    const requested = installSitemapSite({
      rootSitemap: index,
      childResponses: {
        "/child-a.xml": { body: urls, status: 200 },
        "/child-b.xml": { body: "", status: 503 },
      },
    });
    const { response, result } = await runPublicScan({ maxPages: 2 });
    const coverage = result.coverage as Record<string, unknown>;
    const homepage = (result.pages as Array<Record<string, unknown>>).find((page) => new URL(String(page.url)).pathname === "/");
    if (!homepage) throw new Error("The homepage result was not returned.");
    const indexability = homepage.indexability as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(requested).toContain("https://example.com/child-a.xml");
    expect(requested).toContain("https://example.com/child-b.xml");
    expect(requested.map((url) => new URL(url).pathname).filter((path) => path.endsWith(".xml"))).toEqual([
      "/sitemap.xml", "/child-a.xml", "/child-b.xml",
    ]);
    expect(coverage.sitemapIncomplete).toBe(true);
    expect(indexability.sitemapComplete).toBe(false);
    expect(indexability.inSitemap).toBeNull();
    const scannedPages = result.pages as Array<Record<string, unknown>>;
    const listedPage = scannedPages.find((page) => page.url === "https://example.com/listed-page");
    expect(listedPage).toBeTruthy();
    const listedIndexability = listedPage?.indexability as Record<string, unknown>;
    expect(listedIndexability.inSitemap).toBe(true);
    expect(listedIndexability.sitemapComplete).toBe(false);
    const indexabilityCategory = (listedPage?.categories as Array<Record<string, unknown>>).find((category) => category.name === "Indexability");
    const membership = (indexabilityCategory?.items as Array<Record<string, unknown>>).find((item) => item.label === "Sitemap membership");
    expect(membership).toMatchObject({ status: "pass", scored: false });
  });

  it("marks a nested sitemap beyond the existing recursion limit incomplete without fetching it", async () => {
    const rootIndex = `<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>`;
    const childIndex = `<sitemapindex><sitemap><loc>https://example.com/grandchild.xml</loc></sitemap></sitemapindex>`;
    const requested = installSitemapSite({
      rootSitemap: rootIndex,
      childResponses: { "/child.xml": { body: childIndex, status: 200 } },
    });
    const { response, result } = await runPublicScan({ maxPages: 1 });
    const coverage = result.coverage as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(requested).toContain("https://example.com/child.xml");
    expect(requested).not.toContain("https://example.com/grandchild.xml");
    expect(coverage.sitemapIncomplete).toBe(true);
    expect(coverage.partial).toBe(true);
  });

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

  it("logs one safe category array across all homepage connection attempts and preserves the public error", async () => {
    const failures = [
      Object.assign(new TypeError("RAW_MESSAGE_SECRET https://private.invalid/path"), { code: "EAI_AGAIN" }),
      Object.assign(new Error("RAW_TLS_SECRET"), { code: "CERT_HAS_EXPIRED" }),
      Object.assign(new Error("RAW_TIMEOUT_SECRET"), { name: "TimeoutError" }),
      Object.assign(new Error("RAW_CAUSE_SECRET"), { cause: Object.assign(new Error("cause private"), { code: "ECONNRESET" }) }),
    ];
    const requestedUrls: string[] = [];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubUndiciFetch(vi.fn(async (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) => {
      const url = requestUrl(input);
      requestedUrls.push(url);
      throw failures[requestedUrls.length - 1];
    }));

    const { response, result } = await runPublicScan({ maxPages: 1 });

    expect(requestedUrls).toEqual([
      "https://example.com",
      "https://www.example.com",
      "http://example.com",
      "http://www.example.com",
    ]);
    expect(requestedUrls).toHaveLength(4);
    expect(response.status).toBe(422);
    expect(result.error).toBe(
      "The scanner could not connect to example.com. The website may still be publicly reachable. Try again later or contact CaseLoad Select for help."
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("seo_check_homepage_connection_failed", {
      stage: "homepage",
      categories: ["dns", "tls", "timeout", "connection"],
    });
    const logged = JSON.stringify(log.mock.calls);
    for (const privateValue of ["RAW_MESSAGE_SECRET", "RAW_TLS_SECRET", "RAW_TIMEOUT_SECRET", "RAW_CAUSE_SECRET", "private.invalid", "example.com", "EAI_AGAIN", "ECONNRESET"]) {
      expect(logged).not.toContain(privateValue);
    }
  });

  it("classifies only allowlisted homepage failure codes and exact internal redirect errors", async () => {
    const cases: Array<{ category: string; error: Error }> = [
      { category: "dns", error: Object.assign(new Error("private"), { code: "ENOTFOUND" }) },
      { category: "tls", error: Object.assign(new Error("private"), { cause: Object.assign(new Error("private"), { code: "CERT_HAS_EXPIRED" }) }) },
      { category: "timeout", error: Object.assign(new Error("private"), { cause: Object.assign(new Error("private"), { code: "UND_ERR_HEADERS_TIMEOUT" }) }) },
      { category: "timeout", error: Object.assign(new Error("private"), { name: "AbortError" }) },
      { category: "connection", error: Object.assign(new Error("private"), { cause: Object.assign(new Error("private"), { code: "ECONNREFUSED" }) }) },
      { category: "connection", error: Object.assign(new Error("private"), { cause: Object.assign(new Error("private"), { code: "UND_ERR_SOCKET" }) }) },
      {
        category: "redirect_request_setup.invalid_url",
        error: Object.assign(new Error("RAW_REDIRECT_SECRET https://private.invalid/path?token=secret"), {
          cause: Object.assign(new Error("private"), { code: "ERR_INVALID_URL" }),
        }),
      },
      { category: "redirect_request_setup.invalid_argument", error: Object.assign(new Error("private"), { code: "ERR_INVALID_ARG_TYPE" }) },
      { category: "redirect_request_setup.invalid_argument", error: Object.assign(new Error("private"), { cause: Object.assign(new Error("private"), { code: "UND_ERR_INVALID_ARG" }) }) },
      { category: "redirect_request_setup.unsupported_protocol", error: Object.assign(new Error("private"), { cause: Object.assign(new Error("private"), { code: "ERR_INVALID_PROTOCOL" }) }) },
      { category: "redirect_request_setup.unsupported_protocol", error: new Error("unsupported_protocol") },
      { category: "redirect_request_setup.redirect_missing_location", error: new Error("redirect_without_location") },
      { category: "redirect_request_setup.redirect_limit", error: new Error("too_many_redirects") },
      { category: "unknown", error: Object.assign(new Error("too_many_redirects additional details"), { code: "PRIVATE_UNMAPPED_CODE" }) },
    ];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const fixture of cases) {
      log.mockClear();
      stubUndiciFetch(vi.fn(async () => {
        throw fixture.error;
      }));

      const { response, result } = await runPublicScan({ maxPages: 1 });

      expect(response.status).toBe(422);
      expect(result.error).toBe(
        "The scanner could not connect to example.com. The website may still be publicly reachable. Try again later or contact CaseLoad Select for help."
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("seo_check_homepage_connection_failed", {
        stage: "homepage",
        categories: Array(4).fill(fixture.category),
      });
      const logged = JSON.stringify(log.mock.calls);
      for (const privateValue of ["RAW_REDIRECT_SECRET", "private.invalid", "token=secret", "example.com", "ERR_INVALID_URL", "PRIVATE_UNMAPPED_CODE"]) {
        expect(logged).not.toContain(privateValue);
      }
    }
  });

  it("classifies malformed error access as unknown without changing the 422 response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const malformedFailure = new Proxy(new Error("MALFORMED_PRIVATE_MESSAGE"), {
      get(target, property, receiver) {
        if (property === "message" || property === "cause" || property === "code" || property === "name") {
          throw new Error("MALFORMED_PRIVATE_MESSAGE");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    stubUndiciFetch(vi.fn(async () => {
      throw malformedFailure;
    }));

    const { response, result } = await runPublicScan({ maxPages: 1 });

    expect(response.status).toBe(422);
    expect(result.error).toBe(
      "The scanner could not connect to example.com. The website may still be publicly reachable. Try again later or contact CaseLoad Select for help."
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("seo_check_homepage_connection_failed", {
      stage: "homepage",
      categories: Array(4).fill("unknown"),
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("MALFORMED_PRIVATE_MESSAGE");
  });

  it("does not emit the homepage connection diagnostic when fallback succeeds or on HTTP and SSRF responses", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fallbackUrls: string[] = [];
    stubUndiciFetch(vi.fn(async (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) => {
      const url = requestUrl(input);
      fallbackUrls.push(url);
      if (url === "https://example.com") throw new Error("primary host unavailable");
      const pathname = new URL(url).pathname;
      if (pathname === "/robots.txt") return new UndiciResponse("User-agent: *\nAllow: /\n", { status: 200 });
      if (pathname === "/llms.txt" || pathname === "/sitemap.xml") return new UndiciResponse("", { status: 404 });
      if (pathname === "/") return new UndiciResponse(pageHtml("Example Law"), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      return new UndiciResponse("", { status: 404 });
    }));
    const fallbackSuccess = await runPublicScan({ maxPages: 1 });
    expect(fallbackUrls.slice(0, 2)).toEqual(["https://example.com", "https://www.example.com"]);
    expect(fallbackSuccess.response.status).toBe(200);

    stubUndiciFetch(vi.fn(async () => new UndiciResponse("", { status: 503 })));
    const httpFailure = await runPublicScan({ maxPages: 1 });
    expect(httpFailure.response.status).toBe(422);
    expect(httpFailure.result.error).toBe(
      "example.com is up but returned HTTP 503 to the scanner. The host may be temporarily unavailable or blocking automated access (common on Squarespace, Wix, and Cloudflare). Confirm the site loads for you, then try again later."
    );

    stubUndiciFetch(vi.fn(async () => {
      throw new Error("ssrf_blocked");
    }));
    const ssrfFailure = await runPublicScan({ maxPages: 1 });
    expect(ssrfFailure.response.status).toBe(400);
    expect(ssrfFailure.result.error).toBe("That domain cannot be checked.");
    expect(log.mock.calls.filter(([event]) => event === "seo_check_homepage_connection_failed")).toHaveLength(0);
  });

  it("keeps the generic response when malformed failures or the console logger throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("LOGGER_PRIVATE_MESSAGE");
    });
    const malformedFailure = new Proxy(new Error("MALFORMED_PRIVATE_MESSAGE"), {
      get(target, property, receiver) {
        if (property === "message" || property === "cause" || property === "code" || property === "name") {
          throw new Error("MALFORMED_PRIVATE_MESSAGE");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    stubUndiciFetch(vi.fn(async () => {
      throw malformedFailure;
    }));

    const { response, result } = await runPublicScan({ maxPages: 1 });

    expect(response.status).toBe(422);
    expect(result.error).toBe(
      "The scanner could not connect to example.com. The website may still be publicly reachable. Try again later or contact CaseLoad Select for help."
    );
  });
});
