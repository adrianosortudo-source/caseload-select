import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildIssues,
  buildInternalSummary,
  buildSiteStructureIssues,
  severityBreakdown,
  computeDiscoveryConfidence,
  compareIssuesByPriority,
  type PageResult,
  type Issue,
} from "../analysis";
import { parseRobotsTxt } from "../engine-core";
import type { CategoryResult, CheckItem, PageType } from "../engine-core";

function mkIssue(overrides: Partial<Issue> & Pick<Issue, "title" | "category" | "priority">): Issue {
  return {
    id: overrides.title, status: "fail", severity: "high", detail: "", affectedUrls: [],
    affectedCount: 1, totalPages: 10, pageTypeImpact: [], confidence: "high", effort: "medium",
    ...overrides,
  };
}

function loadFixture(name: string): { pages: PageResult[] } {
  const p = path.join(__dirname, "__fixtures__", `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function cat(name: string, items: CheckItem[]): CategoryResult {
  const score = items.reduce((s, i) => s + (i.status === "pass" ? 10 : i.status === "warn" ? 5 : 0), 0);
  return { name, score, maxScore: items.length * 10, items };
}

function mkPage(opts: {
  url: string;
  pageType: PageType;
  categories: CategoryResult[];
  contactForm?: boolean;
  phone?: boolean;
  cta?: boolean;
  testimonials?: boolean;
  credentials?: boolean;
  schemaBlocks?: number;
  hasPerson?: boolean;
  practiceAreaIntent?: boolean;
}): PageResult {
  const allItems = opts.categories.flatMap((c) => c.items);
  return {
    url: opts.url,
    title: "Test page",
    pageType: opts.pageType,
    pageScore: 50,
    pageGrade: "C+",
    aiVisibilityScore: 50,
    categories: opts.categories,
    failCount: allItems.filter((i) => i.status === "fail").length,
    warnCount: allItems.filter((i) => i.status === "warn").length,
    httpStatus: 200,
    indexable: true,
    indexability: {
      httpStatus: 200, redirected: false, redirectHops: 0, canonical: null,
      canonicalSelf: null, canonicalSameOrigin: null, metaNoindex: false, metaNofollow: false,
      headerNoindex: false, headerNofollow: false, indexable: true, inSitemap: null, mixedSignals: false,
    },
    schema: {
      blocks: opts.schemaBlocks ?? 1, invalidBlocks: 0, types: [], hasOrganization: false,
      hasLocalBusiness: false, hasLegalService: false, hasAttorney: false, hasPerson: opts.hasPerson ?? false,
      hasBreadcrumb: false, hasFaq: false, hasWebsite: false, hasReview: false,
      fields: { name: false, url: false, telephone: false, address: false, areaServed: false, sameAs: false, priceRange: false, openingHours: false },
      conflictingEntity: false,
    },
    lawFirm: {
      phoneVisible: opts.phone ?? true, contactFormPresent: opts.contactForm ?? true,
      addressVisible: true, consultationCta: opts.cta ?? true, policyPagePresent: true, practiceAreaIntent: opts.practiceAreaIntent ?? true,
      trust: { testimonials: opts.testimonials ?? true, reviews: false, caseResults: false, awards: false, credentials: opts.credentials ?? true },
    },
    wordCount: 500,
    keyWarnings: [],
  };
}

describe("buildIssues", () => {
  it("maps an Indexability failure to critical severity", () => {
    const pages = [mkPage({
      url: "https://x.com/", pageType: "homepage",
      categories: [cat("Indexability", [{ label: "Indexable", status: "fail", detail: "noindex", fix: "remove" }])],
    })];
    const issues = buildIssues(pages);
    const indexIssue = issues.find((i) => i.title === "Indexable");
    expect(indexIssue?.severity).toBe("critical");
    expect(indexIssue?.priority).toBeGreaterThan(0);
    expect(Number.isNaN(indexIssue?.priority)).toBe(false);
  });

  it("aggregates one issue across pages and counts affected pages", () => {
    const c = (s: CheckItem["status"]) => cat("On-Page SEO", [{ label: "Page title", status: s, detail: "d" }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [c("fail")] }),
      mkPage({ url: "https://x.com/about", pageType: "about", categories: [c("warn")] }),
      mkPage({ url: "https://x.com/contact", pageType: "contact", categories: [c("pass")] }),
    ];
    const issues = buildIssues(pages);
    const titleIssue = issues.find((i) => i.title === "Page title");
    expect(titleIssue).toBeTruthy();
    expect(titleIssue?.affectedCount).toBe(2); // fail + warn pages, not the pass
    expect(titleIssue?.status).toBe("fail"); // worst wins
    expect(titleIssue?.totalPages).toBe(3);
  });

  it("keeps long page titles below high while preserving missing-title blockers", () => {
    const longTitle = cat("On-Page SEO", [{ label: "Page title", status: "warn", detail: "Too long (75 chars)." }]);
    const missingTitle = cat("On-Page SEO", [{ label: "Page title", status: "fail", detail: "Missing. Add a title." }]);
    const longIssue = buildIssues([mkPage({ url: "https://x.com/", pageType: "homepage", categories: [longTitle] })])
      .find((i) => i.title === "Page title");
    const missingIssue = buildIssues([mkPage({ url: "https://x.com/", pageType: "homepage", categories: [missingTitle] })])
      .find((i) => i.title === "Page title");
    expect(longIssue?.severity).toBe("low");
    expect(missingIssue?.severity).toBe("high");
  });

  it("suppresses JSON-LD validity as a duplicate when there are no blocks", () => {
    const schema = cat("Schema & Structured Data", [
      { label: "JSON-LD structured data", status: "fail", detail: "No JSON-LD blocks found." },
      { label: "JSON-LD validity", status: "fail", detail: "No blocks to validate." },
    ]);
    const titles = buildIssues([mkPage({ url: "https://x.com/", pageType: "homepage", categories: [schema] })]).map((i) => i.title);
    expect(titles).toContain("JSON-LD structured data");
    expect(titles).not.toContain("JSON-LD validity");
  });

  it("does not let policy pages inflate business-content findings", () => {
    const local = cat("Local SEO", [{ label: "NAP in structured data", status: "fail", detail: "No NAP." }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [local] }),
      mkPage({ url: "https://x.com/privacy-policy", pageType: "policy", categories: [local] }),
    ];
    const issue = buildIssues(pages).find((i) => i.title === "NAP in structured data");
    expect(issue?.affectedCount).toBe(1);
    expect(issue?.evidence).toBe("1 page: https://x.com/");
  });

  it("keeps a simple redirect chain low priority", () => {
    const redirect = cat("Indexability", [{ label: "Redirect chain", status: "warn", detail: "1 redirect hop before the final page." }]);
    const issue = buildIssues([mkPage({ url: "https://x.com/", pageType: "homepage", categories: [redirect] })])
      .find((i) => i.title === "Redirect chain");
    expect(["low", "info"]).toContain(issue?.severity);
    expect(issue?.priority).toBeLessThan(30);
  });

  it("caps a noindex / robots block to low when it lands only on policy pages", () => {
    // Field case gosailaw.com: /disclaimer/ is Disallow'd in robots.txt. Blocking
    // a policy / utility page is standard, intentional practice, not a critical
    // ranking emergency, so it must not read as critical.
    const blocked = cat("Indexability", [{ label: "robots.txt crawl access", status: "fail", detail: "Blocked for Googlebot, Bingbot in robots.txt." }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])] }),
      mkPage({ url: "https://x.com/disclaimer", pageType: "policy", categories: [blocked] }),
    ];
    const issue = buildIssues(pages).find((i) => i.title === "robots.txt crawl access");
    expect(issue?.severity).toBe("low");
  });

  it("keeps a noindex on a practice / content page critical", () => {
    // The same block on a real content page IS a ranking problem and stays critical.
    const noindex = cat("Indexability", [{ label: "Indexable", status: "fail", detail: "Page is set to noindex (meta robots)." }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])] }),
      mkPage({ url: "https://x.com/real-estate/refinances", pageType: "practice", categories: [noindex] }),
    ];
    const issue = buildIssues(pages).find((i) => i.title === "Indexable");
    expect(issue?.severity).toBe("critical");
  });

  it("does not report a missing policy link when the crawl reached a policy page", () => {
    // Field case gosailaw.com: the crawl visited /disclaimer/ and /privacy-policy/,
    // so the firm HAS policy pages; a per-page "no policy link found" finding then
    // claims an absence the crawler disproved.
    const noPolicyLink = cat("Legal Marketing", [{ label: "Policy / disclaimer pages", status: "warn" as const, detail: "No privacy, terms, or disclaimer link found." }]);
    const clean = [cat("On-Page SEO", [{ label: "Page title", status: "pass" as const, detail: "" }])];
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [noPolicyLink] }),
      mkPage({ url: "https://x.com/contact", pageType: "contact", categories: [noPolicyLink] }),
      mkPage({ url: "https://x.com/disclaimer", pageType: "policy", categories: clean }),
    ];
    expect(buildIssues(pages).map((i) => i.title)).not.toContain("Policy / disclaimer pages");
  });

  it("still reports a missing policy link when the site has no policy page at all", () => {
    const noPolicyLink = cat("Legal Marketing", [{ label: "Policy / disclaimer pages", status: "warn" as const, detail: "No privacy, terms, or disclaimer link found." }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [noPolicyLink] }),
      mkPage({ url: "https://x.com/contact", pageType: "contact", categories: [noPolicyLink] }),
    ];
    expect(buildIssues(pages).map((i) => i.title)).toContain("Policy / disclaimer pages");
  });

  it("sorts issues by priority descending", () => {
    const pages = [mkPage({
      url: "https://x.com/", pageType: "homepage",
      categories: [
        cat("Indexability", [{ label: "Indexable", status: "fail", detail: "" }]),
        cat("Performance", [{ label: "Time to first byte", status: "warn", detail: "" }]),
      ],
    })];
    const issues = buildIssues(pages);
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i - 1].priority).toBeGreaterThanOrEqual(issues[i].priority);
    }
  });

  it("keeps generic hygiene issues below high-severity prospecting blockers", () => {
    // A mid-tier On-Page failure across commercial pages should cap at high,
    // not become critical. Critical is reserved for explicit blockers.
    const c = cat("On-Page SEO", [{ label: "Image alt text", status: "fail", detail: "" }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [c] }),
      mkPage({ url: "https://x.com/contact", pageType: "contact", categories: [c] }),
      mkPage({ url: "https://x.com/practice", pageType: "practice", categories: [c] }),
    ];
    const issue = buildIssues(pages).find((i) => i.title === "Image alt text");
    expect(issue?.severity).toBe("low");
    expect(issue?.priority).toBeLessThan(40);
    expect(issue?.severity).not.toBe("medium");
    expect(issue?.severity).not.toBe("critical");
  });

  it("dedupes evidence paths and preserves meaningful query labels", () => {
    const c = cat("Schema & Structured Data", [{ label: "Business schema fields", status: "fail", detail: "" }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [c] }),
      mkPage({ url: "https://x.com/?attachment_id=910", pageType: "homepage", categories: [c] }),
      mkPage({ url: "https://x.com/contact", pageType: "contact", categories: [c] }),
    ];
    const issue = buildIssues(pages).find((i) => i.title === "Business schema fields");
    expect(issue?.evidence).toContain("/");
    expect(issue?.evidence).toContain("/?attachment_id=910");
    expect(issue?.evidence).toContain("/contact");
    expect(issue?.evidence).not.toContain("/, /, /");
  });

  it("still rates an explicit blocker (noindex) as critical even off commercial pages", () => {
    const pages = [mkPage({
      url: "https://x.com/blog/p", pageType: "blog",
      categories: [cat("Indexability", [{ label: "Indexable", status: "fail", detail: "" }])],
    })];
    expect(buildIssues(pages).find((i) => i.title === "Indexable")?.severity).toBe("critical");
  });

  it("keeps AI training bot control as a low-severity policy item, never bumped", () => {
    // Optional content-use policy: warn on every page must stay low, not climb
    // to high via the commercial+sitewide coverage bump.
    const c = cat("AI Visibility", [{ label: "AI training bot control", status: "warn", detail: "" }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [c] }),
      mkPage({ url: "https://x.com/contact", pageType: "contact", categories: [c] }),
      mkPage({ url: "https://x.com/practice", pageType: "practice", categories: [c] }),
    ];
    const issue = buildIssues(pages).find((i) => i.title === "AI training bot control");
    // A warn drops the "low" base to "info"; the point is it is never elevated.
    expect(["low", "info"]).toContain(issue?.severity);
    expect(issue?.severity).not.toBe("high");
  });

  it("keeps optional llms.txt low, never bumped to high across commercial pages", () => {
    const c = cat("AI Visibility", [{ label: "llms.txt file", status: "warn", detail: "" }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [c] }),
      mkPage({ url: "https://x.com/contact", pageType: "contact", categories: [c] }),
      mkPage({ url: "https://x.com/practice", pageType: "practice", categories: [c] }),
    ];
    const issue = buildIssues(pages).find((i) => i.title === "llms.txt file");
    expect(["low", "info"]).toContain(issue?.severity);
    expect(issue?.severity).not.toBe("high");
  });

  it("keeps Sitemap membership low, never enters the Indexability blocker bucket", () => {
    // A missing sitemap (inSitemap=null) fires a warn in the Indexability category.
    // It must NOT reach medium+ severity: a missing sitemap is a discoverability
    // gap, not an indexability suppression. Medium+ would trigger the
    // "held back from search engines" pain-point, which is misleading.
    const c = cat("Indexability", [{ label: "Sitemap membership", status: "warn", detail: "No sitemap found." }]);
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: [c] }),
      mkPage({ url: "https://x.com/about", pageType: "about", categories: [c] }),
      mkPage({ url: "https://x.com/practice", pageType: "practice", categories: [c] }),
    ];
    const issue = buildIssues(pages).find((i) => i.title === "Sitemap membership");
    expect(issue).toBeTruthy();
    // warn drops the "low" base to "info"; the key check is never medium+.
    expect(["low", "info"]).toContain(issue?.severity);
    expect(issue?.severity).not.toBe("medium");
    expect(issue?.severity).not.toBe("high");
    expect(issue?.severity).not.toBe("critical");
  });

  it("returns no issues when everything passes", () => {
    const pages = [mkPage({
      url: "https://x.com/", pageType: "homepage",
      categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])],
    })];
    expect(buildIssues(pages)).toHaveLength(0);
  });
});

describe("severityBreakdown", () => {
  it("counts by severity", () => {
    const pages = [mkPage({
      url: "https://x.com/", pageType: "homepage",
      categories: [
        cat("Indexability", [{ label: "Indexable", status: "fail", detail: "" }]),
        cat("Performance", [{ label: "Time to first byte", status: "warn", detail: "" }]),
      ],
    })];
    const b = severityBreakdown(buildIssues(pages));
    expect(b.critical + b.high + b.medium + b.low + b.info).toBe(buildIssues(pages).length);
  });
});

describe("buildInternalSummary", () => {
  const goodPages = [mkPage({
    url: "https://x.com/", pageType: "homepage",
    categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])],
  })];

  it("is deterministic for the same input", () => {
    const a = buildInternalSummary(goodPages, buildIssues(goodPages), 80, 80);
    const b = buildInternalSummary(goodPages, buildIssues(goodPages), 80, 80);
    expect(a).toEqual(b);
  });

  it("keeps prospectFitScore within [0,100] and never NaN", () => {
    for (const score of [0, 20, 50, 80, 100]) {
      const s = buildInternalSummary(goodPages, [], score, score);
      expect(s.prospectFitScore).toBeGreaterThanOrEqual(0);
      expect(s.prospectFitScore).toBeLessThanOrEqual(100);
      expect(Number.isNaN(s.prospectFitScore)).toBe(false);
    }
  });

  it("rates a thin, broken single-page site as poor maturity", () => {
    const weak = [mkPage({
      url: "https://x.com/", pageType: "homepage", schemaBlocks: 0,
      categories: [cat("Indexability", [{ label: "Indexable", status: "fail", detail: "" }])],
      phone: false, contactForm: false, cta: false, testimonials: false, credentials: false,
    })];
    const s = buildInternalSummary(weak, buildIssues(weak), 20, 20);
    expect(s.websiteMaturity).toBe("poor");
    expect(["high", "urgent"]).toContain(s.urgencyLevel);
    expect(s.trustAndConversionGaps.length).toBeGreaterThan(0);
  });

  it("flags missing trust and conversion cues", () => {
    const noTrust = [mkPage({
      url: "https://x.com/", pageType: "homepage",
      categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])],
      phone: false, contactForm: false, cta: false, testimonials: false, credentials: false,
    })];
    const s = buildInternalSummary(noTrust, [], 60, 60);
    expect(s.trustAndConversionGaps).toContain("No clear consultation call to action");
    expect(s.trustAndConversionGaps).toContain("No visible phone number");
  });
});

describe("buildSiteStructureIssues", () => {
  it("flags missing practice pages and missing sitemap when no page signals practice areas", () => {
    const pages = [mkPage({
      url: "https://x.com/", pageType: "homepage", practiceAreaIntent: false,
      categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])],
    })];
    const issues = buildSiteStructureIssues(pages, false);
    const titles = issues.map((i) => i.title);
    expect(titles).toContain("No practice-area pages found");
    expect(titles).toContain("No XML sitemap found");
    expect(titles).toContain("No attorney / team page found");
  });

  it("does not flag missing practice pages on a one-page site whose homepage signals practice areas", () => {
    // Common on Wix / Squarespace: the whole firm is one page and every practice
    // area is a homepage section. The homepage carries practiceAreaIntent, so the
    // tool must not claim the practice content is absent. Field case: themblawfirm.ca.
    const pages = [mkPage({
      url: "https://x.com/", pageType: "homepage", practiceAreaIntent: true,
      categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])],
    })];
    expect(buildSiteStructureIssues(pages, true).map((i) => i.title)).not.toContain("No practice-area pages found");
  });

  it("does not flag a contact gap when a phone is present on the homepage", () => {
    const pages = [mkPage({
      url: "https://x.com/", pageType: "homepage", phone: true,
      categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])],
    })];
    const issues = buildSiteStructureIssues(pages, true);
    expect(issues.map((i) => i.title)).not.toContain("No clear contact path");
  });

  it("does not flag practice pages when the firm names them by matter (topic URL, type 'other')", () => {
    const c = [cat("On-Page SEO", [{ label: "Page title", status: "pass" as const, detail: "" }])];
    const pages = [
      // Homepage intent off, so the "other" matter pages are the sole credit source.
      mkPage({ url: "https://x.com/", pageType: "homepage", practiceAreaIntent: false, categories: c }),
      // /corporate, /real-estate classify as "other" but carry practice-area intent
      mkPage({ url: "https://x.com/corporate", pageType: "other", categories: c }),
      mkPage({ url: "https://x.com/real-estate", pageType: "other", categories: c }),
    ];
    expect(buildSiteStructureIssues(pages, true).map((i) => i.title)).not.toContain("No practice-area pages found");
  });

  it("does not flag a missing team page when a page carries Person schema", () => {
    const c = [cat("On-Page SEO", [{ label: "Page title", status: "pass" as const, detail: "" }])];
    const pages = [
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: c }),
      // /about carries the lawyer's Person schema even though it is not a /team URL
      mkPage({ url: "https://x.com/about", pageType: "about", hasPerson: true, categories: c }),
    ];
    expect(buildSiteStructureIssues(pages, true).map((i) => i.title)).not.toContain("No attorney / team page found");
  });

  it("reframes a missing team page as blocked (not absent) when robots.txt disallows team paths", () => {
    // Field case gosailaw.com: robots.txt Disallows /team-member/ and every
    // individual bio slug, so the crawler genuinely cannot reach them. The
    // firm has the content; it is hiding it from crawlers by accident.
    const c = [cat("On-Page SEO", [{ label: "Page title", status: "pass" as const, detail: "" }])];
    const pages = [mkPage({ url: "https://x.com/", pageType: "homepage", categories: c })];
    const parsedRobots = parseRobotsTxt([
      "User-agent: *",
      "Disallow: /team-member/",
      "Disallow: /team-member-jane-doe/",
    ].join("\n"));
    const titles = buildSiteStructureIssues(pages, true, parsedRobots).map((i) => i.title);
    expect(titles).toContain("Attorney / team pages blocked from crawlers");
    expect(titles).not.toContain("No attorney / team page found");
  });

  it("keeps the generic missing-team-page finding when no robots block explains it", () => {
    const c = [cat("On-Page SEO", [{ label: "Page title", status: "pass" as const, detail: "" }])];
    const pages = [mkPage({ url: "https://x.com/", pageType: "homepage", categories: c })];
    const parsedRobots = parseRobotsTxt(["User-agent: *", "Disallow: /wp-admin/"].join("\n"));
    const titles = buildSiteStructureIssues(pages, true, parsedRobots).map((i) => i.title);
    expect(titles).toContain("No attorney / team page found");
    expect(titles).not.toContain("Attorney / team pages blocked from crawlers");
  });

  it("downgrades practice/team absence findings one severity tier when discovery confidence is low", () => {
    const c = [cat("On-Page SEO", [{ label: "Page title", status: "pass" as const, detail: "" }])];
    const pages = [mkPage({ url: "https://x.com/", pageType: "homepage", practiceAreaIntent: false, categories: c })];
    const highConf = buildSiteStructureIssues(pages, false, null, "high");
    const lowConf = buildSiteStructureIssues(pages, false, null, "low");
    const practiceHigh = highConf.find((i) => i.title === "No practice-area pages found");
    const practiceLow = lowConf.find((i) => i.title === "No practice-area pages found");
    const teamHigh = highConf.find((i) => i.title === "No attorney / team page found");
    const teamLow = lowConf.find((i) => i.title === "No attorney / team page found");
    expect(practiceHigh?.severity).toBe("high");
    expect(practiceLow?.severity).toBe("medium");
    expect(teamHigh?.severity).toBe("medium");
    expect(teamLow?.severity).toBe("low");
    expect(practiceLow?.detail).toMatch(/discovery gap/);
  });

  it("does not downgrade the sitemap or robots-blocked findings for low discovery confidence", () => {
    // "No XML sitemap found" is a hard fact (hasSitemap boolean), not an
    // absence inferred from crawl coverage, so it is untouched by confidence.
    const c = [cat("On-Page SEO", [{ label: "Page title", status: "pass" as const, detail: "" }])];
    const pages = [mkPage({ url: "https://x.com/", pageType: "homepage", categories: c })];
    const issues = buildSiteStructureIssues(pages, false, null, "low");
    expect(issues.find((i) => i.title === "No XML sitemap found")?.severity).toBe("medium");
  });
});

describe("computeDiscoveryConfidence", () => {
  it("is high when the crawl scanned everything the sitemap listed within budget", () => {
    // Field case themblawfirm.ca: a 2-page site, sitemap lists 2 URLs, both scanned.
    expect(computeDiscoveryConfidence(2, 2, 1, 10)).toBe("high");
  });

  it("is high for a normal multi-page crawl with a real sitemap", () => {
    expect(computeDiscoveryConfidence(10, 63, 20, 10)).toBe("high");
  });

  it("is low with no sitemap and near-zero homepage links (SPA nav, no safety net)", () => {
    expect(computeDiscoveryConfidence(1, 0, 1, 10)).toBe("low");
  });

  it("is medium with no sitemap but a moderate number of homepage links", () => {
    expect(computeDiscoveryConfidence(5, 0, 5, 10)).toBe("medium");
  });

  it("is high with no sitemap but plenty of homepage links", () => {
    expect(computeDiscoveryConfidence(10, 0, 12, 10)).toBe("high");
  });

  it("is medium when the crawl stops early, before exhausting either the sitemap or its own budget", () => {
    // e.g. a wall-clock timeout: sitemap has 200 URLs, budget is 10 pages, but
    // only 6 were scanned before the crawl stopped.
    expect(computeDiscoveryConfidence(6, 200, 5, 10)).toBe("medium");
  });

  it("is high when the crawl exhausts its own page budget against a larger sitemap", () => {
    // Asking for a quick (10-page) scan of a 200-URL sitemap and using the
    // full budget is full compliance with what was requested, not a gap.
    expect(computeDiscoveryConfidence(10, 200, 5, 10)).toBe("high");
  });
});

describe("compareIssuesByPriority", () => {
  it("breaks a priority tie by coverage (higher affected fraction first)", () => {
    const a = mkIssue({ title: "A", category: "Technical & Security", priority: 67, affectedCount: 3, totalPages: 10 });
    const b = mkIssue({ title: "B", category: "Technical & Security", priority: 67, affectedCount: 8, totalPages: 10 });
    expect([a, b].sort(compareIssuesByPriority)).toEqual([b, a]);
  });

  it("then breaks by category weight (a HIGH-weighted category before a MEDIUM one)", () => {
    // Field case tmalaw.ca: 14 HIGH issues tied at priority 67 spanning
    // Technical & Security (category weight "high") and Schema & Structured
    // Data (category weight "medium"). Same severity, same coverage: category
    // weight must be the next tie-break, not object insertion order.
    const schema = mkIssue({ title: "Business schema fields", category: "Schema & Structured Data", priority: 67, affectedCount: 8, totalPages: 10 });
    const security = mkIssue({ title: "HSTS header", category: "Technical & Security", priority: 67, affectedCount: 8, totalPages: 10 });
    expect([schema, security].sort(compareIssuesByPriority)).toEqual([security, schema]);
  });

  it("finally breaks by title so the order is fully deterministic", () => {
    const a = mkIssue({ title: "Zebra check", category: "Technical & Security", priority: 67, affectedCount: 8, totalPages: 10 });
    const b = mkIssue({ title: "Apple check", category: "Technical & Security", priority: 67, affectedCount: 8, totalPages: 10 });
    expect([a, b].sort(compareIssuesByPriority)).toEqual([b, a]);
  });

  it("produces the same order on repeated sorts of the real tmalaw tie (14 issues at priority 67)", () => {
    const domain = loadFixture("tmalaw");
    const issues = buildIssues(domain.pages);
    const tied = issues.filter((i) => i.priority === 67);
    expect(tied.length).toBeGreaterThan(1);
    const sortedOnce = [...tied].sort(compareIssuesByPriority).map((i) => i.title);
    const sortedTwice = [...tied].sort(compareIssuesByPriority).sort(compareIssuesByPriority).map((i) => i.title);
    expect(sortedTwice).toEqual(sortedOnce);
  });
});
