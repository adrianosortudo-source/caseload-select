import { describe, expect, it } from "vitest";
import { METHODOLOGY_CHECKS, METHODOLOGY_SOURCES, attachMethodologyEvidence } from "../methodology-sources";
import { parseRobotsTxt } from "../engine-core";
import { buildPageResult } from "../page-checks";

describe("methodology check registry", () => {
  it("has unique stable ids and references only registered sources", () => {
    const definitions = Object.values(METHODOLOGY_CHECKS);
    const scored = definitions.filter((definition) => definition.scoreEligible);
    expect(scored).toHaveLength(5);
    for (const definition of scored) {
      expect(definition.predicate, definition.id).toBeTruthy();
      expect(definition.scoringRationale, definition.id).toBeTruthy();
      expect(definition.basis).toContain(definition.predicate);
      expect(definition.basis).toContain(definition.scoringRationale);
    }
    const ids = definitions.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of definitions) {
      for (const sourceId of definition.sourceIds) expect(METHODOLOGY_SOURCES[sourceId]).toBeDefined();
      if (definition.scoreEligible) {
        expect(definition.sourceIds.length, definition.id).toBeGreaterThan(0);
        expect(definition.sourceIds.every((id) => METHODOLOGY_SOURCES[id].verification === "verified"), definition.id).toBe(true);
      }
    }
  });

  it("attaches check id and page-level evidence to every emitted check", () => {
    const url = "https://example.com/";
    const result = buildPageResult(
      "<html><head></head><body>Law firm</body></html>", url, url, new Headers(),
      { ms: 100, sampleCount: 1 }, 0, "example.com", parseRobotsTxt(""), null,
      new Set(), null
    );
    for (const category of result.categories) {
      for (const item of category.items) {
        expect(item.checkId).toBeTruthy();
        expect(item.sourceIds).toBeDefined();
        expect(item.evidence).toMatchObject({ assessedUrl: url, applicability: item.applicability ?? "applicable" });
        expect(item.evidence?.detail).toBe(item.detail);
        if (item.applicability === "not-applicable") expect(item.evidence?.coverage).toBe("not-assessed");
      }
    }
    const missingTitle = result.categories.find((category) => category.name === "On-Page SEO")?.items.find((item) => item.label === "Page title");
    expect(missingTitle).toMatchObject({
      status: "fail",
      checkId: "seo.on-page.page-title",
      sourceIds: ["G13"],
      disposition: "scored",
      predicate: "The initial HTML contains a non-empty title element.",
      scoringRationale: expect.stringContaining("Google recommends"),
      basis: expect.stringContaining("The initial HTML contains a non-empty title element."),
    });
    expect(missingTitle?.scored).not.toBe(false);
    const knownExclusion = result.categories.find((category) => category.name === "Links & Content")?.items.find((item) => item.label === "Word count");
    expect(knownExclusion).toMatchObject({
      scored: false,
      disposition: "unscored",
      basis: expect.stringContaining("Known v4 exclusion"),
    });
  });

  it("keeps optional indexability observations out of the denominator and action path", () => {
    const url = "https://example.com/";
    const result = buildPageResult(
      "<html><head><meta name=\"robots\" content=\"nofollow\"></head><body>Law firm</body></html>", url, url, new Headers(),
      { ms: 100, sampleCount: 1 }, 2, "example.com", parseRobotsTxt(""), null,
      new Set(), null
    );
    const checks = result.categories.find((category) => category.name === "Indexability")!.items;
    for (const label of ["Redirect chain", "Followable links", "Canonical tag", "Mixed indexability signals", "Sitemap membership"]) {
      expect(checks.find((item) => item.label === label)).toMatchObject({ scored: false, disposition: "unscored" });
      expect(checks.find((item) => item.label === label)?.fix).toBeUndefined();
    }
    expect(checks.find((item) => item.label === "Canonical tag")?.sourceIds).toEqual(["G15"]);
    expect(checks.find((item) => item.label === "Sitemap membership")?.sourceIds).toContain("G16");
    expect(checks.find((item) => item.label === "Followable links")?.sourceIds).toEqual(["G17"]);
    expect(checks.find((item) => item.label === "Redirect chain")?.sourceIds).toEqual(["G18", "G19"]);
    expect(result.categories.find((category) => category.name === "On-Page SEO")?.items.find((item) => item.label === "Page title")?.scored).not.toBe(false);
  });

  it("forces unregistered checks to pending, unscored evidence", () => {
    const [category] = attachMethodologyEvidence([{
      name: "Unknown category", score: 0, maxScore: 10,
      items: [{ label: "Invented check", status: "fail", detail: "No verified mapping." }],
    }], "https://example.com/");
    expect(category.items[0]).toMatchObject({
      scored: false,
      checkId: "seo.unmapped.unknown-category-invented-check",
      sourceIds: [],
      disposition: "pending-review",
      basis: "No stable methodology definition is registered for this check.",
      evidence: { applicability: "unknown", coverage: "not-assessed" },
    });
  });
});
