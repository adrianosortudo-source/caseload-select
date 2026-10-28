import { describe, expect, it } from "vitest";
import { countSkippedPages, hashPageUrlIdentities } from "../coverage";

describe("scan coverage contracts", () => {
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
