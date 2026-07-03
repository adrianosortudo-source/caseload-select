import { describe, it, expect } from "vitest";
import {
  buildIssues,
  buildInternalSummary,
  buildSiteStructureIssues,
  severityBreakdown,
  type PageResult,
} from "../analysis";
import type { CategoryResult, CheckItem, PageType } from "../engine-core";

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
      addressVisible: true, consultationCta: opts.cta ?? true, policyPagePresent: true, practiceAreaIntent: true,
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
  it("flags missing practice pages and missing sitemap", () => {
    const pages = [mkPage({
      url: "https://x.com/", pageType: "homepage",
      categories: [cat("On-Page SEO", [{ label: "Page title", status: "pass", detail: "" }])],
    })];
    const issues = buildSiteStructureIssues(pages, false);
    const titles = issues.map((i) => i.title);
    expect(titles).toContain("No practice-area pages found");
    expect(titles).toContain("No XML sitemap found");
    expect(titles).toContain("No attorney / team page found");
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
      mkPage({ url: "https://x.com/", pageType: "homepage", categories: c }),
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
});
