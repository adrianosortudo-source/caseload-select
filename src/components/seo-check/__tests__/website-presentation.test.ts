import { describe, expect, it } from "vitest";
import { buildSeoReportModel, type ReportInput, type ReportPage } from "@/app/api/tools/seo-check/report-model";
import { buildWebsitePresentation } from "../website-presentation";

const labels = ["HTTP status", "HTTPS", "Page title", "Indexable", "robots.txt crawl access"];
function input(): ReportInput {
  const page: ReportPage = {
    url: "https://example.com/services/", title: "Legal services", pageType: "practice", httpStatus: 200,
    indexability: { googleDirectives: { noindex: "not-observed", nofollow: "not-observed", observations: [] } },
    robotsAccess: { google: true, bing: true },
    categories: [{ name: "Checks", score: 50, maxScore: 50, items: labels.map(label => ({ label, status: "pass", detail: "Observed", scored: true })) }],
  };
  return { domain: "example.com", methodologyVersion: 5, pagesScanned: 1, pages: [page], aiBots: [],
    coverage: { requestedLimit: 25, attemptedPages: 1, successfulPages: 1, failedPages: 0, skippedPages: 0, discoveredCandidateUrls: 0, totalSitePages: null, stopReason: "discovery-exhausted", skippedReasons: {}, sitemapIncomplete: false, partial: false, pageSetHashBasis: "normalized-url-identities" } };
}
const view = (data: ReportInput) => buildWebsitePresentation(data, buildSeoReportModel(data));

describe("website report presentation", () => {
  it("requires all five recorded checks and supporting page observations before saying passed", () => {
    const data = input();
    expect(view(data).allPassed).toBe(true);
    data.pages![0].categories[0].items.pop();
    expect(view(data).allPassed).toBe(false);
    expect(view(data).checks.at(-1)?.unknown).toBe(1);
  });
  it("does not turn missing or inapplicable evidence into a pass", () => {
    const data = input();
    data.pages![0].categories[0].items[0].scored = false;
    data.pages![0].categories[0].items[1].applicability = "unknown";
    expect(view(data).checks.slice(0,2).map(c => c.unknown)).toEqual([1,1]);
    expect(view(data).allPassed).toBe(false);
    data.pages![0].categories[0].items[2].evidence = { kind: "page", applicability: "not-applicable", coverage: "not-assessed", detail: "Unavailable" };
    expect(view(data).checks[2].unknown).toBe(1);
    expect(view(data).checks[2].detail).toContain("Evidence was missing");
  });
  it("does not contradict Google exclusions even if a saved aggregate says pass", () => {
    const data = input();
    data.pages![0].indexability.googleDirectives!.noindex = "observed";
    const report = view(data);
    expect(report.allPassed).toBe(false);
    expect(report.checks.find(c => c.id.endsWith('.indexable'))?.review).toBe(1);
    expect(report.title).toBe("Review the search exclusions");
    expect(report.checks.find(c => c.id.endsWith(".indexable"))?.detail).toContain("excluded pages named");
    expect(report.direction).toContain("Start with");
    expect(report.interpretation).not.toContain("Google may choose different wording");
  });
  it("uses an issue-specific CTA deliverable without joining an imperative title into a sentence", () => {
    const data = input();
    data.pages![0].indexability.googleDirectives!.noindex = "observed";
    data.pages![0].indexability.inSitemap = true;
    const report = view(data);
    expect(report.helpDeliverable).toContain("sitemap and search-setting checks for 1 page");
    expect(report.helpDeliverable).not.toContain("for align");
  });
  it("distinguishes a page limit from a retrieval failure and never invents a site total", () => {
    const data = input();
    Object.assign(data.coverage!, { stopReason: "page-limit", partial: true, discoveredCandidateUrls: 101 });
    expect(view(data).stopLabel).toBe("25-page sample limit reached");
    expect(view(data).coverageNote).not.toMatch(/101|incomplete/);
    Object.assign(data.coverage!, { stopReason: "fetch-failure", failedPages: 1, attemptedPages: 2 });
    expect(view(data).stopLabel).toBe("Some pages could not be retrieved");
    expect(view(data).coverageNote).toContain("1 attempted page did not return usable evidence");
    expect(view(data).allPassed).toBe(false);
  });
  it("never treats an empty or mismatched page inventory as a passed report", () => {
    const data = input();
    data.pages = [];
    expect(view(data).allPassed).toBe(false);
    expect(view(data).title).not.toContain("passed");
    data.pages = input().pages;
    data.coverage!.successfulPages = 0;
    expect(view(data).allPassed).toBe(false);
    data.coverage!.successfulPages = 1;
    data.pagesScanned = 25;
    expect(view(data).allPassed).toBe(false);
  });
  it("keeps unassessed AI rules separate from search and training observations", () => {
    const data = input();
    data.aiBots = [{ name: "GPTBot", token: "GPTBot", blocked: false, purposes: ["training"], policyObservation: "no-blocking-rule-observed" }];
    expect(view(data).aiSearch.every(b => b.result === "Rules not assessed")).toBe(true);
    expect(view(data).aiIntro).toContain("not assessed");
    data.aiBots.push({ name: "ChatGPT", token: "OAI-SearchBot", blocked: true, purposes: ["search"], policyObservation: "blocking-rule-observed" });
    expect(view(data).aiSearch[0].result).toBe("Blocking rule observed");
    expect(view(data).aiIntro).toContain("intentional");
  });
  it("only uses observed service pages as examples and never mutates saved data", () => {
    const data = input();
    const before = JSON.stringify(data);
    expect(view(data).serviceExamples).toEqual([{ title: "Legal services", url: "https://example.com/services/" }]);
    expect(JSON.stringify(data)).toBe(before);
  });
});
