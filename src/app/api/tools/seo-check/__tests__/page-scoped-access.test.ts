import { describe, expect, it } from "vitest";
import { parseRobotsTxt } from "../engine-core";
import { buildPageResult } from "../page-checks";

const emptyHeaders = new Headers();
const emptySitemap = new Set<string>();

function page(url: string, html = "<html><head><title>Firm</title></head><body>Legal services</body></html>", robots: string | null = null, sitemap: Set<string> | null = emptySitemap, sitemapComplete = true) {
  return buildPageResult(
    html,
    url,
    url,
    emptyHeaders,
    { ms: 100, sampleCount: 1 },
    0,
    "example.com",
    robots === null ? null : parseRobotsTxt(robots),
    null,
    sitemap,
    null,
    sitemapComplete
  );
}

function item(result: ReturnType<typeof page>, category: string, label: string) {
  return result.categories.find((entry) => entry.name === category)?.items.find((entry) => entry.label === label);
}

describe("page-scoped search access evidence", () => {
  it("does not call a noindex page's self-canonical a conflict or claim actual indexing state", () => {
    const url = "https://example.com/services/";
    const result = page(url, `<html><head><title>Services</title><meta name="robots" content="noindex,follow"><link rel="canonical" href="${url}"></head><body>Services</body></html>`);
    expect(result.indexability.mixedSignals).toBe(false);
    expect(item(result, "Indexability", "Mixed indexability signals")?.status).toBe("pass");
    expect(item(result, "Indexability", "Indexable")?.detail).toContain("does not confirm its current indexing status");
    expect(item(result, "Indexability", "Indexable")?.detail).not.toContain("will drop");
  });

  it("reports an internal noindex-plus-other-canonical combination, while external canonical stays separate", () => {
    const internal = page("https://example.com/services/", '<html><head><meta name="robots" content="noindex"><link rel="canonical" href="https://example.com/other/"></head><body>Services</body></html>');
    expect(internal.indexability.mixedSignals).toBe(true);
    expect(item(internal, "Indexability", "Mixed indexability signals")?.detail).toContain("different same-origin canonical URL");

    const external = page("https://example.com/services/", '<html><head><meta name="robots" content="noindex"><link rel="canonical" href="https://other.example/services/"></head><body>Services</body></html>');
    expect(external.indexability.mixedSignals).toBe(false);
    expect(item(external, "Indexability", "Canonical tag")?.detail).toContain("different domain");
  });

  it("leaves sitemap membership unknown when sitemap discovery was incomplete", () => {
    const result = page("https://example.com/services/", undefined, null, new Set(["https://example.com/contact/"]), false);
    expect(result.indexability.inSitemap).toBeNull();
    expect(item(result, "Indexability", "Sitemap membership")).toMatchObject({ status: "warn", scored: false, applicability: "unknown" });
    expect(item(result, "Indexability", "Sitemap membership")?.detail).toContain("sitemap data was incomplete");
  });

  it("evaluates Google and Bing access on each actual path and preserves unknown when robots is unavailable", () => {
    const rules = "User-agent: Googlebot\nDisallow: /services/";
    const blocked = page("https://example.com/services/", undefined, rules);
    const allowed = page("https://example.com/team/", undefined, rules);
    expect(item(blocked, "Indexability", "robots.txt crawl access")?.detail).toContain("Googlebot");
    expect(item(blocked, "Indexability", "robots.txt crawl access")?.detail).not.toContain("Bingbot");
    expect(item(blocked, "Indexability", "robots.txt crawl access")?.detail).toContain("does not establish whether the URL is indexed");
    expect(item(allowed, "Indexability", "robots.txt crawl access")?.status).toBe("pass");

    const unknown = page("https://example.com/team/");
    expect(item(unknown, "Indexability", "robots.txt crawl access")).toMatchObject({ status: "warn", scored: false, applicability: "unknown" });
  });

  it("does not turn a training-bot team-path disallow into a Google/Bing block", () => {
    const result = page("https://example.com/team/", undefined, "User-agent: ClaudeBot\nDisallow: /team/");
    expect(item(result, "Indexability", "robots.txt crawl access")?.status).toBe("pass");
    expect(item(result, "AI Visibility", "AI training bot control")?.detail).toContain("No restriction for the listed training/content-use crawlers was observed");
    expect(item(result, "Indexability", "robots.txt crawl access")?.detail).not.toContain("Blocked");
  });
});
