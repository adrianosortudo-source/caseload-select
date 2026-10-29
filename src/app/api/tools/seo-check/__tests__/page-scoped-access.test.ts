import { describe, expect, it } from "vitest";
import { computeWeightedScore, crawlUrlKey, parseRobotsTxt } from "../engine-core";
import { aggregateCategories, buildPageResult } from "../page-checks";
import { buildV4Issues } from "../analysis";
import { buildSeoReportModel } from "../report-model";

const emptyHeaders = new Headers();
const emptySitemap = new Set<string>();

function page(url: string, html = "<html><head><title>Firm</title></head><body>Legal services</body></html>", robots: string | null = null, sitemap: Set<string> | null = emptySitemap, sitemapComplete = true, headers: Headers = emptyHeaders) {
  return buildPageResult(
    html,
    url,
    url,
    headers,
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
  it("reproduces the documented v4 false-pass to v5 score change through production aggregation", () => {
    const url = "https://example.com/";
    const firstMetaOnly = '<html lang="en"><head><title>Example Law</title><meta name="robots" content="index"></head><body>Legal services</body></html>';
    const duplicateMetaNoindex = '<html lang="en"><head><title>Example Law</title><meta name="robots" content="index"><meta name="robots" content="noindex"></head><body>Legal services</body></html>';
    const allowRobots = "User-agent: *\nAllow: /";
    const scored = (html: string, robots: string | null) => computeWeightedScore(aggregateCategories([
      page(url, html, robots, new Set([url]), true),
    ]));

    // The v4 first-generic-tag behavior saw the leading `index` and missed
    // the later generic noindex. These values are fixture arithmetic only.
    expect(scored(firstMetaOnly, allowRobots)).toBe(100);
    expect(scored(duplicateMetaNoindex, allowRobots)).toBe(92);
    expect(scored(firstMetaOnly, null)).toBe(100);
    expect(scored(duplicateMetaNoindex, null)).toBe(88);

    const knownAccess = page(url, duplicateMetaNoindex, allowRobots, new Set([url]), true);
    const unknownAccess = page(url, duplicateMetaNoindex, null, new Set([url]), true);
    const v4FirstTagView = page(url, firstMetaOnly, allowRobots, new Set([url]), true);
    expect(v4FirstTagView.indexability.metaNoindex).toBe(false);
    expect(item(v4FirstTagView, "Indexability", "Indexable")?.status).toBe("pass");
    expect(item(v4FirstTagView, "Indexability", "Indexable")?.scored).not.toBe(false);
    expect(knownAccess.indexability.googleDirectives?.noindex).toBe("observed");
    expect(item(knownAccess, "Indexability", "Indexable")?.status).toBe("fail");
    expect(item(knownAccess, "Indexability", "Indexable")?.scored).not.toBe(false);
    expect(item(unknownAccess, "Indexability", "Indexable")?.status).toBe("fail");
    expect(item(unknownAccess, "Indexability", "Indexable")?.scored).not.toBe(false);
    expect(item(unknownAccess, "Indexability", "robots.txt crawl access")).toMatchObject({ status: "warn", scored: false, applicability: "unknown" });
    expect(unknownAccess.categories.find((category) => category.name === "Indexability")?.maxScore)
      .toBe(20);
    expect(knownAccess.categories.find((category) => category.name === "Indexability")?.maxScore).toBe(30);
  });

  it("excludes unknown Google directive scope from the denominator without a score penalty", () => {
    const url = "https://example.com/";
    const robots = "User-agent: *\nAllow: /";
    const unknownDirective = page(
      url,
      '<html lang="en"><head><title>Example Law</title></head><body>Legal services</body></html>',
      robots,
      new Set([url]),
      true,
      new Headers({ "x-robots-tag": "Bingbot: noindex, noindex" }),
    );
    const indexability = unknownDirective.categories.find((category) => category.name === "Indexability");

    expect(unknownDirective.indexability.googleDirectives?.noindex).toBe("unknown");
    expect(item(unknownDirective, "Indexability", "Indexable")).toMatchObject({ status: "warn", scored: false, applicability: "unknown" });
    expect(indexability?.maxScore).toBe(20);
    expect(computeWeightedScore(aggregateCategories([unknownDirective]))).toBe(100);
  });

  it("assesses every generic meta directive and applies Googlebot scope without globalizing other crawlers", () => {
    const url = "https://example.com/";
    const generic = page(url, '<html><head><meta name="robots" content="index"><meta content="none" name=robots></head><body>Firm</body></html>');
    expect(generic.indexability.googleDirectives?.noindex).toBe("observed");
    expect(item(generic, "Indexability", "Indexable")).toMatchObject({ status: "fail" });

    const googlebot = page(url, '<html><head><meta name="googlebot" content="noindex"></head><body>Firm</body></html>');
    expect(googlebot.indexability.googleDirectives?.noindex).toBe("observed");

    const bingOnly = page(url, '<html><head><meta name="bingbot" content="noindex"></head><body>Firm</body></html>');
    expect(bingOnly.indexability.googleDirectives?.noindex).toBe("not-observed");
    expect(item(bingOnly, "Indexability", "Indexable")).toMatchObject({ status: "pass" });
  });

  it("scopes X-Robots-Tag headers and leaves flattened ambiguity unscored", () => {
    const url = "https://example.com/";
    const bing = page(url, undefined, null, emptySitemap, true, new Headers({ "x-robots-tag": "Bingbot: noindex" }));
    expect(bing.indexability.googleDirectives?.noindex).toBe("not-observed");
    expect(item(bing, "Indexability", "Indexable")).toMatchObject({ status: "pass" });

    const google = page(url, undefined, null, emptySitemap, true, new Headers({ "x-robots-tag": "Googlebot: noindex" }));
    expect(item(google, "Indexability", "Indexable")).toMatchObject({ status: "fail" });

    const ambiguous = page(url, undefined, null, emptySitemap, true, new Headers({ "x-robots-tag": "Bingbot: noindex, noindex" }));
    expect(ambiguous.indexability.googleDirectives?.noindex).toBe("unknown");
    expect(item(ambiguous, "Indexability", "Indexable")).toMatchObject({ status: "warn", scored: false, applicability: "unknown" });
  });

  it("aggregates known, passing, and unknown directive scope without inventing a noindex action", () => {
    const noindexUrl = "https://example.com/practice/employment/";
    const cleanUrl = "https://example.com/";
    const unknownUrl = "https://example.com/contact/";
    const robots = "User-agent: *\nAllow: /";
    const noindex = page(noindexUrl, '<html><head><title>Firm</title><meta name="robots" content="noindex"></head><body>Practice</body></html>', robots);
    const clean = page(cleanUrl, undefined, robots);
    const unknown = page(unknownUrl, undefined, robots, emptySitemap, true, new Headers({ "x-robots-tag": "Bingbot: noindex, noindex" }));
    const unrelatedBotControl = page(unknownUrl, undefined, robots, emptySitemap, true, new Headers({ "x-robots-tag": "Bingbot: noindex" }));
    const pages = [noindex, clean, unknown];
    const categories = aggregateCategories(pages);
    const aggregateScore = computeWeightedScore(categories);
    const indexabilityCategory = categories.find((category) => category.name === "Indexability");
    const controlCategories = aggregateCategories([noindex, clean, unrelatedBotControl]);
    const controlScore = computeWeightedScore(controlCategories);
    const controlIndexabilityCategory = controlCategories.find((category) => category.name === "Indexability");

    expect(aggregateScore).toBe(97);
    expect(controlScore).toBe(97);
    expect(aggregateScore).toBe(controlScore);
    // Category-wide totals include 15 contextual unscored observations plus the unknown Indexable observation.
    expect(indexabilityCategory?.counts?.notAssessed).toBe(16);
    expect(controlIndexabilityCategory?.counts?.notAssessed).toBe(15);
    expect(indexabilityCategory).toMatchObject({
      maxScore: 30,
      counts: { fail: 1, applicable: 8, notAssessed: 16 },
    });
    expect(item(unknown, "Indexability", "Indexable")).toMatchObject({ status: "warn", scored: false, applicability: "unknown" });
    const aggregateIndexable = indexabilityCategory?.items.find((check) => check.label === "Indexable");
    expect(aggregateIndexable).toMatchObject({ applicability: "applicable", failCount: 1, applicableCount: 2, notAssessedCount: 1 });
    expect(aggregateIndexable?.scored).not.toBe(false);

    const issues = buildV4Issues(pages, Infinity, 5);
    const model = buildSeoReportModel({
      domain: "example.com",
      methodologyVersion: 5,
      pagesScanned: pages.length,
      overallScore: aggregateScore,
      categories,
      pages: pages.map(({ url, pageType, httpStatus, indexability, robotsAccess, categories: pageCategories }) => ({
        url, pageType, httpStatus, indexability, robotsAccess, categories: pageCategories,
      })),
      issues: issues.map(({ id, category, status, title, detail, fix, evidence, affectedUrls, affectedCount, totalPages, confidence }) => ({
        id, category, status, title, detail, fix, evidence, affectedUrls, affectedCount, totalPages, confidence,
      })),
      aiBots: [],
    });

    expect(model.scoreExplanation.score).toBe(97);
    expect(model.accessSummary.noindexCount).toBe(1);
    expect(model.accessSummary.indexabilityNotAssessedCount).toBe(1);
    expect(issues).toHaveLength(1);
    const exclusionActions = model.priorityActions.filter((action) => action.family === "search-exclusion");
    expect(exclusionActions).toHaveLength(1);
    expect(exclusionActions[0]).toMatchObject({ affectedCount: 1, affectedUrls: [noindexUrl] });
    expect(model.priorityActions.some((action) => action.affectedUrls.includes(unknownUrl))).toBe(false);
    expect(model.strengths.some((strength) => /no noindex instruction/i.test(strength))).toBe(false);
  });
  it("keeps a schema-only address separate from visible address evidence", () => {
    const html = `<html><head><title>Firm</title><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "LegalService",
      name: "Example Firm",
      address: {
        "@type": "PostalAddress",
        streetAddress: "100 King Street West",
        addressLocality: "Toronto",
        addressRegion: "ON",
        postalCode: "M5X 1A9",
      },
      areaServed: "Ontario",
    })}</script></head><body>Remote consultations by video. Legal services.</body></html>`;
    const result = page("https://example.com/", html);
    const legalAddress = item(result, "Legal Marketing", "Address / NAP");
    const localAddress = item(result, "Local SEO", "Street address (NAP)");

    expect(result.schema.fields.address).toBe(true);
    expect(result.lawFirm.addressTextPresent).toBe(false);
    expect(result.lawFirm.serviceAreaLikely).toBe(false);
    expect(legalAddress).toMatchObject({ status: "pass", scored: false });
    expect(legalAddress?.detail).toContain("does not assess rendered visibility");
    expect(localAddress).toMatchObject({ status: "pass", scored: false });
  });

  it("credits an address in visible page text", () => {
    const result = page(
      "https://example.com/",
      "<html><head><title>Firm</title></head><body>100 King Street West, Toronto. Legal services.</body></html>"
    );
    expect(result.lawFirm.addressTextPresent).toBe(true);
    expect(item(result, "Legal Marketing", "Address / NAP")?.status).toBe("pass");
    expect(item(result, "Legal Marketing", "Address / NAP")?.scored).toBe(false);
    expect(item(result, "Local SEO", "Street address (NAP)")?.scored).toBe(false);
  });

  it("does not treat hidden, template, or absent initial-HTML address text as rendered evidence", () => {
    const result = page(
      "https://example.com/",
      `<html><head><title>Firm</title></head><body><div hidden>100 King Street West</div><template>100 Queen Street West</template><div id="root"></div></body></html>`
    );
    expect(result.schema.fields.address).toBe(false);
    expect(result.lawFirm.addressTextPresent).toBe(false);
    expect(item(result, "Legal Marketing", "Address / NAP")).toMatchObject({ status: "pass", scored: false });
    expect(item(result, "Local SEO", "Street address (NAP)")).toMatchObject({ status: "pass", scored: false });
  });

  it("keeps detected credibility cues as neutral, unscored observations", () => {
    const result = page(
      "https://example.com/",
      "<html><head><title>Firm</title></head><body>Our clients say: thoughtful service. Legal services.</body></html>"
    );
    const trust = item(result, "Legal Marketing", "Trust signals");
    expect(trust).toMatchObject({ status: "pass", scored: false });
    expect(trust?.detail).toContain("does not assess credibility or professional status");
    expect(trust?.detail).not.toMatch(/of 5|trust cues lift|add client testimonials/i);
    expect(trust?.fix).toBeUndefined();
  });

  it("records title and content quantities without scoring length or fixed link counts", () => {
    const result = page(
      "https://example.com/",
      '<html><head><title>X</title><meta name="description" content="Short summary."></head><body><p>Brief content.</p></body></html>'
    );
    expect(item(result, "On-Page SEO", "Page title")).toMatchObject({ status: "pass" });
    expect(item(result, "On-Page SEO", "Page title")?.scored).not.toBe(false);
    for (const [category, label] of [
      ["On-Page SEO", "Page title length"],
      ["On-Page SEO", "Meta description"],
      ["Links & Content", "Word count"],
      ["Links & Content", "Content-to-HTML ratio"],
      ["Links & Content", "Internal links"],
      ["Links & Content", "External links"],
    ]) {
      expect(item(result, category, label), `${category} / ${label}`).toMatchObject({ scored: false });
      expect(item(result, category, label)?.fix).toBeUndefined();
    }
  });

  it("keeps a missing page title as a direct observation", () => {
    const result = page("https://example.com/", "<html><head></head><body>Firm</body></html>");
    expect(item(result, "On-Page SEO", "Page title")).toMatchObject({ status: "fail" });
    expect(item(result, "On-Page SEO", "Page title")?.scored).not.toBe(false);
  });

  it("does not call a noindex page's self-canonical a conflict or claim actual indexing state", () => {
    const url = "https://example.com/services/";
    const result = page(url, `<html><head><title>Services</title><meta name="robots" content="noindex,follow"><link rel="canonical" href="${url}"></head><body>Services</body></html>`);
    expect(result.indexability.mixedSignals).toBe(false);
    expect(item(result, "Indexability", "Mixed indexability signals")?.status).toBe("pass");
    expect(item(result, "Indexability", "Indexable")?.detail).toContain("does not confirm current indexing status");
    expect(item(result, "Indexability", "Indexable")?.detail).not.toContain("will drop");
  });

  it("reports an internal noindex-plus-other-canonical combination, while external canonical stays separate", () => {
    const internal = page("https://example.com/services/", '<html><head><meta name="robots" content="noindex"><link rel="canonical" href="https://example.com/other/"></head><body>Services</body></html>');
    expect(internal.indexability.mixedSignals).toBe(true);
    expect(item(internal, "Indexability", "Mixed indexability signals")?.detail).toContain("different same-origin canonical annotation");

    const external = page("https://example.com/services/", '<html><head><meta name="robots" content="noindex"><link rel="canonical" href="https://other.example/services/"></head><body>Services</body></html>');
    expect(external.indexability.mixedSignals).toBe(false);
    expect(item(external, "Indexability", "Canonical tag")?.detail).toContain("Google may select a different canonical");
  });

  it("leaves sitemap membership unknown when sitemap discovery was incomplete", () => {
    const result = page("https://example.com/services/", undefined, null, new Set(["https://example.com/contact/"]), false);
    expect(result.indexability.inSitemap).toBeNull();
    expect(item(result, "Indexability", "Sitemap membership")).toMatchObject({ status: "warn", scored: false, applicability: "unknown" });
    expect(item(result, "Indexability", "Sitemap membership")?.detail).toContain("sitemap locations inspected");
  });

  it("reports homepage sitemap membership only when the root URL was observed", () => {
    const completeListed = page("https://example.com/", undefined, null, new Set(["https://example.com/", "https://example.com/contact/"].map(crawlUrlKey)));
    expect(completeListed.indexability.inSitemap).toBe(true);

    const completeAbsent = page("https://example.com/", undefined, null, new Set(["https://example.com/contact/"].map(crawlUrlKey)));
    expect(completeAbsent.indexability.inSitemap).toBe(false);
    expect(item(completeAbsent, "Indexability", "Sitemap membership")).toMatchObject({ status: "warn", scored: false });

    const incompleteAbsent = page("https://example.com/", undefined, null, new Set(["https://example.com/contact/"].map(crawlUrlKey)), false);
    expect(incompleteAbsent.indexability.inSitemap).toBeNull();
    expect(item(incompleteAbsent, "Indexability", "Sitemap membership")).toMatchObject({ status: "warn", scored: false, applicability: "unknown" });
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
    expect(item(result, "AI Visibility", "AI training bot control")?.detail).toContain("Provider crawler purposes differ");
    expect(item(result, "Indexability", "robots.txt crawl access")?.detail).not.toContain("Blocked");
  });
});
