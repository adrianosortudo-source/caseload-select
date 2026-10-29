import { describe, expect, it } from "vitest";
import { countSkippedPages, hashPageUrlIdentities, resolveCoverageState } from "../coverage";

describe("scan coverage contracts", () => {
  const state = (overrides: Partial<Parameters<typeof resolveCoverageState>[0]> = {}) => resolveCoverageState({
    hitTimeBudget: false,
    hitPageLimit: false,
    failedPages: 0,
    blockedCandidates: false,
    attemptedChildPages: 0,
    frontierCapSkipped: false,
    sitemapIncomplete: false,
    ...overrides,
  });

  it("marks mixed successful and failed page attempts partial while preserving exhausted-discovery cause only when there were no failures", () => {
    expect(state({ failedPages: 1, attemptedChildPages: 9 })).toEqual({ partial: true, stopReason: "fetch-failure" });
    expect(state()).toEqual({ partial: false, stopReason: "discovery-exhausted" });
  });

  it("keeps time and page limits ahead of page failures and marks frontier truncation partial", () => {
    expect(state({ failedPages: 1, hitPageLimit: true })).toEqual({ partial: true, stopReason: "page-limit" });
    expect(state({ failedPages: 1, hitTimeBudget: true, hitPageLimit: true })).toEqual({ partial: true, stopReason: "time-budget" });
    expect(state({ frontierCapSkipped: true })).toEqual({ partial: true, stopReason: "other" });
  });

  it("marks a known incomplete sitemap partial with an other stop reason when no crawl limit takes precedence", () => {
    expect(state({ sitemapIncomplete: true })).toEqual({ partial: true, stopReason: "other" });
  });

  it("counts URL skip reasons as page counts and excludes separate sitemap completeness state", () => {
    const skippedReasons = {
      "page-limit": 2,
      "robots-disallowed": 1,
      "frontier-cap": 0,
    };
    expect(countSkippedPages(skippedReasons)).toBe(3);
    const coverage = { skippedPages: countSkippedPages(skippedReasons), sitemapIncomplete: true };
    expect(coverage).toEqual({ skippedPages: 3, sitemapIncomplete: true });
  });

  it("hashes normalized URL identities, independent of order and response contents", () => {
    const first = hashPageUrlIdentities(["https://example.com/a/", "https://example.com/"]);
    const reordered = hashPageUrlIdentities(["https://example.com/", "https://example.com/a"]);
    expect(first).toBe(reordered);
    expect(first).not.toBe(hashPageUrlIdentities(["https://example.com/", "https://example.com/b"]));
  });
});
