// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SeoReport, { type SeoCheckResult } from "../SeoReport";
import SeoCheckTool from "../SeoCheckTool";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const scoreCategories: SeoCheckResult["categories"] = [
  { name: "On-Page SEO", score: 10, maxScore: 10, items: [{ label: "Page title", status: "pass", detail: "Title present.", scored: true }] },
  { name: "Indexability", score: 25, maxScore: 30, items: [
    { label: "HTTP status", status: "pass", detail: "Successful response.", scored: true },
    { label: "Indexable", status: "pass", detail: "No noindex directive observed.", scored: true },
    { label: "robots.txt crawl access", status: "pass", detail: "No blocking rule observed.", scored: true },
  ] },
  { name: "Technical & Security", score: 10, maxScore: 10, items: [{ label: "HTTPS", status: "pass", detail: "HTTPS response.", scored: true }] },
  ...["Schema & Structured Data", "AI Visibility", "Legal Marketing", "Local SEO", "Rendering & Crawlability", "Performance", "Links & Content"].map((name) => ({
    name, score: 0, maxScore: 0, items: [{ label: "Context observation", status: "warn" as const, detail: "Observed only.", scored: false }],
  })),
];

const result: SeoCheckResult = {
  domain: "example.com",
  methodologyVersion: 5,
  pagesScanned: 2,
  pages: [],
  categories: scoreCategories,
  overallScore: 98,
  grade: "A",
  aiSearchScore: null,
  aiSearchGrade: null,
  aiBots: [],
  checkedAt: "2026-10-28T12:00:00.000Z",
};

describe("SeoReport score scope", () => {
  it("states the v5 limited score and when an indexability check is unscored", () => {
    render(<SeoCheckTool />);
    expect(screen.getByText(/score covers five limited check types, not the whole site/i)).toBeTruthy();
    expect(screen.getByText(/If we cannot tell whether a page tells Google not to index it, that check is not scored/i)).toBeTruthy();
  });

  it("uses the same plain-language Google indexability limit in operator mode", () => {
    render(<SeoCheckTool variant="operator" />);
    expect(screen.getByText(/reviews the available website categories per page/i)).toBeTruthy();
    expect(screen.getByText(/If we cannot tell whether a page tells Google not to index it, that check is not scored/i)).toBeTruthy();
  });

  it("shows the scored coverage beside the score and includes it in the copied summary", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<SeoReport result={result} onReset={vi.fn()} hideCta />);

    const scopeLabel = "Limited checks: 5 check types across 3 of 10 categories";
    const scoreNote = "This limited summary reflects 5 scored check types across 3 of 10 categories, applied to the inspected pages. Other observations do not contribute to this score. It is not a whole-site SEO grade or a ranking prediction.";
    expect(screen.getByText(scopeLabel)).toBeTruthy();
    expect(within(screen.getByLabelText("Website checks score")).getByText(scoreNote)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy report summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain(scopeLabel + ": 98/100.");
    expect(writeText.mock.calls[0][0]).toContain(scoreNote);
  });

  it("labels category totals as unscored or not assessed", () => {
    const categorySummaryResult: SeoCheckResult = {
      ...result,
      categories: scoreCategories.map((category) => category.name === "Indexability"
        ? { ...category, counts: { fail: 1, warn: 0, applicable: 8, notAssessed: 16, notApplicable: 0 } }
        : category),
    };
    render(<SeoReport result={categorySummaryResult} onReset={vi.fn()} hideCta />);
    fireEvent.click(screen.getByText("Check categories"));
    expect(screen.getByText(/16 unscored or not assessed/)).toBeTruthy();
    expect(screen.queryByText(/16 not assessed/)).toBeNull();
  });
  it("does not invent a method version in copied text for an unversioned result", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const unversioned: SeoCheckResult = { ...result };
    delete unversioned.methodologyVersion;

    render(<SeoReport result={unversioned} onReset={vi.fn()} hideCta />);
    expect(screen.getAllByText("Method not recorded").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Copy report summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("Method not recorded: example.com");
    expect(writeText.mock.calls[0][0]).not.toMatch(/v2|version 2/i);

    fireEvent.click(screen.getByRole("button", { name: "Copy findings" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toContain("Method not recorded");
    expect(writeText.mock.calls[1][0]).not.toMatch(/v2|version 2/i);
  });

  it("labels unknown future saved methods as unsupported in operator history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          id: "future-run", domain: "future.example", scan_mode: "quick", pages_scanned: 1,
          overall_score: 82, ai_search_score: null, ai_policy_score: null, grade: "A-",
          rendering_risk: null, issue_count: 0, methodologyVersion: 6,
          created_at: "2026-10-29T12:00:00.000Z",
        }],
      }),
    }));
    render(<SeoCheckTool variant="operator" />);
    expect(await screen.findByText(/Unsupported method · A- 82\/100/)).toBeTruthy();
  });
  it("does not turn missing historical robot fields into a definite absence", () => {
    const historical: SeoCheckResult = {
      ...result,
      methodologyVersion: 4,
      pages: [{
        url: "https://example.com/", title: "Home", pageType: "homepage", pageScore: null,
        pageGrade: "Not assessed", aiVisibilityScore: null, categories: [], failCount: 0,
        warnCount: 0, httpStatus: 200, indexable: null,
        indexability: { metaNoindex: null, headerNoindex: null, indexable: null },
      }, {
        url: "https://example.com/contact", title: "Contact", pageType: "contact", pageScore: null,
        pageGrade: "Not assessed", aiVisibilityScore: null, categories: [], failCount: 0,
        warnCount: 0, httpStatus: 200, indexable: true,
        indexability: { metaNoindex: false, headerNoindex: false, indexable: true },
      }],
    };
    render(<SeoReport result={historical} onReset={vi.fn()} hideCta />);
    fireEvent.click(screen.getByText("Pages inspected (2)"));
    expect(screen.getByText("Historical noindex status not assessed")).toBeTruthy();
    expect(screen.getByText("No noindex instruction observed")).toBeTruthy();
  });
});
