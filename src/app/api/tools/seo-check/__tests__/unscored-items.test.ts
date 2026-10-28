/**
 * scored:false observations do not contribute to grades or issue/action lists.
 * See docs/SEO-TOOL-TRUST-FIX-PASS-v1.md.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => null }));

import { scoreItems, computeWeightedScore, aiScoresFromItems, type CheckItem, type CategoryResult } from "../engine-core";
import { aggregateCategories, computeTopFixes } from "../page-checks";
import { buildIssues } from "../analysis";
import type { PageResult, Indexability, SchemaSummary, LawFirmSignals } from "../analysis";
import type { PageType } from "../engine-core";

describe("scoreItems: scored:false items are excluded from both score and maxScore", () => {
  it("not-applicable and unknown checks are excluded in both passing and failing states", () => {
    const items: CheckItem[] = [
      { label: "Applicable", status: "pass", detail: "" },
      { label: "Exempt fail", status: "fail", detail: "Observed", scored: false, applicability: "not-applicable" },
      { label: "Exempt pass", status: "pass", detail: "Observed", scored: false, applicability: "not-applicable" },
      { label: "Unknown fail", status: "fail", detail: "Not assessed", scored: false, applicability: "unknown" },
      { label: "Unknown pass", status: "pass", detail: "Not assessed", scored: false, applicability: "unknown" },
    ];
    expect(scoreItems(items)).toEqual({ score: 10, maxScore: 10 });
  });
  it("a warn(unscored) item does not lower the score below what the scored pass earns", () => {
    const items: CheckItem[] = [
      { label: "A", status: "pass", detail: "" },
      { label: "B", status: "warn", detail: "", scored: false },
    ];
    expect(scoreItems(items)).toEqual({ score: 10, maxScore: 10 });
  });

  it("a fail(unscored) item does not lower the score either", () => {
    const items: CheckItem[] = [
      { label: "A", status: "pass", detail: "" },
      { label: "B", status: "fail", detail: "", scored: false },
    ];
    expect(scoreItems(items)).toEqual({ score: 10, maxScore: 10 });
  });

  it("a pass(unscored) item does not raise the score either (symmetry)", () => {
    const items: CheckItem[] = [
      { label: "A", status: "warn", detail: "" },
      { label: "B", status: "pass", detail: "", scored: false },
    ];
    expect(scoreItems(items)).toEqual({ score: 5, maxScore: 10 });
  });

  it("all-unscored category returns 0/0, not a penalized non-zero maxScore", () => {
    const items: CheckItem[] = [
      { label: "A", status: "fail", detail: "", scored: false },
      { label: "B", status: "pass", detail: "", scored: false },
    ];
    expect(scoreItems(items)).toEqual({ score: 0, maxScore: 0 });
  });
});

describe("computeWeightedScore: an all-unscored category never drags the overall score down", () => {
  const cat = (name: string, items: CheckItem[]): CategoryResult => {
    const { score, maxScore } = scoreItems(items);
    return { name, score, maxScore, items };
  };

  it("identical overall score with and without an extra all-unscored category present", () => {
    const base = [cat("On-Page SEO", [{ label: "x", status: "pass", detail: "" }])];
    const withExtra = [
      ...base,
      cat("Technical & Security", [
        { label: "CSP", status: "fail", detail: "", scored: false },
        { label: "HSTS header", status: "fail", detail: "", scored: false },
      ]),
    ];
    expect(computeWeightedScore(withExtra)).toBe(computeWeightedScore(base));
  });

  it("identical overall score whether a category's items are all scored-pass or all scored:false-with-any-status", () => {
    const withHeaders = [
      cat("On-Page SEO", [{ label: "x", status: "pass", detail: "" }]),
      cat("Technical & Security", [
        { label: "HTTPS", status: "pass", detail: "" },
        { label: "Mixed content", status: "pass", detail: "" },
        { label: "CSP", status: "pass", detail: "", scored: false },
        { label: "HSTS header", status: "pass", detail: "", scored: false },
      ]),
    ];
    const withoutHeaders = [
      cat("On-Page SEO", [{ label: "x", status: "pass", detail: "" }]),
      cat("Technical & Security", [
        { label: "HTTPS", status: "pass", detail: "" },
        { label: "Mixed content", status: "pass", detail: "" },
        { label: "CSP", status: "fail", detail: "", scored: false },
        { label: "HSTS header", status: "fail", detail: "", scored: false },
      ]),
    ];
    expect(computeWeightedScore(withHeaders)).toBe(computeWeightedScore(withoutHeaders));
  });
});

describe("aiScoresFromItems: unscored items do not move the AEO Readiness (search) score", () => {
  it("identical search score with and without an unscored llms.txt pass item", () => {
    const base: CheckItem[] = [
      { label: "Question-format headings", status: "pass", detail: "" },
      { label: "Direct-answer sentences", status: "warn", detail: "" },
    ];
    const withLlms: CheckItem[] = [...base, { label: "llms.txt file", status: "pass", detail: "", scored: false }];
    expect(aiScoresFromItems(withLlms).search).toBe(aiScoresFromItems(base).search);
  });

  it("identical search score whether the unscored item is pass or fail", () => {
    const withPass: CheckItem[] = [
      { label: "Question-format headings", status: "pass", detail: "" },
      { label: "llms.txt file", status: "pass", detail: "", scored: false },
    ];
    const withFail: CheckItem[] = [
      { label: "Question-format headings", status: "pass", detail: "" },
      { label: "llms.txt file", status: "fail", detail: "", scored: false },
    ];
    expect(aiScoresFromItems(withPass).search).toBe(aiScoresFromItems(withFail).search);
  });

  it("policy score (AI training bot control) is unaffected by the scored flag", () => {
    const items: CheckItem[] = [
      { label: "AI training bot control", status: "warn", detail: "" },
      { label: "llms.txt file", status: "pass", detail: "", scored: false },
    ];
    expect(aiScoresFromItems(items).policy).toBe(50);
  });
});

describe("aggregateCategories: the scored flag and maxScore survive the per-page merge", () => {
  const indexability: Indexability = {
    httpStatus: 200, redirected: false, redirectHops: 0, canonical: null,
    canonicalSelf: null, canonicalSameOrigin: null, metaNoindex: false, metaNofollow: false,
    headerNoindex: false, headerNofollow: false, indexable: true, inSitemap: null, mixedSignals: false,
  };
  const schema: SchemaSummary = {
    blocks: 1, invalidBlocks: 0, types: [], hasOrganization: false,
    hasLocalBusiness: false, hasLegalService: false, hasAttorney: false, hasPerson: false,
    hasBreadcrumb: false, hasFaq: false, hasWebsite: false, hasReview: false,
    fields: { name: false, url: false, telephone: false, address: false, areaServed: false, sameAs: false, priceRange: false, openingHours: false },
    conflictingEntity: false,
    sameAsUrls: [],
  };
  const lawFirm: LawFirmSignals = {
    phoneVisible: true, contactFormPresent: true, addressTextPresent: true, consultationCta: true,
    policyPagePresent: true, practiceAreaIntent: true, serviceAreaLikely: false,
    trust: { testimonials: true, reviews: false, caseResults: false, awards: false, credentials: true },
  };

  function mkPage(url: string, pageType: PageType, categories: CategoryResult[]): PageResult {
    const allItems = categories.flatMap((c) => c.items);
    return {
      url, title: "Test page", pageType, pageScore: 50, pageGrade: "C+", aiVisibilityScore: null,
      categories, failCount: allItems.filter((i) => i.status === "fail" && i.scored !== false && i.applicability !== "not-applicable" && i.applicability !== "unknown").length,
      warnCount: allItems.filter((i) => i.status === "warn" && i.scored !== false && i.applicability !== "not-applicable" && i.applicability !== "unknown").length,
      httpStatus: 200, indexable: true, indexability, schema, lawFirm,
      wordCount: 500, keyWarnings: [],
    };
  }

  it("a label unscored on every page it appears on stays scored:false after merge and drops out of maxScore", () => {
    const techSecurity = (status: "pass" | "warn" | "fail") => ({
      name: "Technical & Security",
      score: 0,
      maxScore: 0,
      items: [
        { label: "HTTPS", status: "pass" as const, detail: "" },
        { label: "Mixed content", status: "pass" as const, detail: "" },
        { label: "HSTS header", status, detail: "", scored: false },
        { label: "X-Content-Type-Options", status: "pass" as const, detail: "", scored: false },
        { label: "Content-Security-Policy", status: "pass" as const, detail: "", scored: false },
      ],
    });
    const pages = [
      mkPage("https://x.com/", "homepage", [techSecurity("warn")]),
      mkPage("https://x.com/about", "about", [techSecurity("fail")]),
    ];
    const [aggregated] = aggregateCategories(pages);

    const hsts = aggregated.items.find((i) => i.label === "HSTS header");
    expect(hsts?.scored).toBe(false);

    // Reported live defect: 5 items x 10 = 50 would overstate maxScore by
    // counting the 3 unscored items. Only HTTPS + Mixed content are scored.
    expect(aggregated.maxScore).toBe(20);
    expect(aggregated.score).toBeLessThanOrEqual(aggregated.maxScore);
  });

  it("a label scored on at least one page is NOT marked scored:false, even if unscored elsewhere", () => {
    const pages = [
      mkPage("https://x.com/", "homepage", [
        { name: "Cat", score: 10, maxScore: 10, items: [{ label: "Shared check", status: "pass", detail: "" }] },
      ]),
      mkPage("https://x.com/about", "about", [
        { name: "Cat", score: 0, maxScore: 0, items: [{ label: "Shared check", status: "pass", detail: "", scored: false }] },
      ]),
    ];
    const [aggregated] = aggregateCategories(pages);
    const item = aggregated.items.find((i) => i.label === "Shared check");
    expect(item?.scored).toBeUndefined();
  });

  it("an all-unscored category aggregates to 0/0 across multiple pages, not the items.length*10 denominator the bug produced", () => {
    const allUnscored = (status: "pass" | "warn" | "fail") => ({
      name: "AI Visibility",
      score: 0,
      maxScore: 0,
      items: [
        { label: "llms.txt file", status, detail: "", scored: false },
      ],
    });
    const pages = [
      mkPage("https://x.com/", "homepage", [allUnscored("pass")]),
      mkPage("https://x.com/about", "about", [allUnscored("fail")]),
    ];
    const [aggregated] = aggregateCategories(pages);
    expect(aggregated).toMatchObject({ score: 0, maxScore: 0 });
  });

  it("unions categories across pages and averages only page categories with positive maxScore without early rounding", () => {
    const pages = [
      mkPage("https://x.com/", "homepage", [
        { name: "Only on page one", score: 1, maxScore: 3, items: [{ label: "A", status: "pass", detail: "" }] },
        { name: "Shared", score: 0, maxScore: 0, items: [{ label: "B", status: "fail", detail: "", scored: false }] },
      ]),
      mkPage("https://x.com/about", "about", [
        { name: "Only on page two", score: 6, maxScore: 10, items: [{ label: "C", status: "pass", detail: "" }] },
        { name: "Shared", score: 2, maxScore: 4, items: [{ label: "B", status: "pass", detail: "" }] },
      ]),
    ];
    const aggregated = aggregateCategories(pages);
    expect(aggregated.map((category) => category.name)).toEqual(["Only on page one", "Shared", "Only on page two"]);
    expect(aggregated[0].score).toBeCloseTo(10 / 3, 12);
    expect(aggregated[0].maxScore).toBe(10);
    expect(aggregated[1]).toMatchObject({ score: 5, maxScore: 10 });
  });

  it("keeps pass/fail/warn counts separate and excludes not-applicable and unknown observations", () => {
    const pages = [mkPage("https://x.com/", "homepage", [{
      name: "Example",
      score: 10,
      maxScore: 10,
      items: [
        { label: "Scored fail", status: "fail", detail: "" },
        { label: "Scored warn", status: "warn", detail: "" },
        { label: "Exempt fail", status: "fail", detail: "", scored: false, applicability: "not-applicable" },
        { label: "Unknown warn", status: "warn", detail: "", scored: false, applicability: "unknown" },
      ],
    }])];
    const [aggregate] = aggregateCategories(pages);
    expect(aggregate.counts).toEqual({ fail: 1, warn: 1, applicable: 2, notAssessed: 1, notApplicable: 1 });
    expect(aggregate.items.find((item) => item.label === "Exempt fail")).toMatchObject({ failCount: 0, applicableCount: 0, notAssessedCount: 0, notApplicableCount: 1, applicability: "not-applicable" });
  });

  it("does not create findings from not-applicable or unknown failures and reports each count separately", () => {
    const category = (items: CheckItem[]): CategoryResult => ({ name: "Legal Marketing", score: 0, maxScore: 10, items });
    const pages = [
      mkPage("https://x.com/practice", "practice", [category([
        { label: "Page-specific check", status: "fail", detail: "Observed failure." },
        { label: "Exempt check", status: "fail", detail: "Outside scope.", scored: false, applicability: "not-applicable" },
        { label: "Unscored heuristic", status: "fail", detail: "Observed but not scored.", fix: "Do not create an automatic action.", scored: false },
      ])]),
      mkPage("https://x.com/about", "about", [category([
        { label: "Page-specific check", status: "warn", detail: "Not assessed.", scored: false, applicability: "unknown" },
      ])]),
    ];
    const issues = buildIssues(pages);
    expect(issues.map((issue) => issue.title)).toEqual(["Page-specific check"]);
    expect(issues[0]).toMatchObject({ failCount: 1, warnCount: 0, applicableCount: 1, notAssessedCount: 1 });
    expect(computeTopFixes(pages, 5).map((fix) => fix.label)).toEqual(["Page-specific check"]);
  });

  it("preserves methodology explanation fields through site category aggregation", () => {
    const page = mkPage("https://x.com/", "homepage", [{ name: "SEO methodology", score: 0, maxScore: 0, items: [
      { label: "Known exclusion", status: "fail", detail: "Observed only.", scored: false, disposition: "unscored", basis: "Known v4 exclusion." },
      { label: "Pending mapping", status: "warn", detail: "Unmapped.", scored: false, disposition: "pending-review", basis: "Source mapping pending." },
    ] }]);
    const [aggregate] = aggregateCategories([page]);
    expect(aggregate.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Known exclusion", disposition: "unscored", basis: "Known v4 exclusion." }),
      expect.objectContaining({ label: "Pending mapping", disposition: "pending-review", basis: "Source mapping pending." }),
    ]));
  });
});
