import { describe, expect, it } from "vitest";
import { METHODOLOGY_CHECKS, METHODOLOGY_SOURCES, attachMethodologyEvidence } from "../methodology-sources";
import { parseRobotsTxt } from "../engine-core";
import { buildPageResult } from "../page-checks";

describe("methodology check registry", () => {
  it("has unique stable ids and references only registered sources", () => {
    const definitions = Object.values(METHODOLOGY_CHECKS);
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
      new Set(), null, null
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
      basis: expect.stringContaining("Direct observation"),
    });
    expect(missingTitle?.scored).not.toBe(false);
    const knownExclusion = result.categories.find((category) => category.name === "Links & Content")?.items.find((item) => item.label === "Word count");
    expect(knownExclusion).toMatchObject({
      scored: false,
      disposition: "unscored",
      basis: expect.stringContaining("Known v4 exclusion"),
    });
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
