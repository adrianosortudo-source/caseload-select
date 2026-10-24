/**
 * Phase A scoring recalibration (BUILD_PLAN_seo_check_scoring_recalibration_v2.md).
 *
 * Covers the three fixes (applicability exemptions, vacuous/duplicated schema
 * passes, and the exact weighted summary) plus the existing hreflang check.
 * See engine-core.ts (applyPageTypeApplicability, computeWeightedScore) and route.ts
 * (checkSchemaMarkup, checkHreflang).
 */

import { describe, it, expect, vi } from "vitest";

// route.ts pulls in save-run -> supabase-admin (server-only) plus portal-auth
// and rate-limit at module load; the functions under test are pure, so stub
// the server surface just to import the module.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => null }));

import {
  applyPageTypeApplicability,
  CATEGORY_WEIGHTS,
  computeWeightedScore,
  parseRobotsTxt,
  scoreItems,
  type CategoryResult,
} from "../engine-core";
import { checkHreflang, checkSchemaMarkup, extractSchemaSummary, checkEntitySameAs, checkAiVisibility } from "../page-checks";
import type { SchemaSummary } from "../analysis";

describe("applyPageTypeApplicability excludes exemptions in both directions (A2)", () => {
  it("labels an exempt observation not-applicable and excludes it from score and findings", () => {
    const categories: CategoryResult[] = [
      {
        name: "Legal Marketing",
        score: 0,
        maxScore: 10,
        items: [{ label: "Word count", status: "fail", detail: "" }],
      },
    ];
    // "other" is not a CONTENT_REQUIRED_PAGE_TYPES page, so "Word count"
    // (a CONTENT_ONLY_LABELS item) is exempted here.
    const [result] = applyPageTypeApplicability(categories, "other", "https://example.com/contact");
    const item = result.items.find((i) => i.label === "Word count");
    expect(item?.status).toBe("pass");
    expect(item?.scored).toBe(false);
    expect(item?.applicability).toBe("not-applicable");
    expect(item?.detail).toContain("Not required for this other page");

    const { maxScore } = scoreItems(result.items);
    expect(maxScore).toBe(0);
  });

  it("marks an exempted pass not-applicable too", () => {
    const [result] = applyPageTypeApplicability([{
      name: "Legal Marketing", score: 10, maxScore: 10,
      items: [{ label: "Word count", status: "pass", detail: "Observed." }],
    }], "other", "https://example.com/contact");
    expect(result.items[0]).toMatchObject({ status: "pass", scored: false, applicability: "not-applicable" });
    expect(scoreItems(result.items)).toEqual({ score: 0, maxScore: 0 });
  });
});

describe("computeWeightedScore (A5)", () => {
  const category = (name: string, percent: number, maxScore = 100) => ({
    name, score: percent * maxScore / 100, maxScore, items: [],
  });

  it("uses the exact weighted mean without low-score multipliers", () => {
    expect(computeWeightedScore([category("Custom A", 100), category("Custom B", 0)])).toBe(50);
    expect(computeWeightedScore([category("Custom A", 30), category("Custom B", 100)])).toBe(65);
  });

  it("excludes AI observations and uses the locked non-AI weights", () => {
    expect(CATEGORY_WEIGHTS["AI Visibility"]).toBe(0);
    expect(computeWeightedScore([category("Custom A", 100), category("AI Visibility", 0)])).toBe(100);
  });

  it("does not let an unscored category reduce a fully scored result", () => {
    expect(computeWeightedScore([category("Custom A", 100), { name: "Unused", score: 0, maxScore: 0, items: [] }])).toBe(100);
  });
});

describe("checkHreflang (A5)", () => {
  it("returns scored:false when no hreflang annotations are present", () => {
    const item = checkHreflang("<html><head></head><body></body></html>", "https://example.com/");
    expect(item.scored).toBe(false);
    expect(item.status).toBe("pass");
  });

  it("fails on an invalid language code", () => {
    const html = `<link rel="alternate" hreflang="123" href="https://example.com/"/>`;
    const item = checkHreflang(html, "https://example.com/");
    expect(item.status).toBe("fail");
    expect(item.scored).not.toBe(false);
  });

  it("warns on a valid cluster with no self-referencing annotation", () => {
    const html =
      `<link rel="alternate" hreflang="en-ca" href="https://example.com/en/"/>` +
      `<link rel="alternate" hreflang="pt-br" href="https://example.com/pt/"/>`;
    // Neither annotation points back at this page.
    const item = checkHreflang(html, "https://example.com/fr/");
    expect(item.status).toBe("warn");
  });

  it("passes on a valid, self-referencing, absolute-URL cluster", () => {
    const html =
      `<link rel="alternate" hreflang="en-ca" href="https://example.com/en/"/>` +
      `<link rel="alternate" hreflang="pt-br" href="https://example.com/pt/"/>`;
    const item = checkHreflang(html, "https://example.com/pt/");
    expect(item.status).toBe("pass");
  });
});

describe("checkSchemaMarkup: vacuous and duplicated passes on zero JSON-LD are unscored (A2)", () => {
  it("a page with no JSON-LD at all does not let 'nothing to conflict with' or restated failures pay marks", () => {
    const schema = extractSchemaSummary("<html><head></head><body>No structured data here.</body></html>");
    expect(schema.blocks).toBe(0);

    const result = checkSchemaMarkup(schema);

    // The three items this build plan unscores when there is no structured
    // data at all: JSON-LD validity ("no blocks to validate" restates the
    // JSON-LD structured data failure), Business schema fields ("no business
    // entity to evaluate fields on" restates the Business/LegalService schema
    // failure), and Schema conflicts (nothing to conflict with when there are
    // no declarations).
    const validity = result.items.find((i) => i.label === "JSON-LD validity");
    const businessFields = result.items.find((i) => i.label === "Business schema fields");
    const conflicts = result.items.find((i) => i.label === "Schema conflicts");
    expect(validity?.scored).toBe(false);
    expect(businessFields?.scored).toBe(false);
    expect(conflicts?.scored).toBe(false);

    // Measured actual result on this input: the real scored defects are
    // "JSON-LD structured data" (fail), "Business / LegalService schema"
    // (fail), and "Breadcrumb schema" (warn, unaffected by this plan): three
    // scored items at weight 10 each, none of them full-credit passes.
    // maxScore therefore does not reach the 8-item x 10 = 80 an unfixed
    // vacuous-pass engine would have produced.
    expect(result.maxScore).toBe(30);
    expect(result.maxScore).toBeLessThan(result.items.length * 10);
    expect(result.score).toBeLessThanOrEqual(result.maxScore);
  });
});

const ldjson = (obj: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

describe("collectSameAsUrls (via extractSchemaSummary): sameAs is captured, not just detected (B1)", () => {
  // collectSameAsUrls is not exported (see route.ts), so it is exercised here
  // through the public extractSchemaSummary(html).sameAsUrls surface, which is
  // the only way any caller reaches it.
  it("finds URLs nested inside an @graph array", () => {
    const html = ldjson({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "LegalService",
          name: "Firm",
          sameAs: ["https://www.google.com/maps/place/firm", "https://www.linkedin.com/company/firm"],
        },
        { "@type": "Person", name: "Lawyer", sameAs: "https://www.instagram.com/lawyer" },
      ],
    });
    const { sameAsUrls } = extractSchemaSummary(html);
    expect(sameAsUrls).toEqual(
      expect.arrayContaining([
        "https://www.google.com/maps/place/firm",
        "https://www.linkedin.com/company/firm",
        "https://www.instagram.com/lawyer",
      ])
    );
    expect(sameAsUrls).toHaveLength(3);
  });

  it("deduplicates repeated URLs and ignores non-http values", () => {
    const html = ldjson({
      "@context": "https://schema.org",
      "@type": "LegalService",
      name: "Firm",
      sameAs: [
        "https://www.linkedin.com/company/firm",
        "https://www.linkedin.com/company/firm",
        "not-a-url",
        "tel:+14165551234",
      ],
    });
    const { sameAsUrls } = extractSchemaSummary(html);
    expect(sameAsUrls).toEqual(["https://www.linkedin.com/company/firm"]);
  });
});

describe("checkEntitySameAs (B2)", () => {
  function schemaWith(sameAsUrls: string[]): SchemaSummary {
    return {
      blocks: 1, invalidBlocks: 0, types: ["LegalService"],
      hasOrganization: false, hasLocalBusiness: false, hasLegalService: true,
      hasAttorney: false, hasPerson: false, hasBreadcrumb: false,
      hasFaq: false, hasWebsite: false, hasReview: false,
      fields: { name: true, url: true, telephone: true, address: true, areaServed: true, sameAs: sameAsUrls.length > 0, priceRange: false, openingHours: false },
      conflictingEntity: false,
      sameAsUrls,
    };
  }

  it("hasBusiness: false returns scored: false", () => {
    const item = checkEntitySameAs(schemaWith([]), false);
    expect(item.scored).toBe(false);
  });

  it("a business entity with no sameAs URLs remains an unscored observation", () => {
    const item = checkEntitySameAs(schemaWith([]), true);
    expect(item.status).toBe("pass");
    expect(item.scored).toBe(false);
    expect(item.detail).toContain("This scan cannot establish which profiles or listings the firm maintains");
    expect(item.detail).not.toMatch(/search and AI systems cannot reconcile/i);
  });

  it("reports AI-oriented page heuristics as unscored observations, not visibility findings", () => {
    const html = "<html><head><title>Firm</title></head><body><h2>Our services</h2><p>We help clients.</p></body></html>";
    const category = checkAiVisibility(html, parseRobotsTxt("User-agent: *\nAllow: /\n"), null, schemaWith([]));
    for (const label of ["Question-format headings", "Direct-answer sentences"]) {
      const item = category.items.find((entry) => entry.label === label);
      expect(item).toMatchObject({ scored: false });
      expect(item?.detail).toMatch(/does not measure AI visibility|not an assessment of answer quality or AI visibility/i);
      expect(item?.status).not.toBe("fail");
    }
  });

  it("records recognized profile surfaces without claiming local entity status", () => {
    const item = checkEntitySameAs(
      schemaWith(["https://www.linkedin.com/company/firm", "https://www.instagram.com/firm"]),
      true
    );
    expect(item.status).toBe("pass");
    expect(item.scored).toBe(false);
    expect(item.detail).toContain("recognized by this check");
    expect(item.detail).not.toMatch(/do not establish the firm as a local entity/i);
  });

  it("Google Maps, Bing Places and an LSO URL remain unscored observations", () => {
    const item = checkEntitySameAs(
      schemaWith([
        "https://www.google.com/maps/place/firm",
        "https://www.bingplaces.com/bizprofile/firm",
        "https://lso.ca/lawyers/firm",
      ]),
      true
    );
    expect(item.status).toBe("pass");
    expect(item.scored).toBe(false);
  });

  it("records the real drglaw.ca profile shape without treating the count as a gap", () => {
    const schema = schemaWith([
      "https://www.google.com/maps/place/drglaw",
      "https://www.instagram.com/drglaw",
      "https://www.linkedin.com/company/drglaw",
    ]);
    const item = checkEntitySameAs(schema, true);
    expect(item.status).toBe("pass");
    expect(item.scored).toBe(false);
    // Exactly one directory surface (Google Maps) among the three URLs;
    // Instagram and LinkedIn count as hygiene, not directory coverage.
    expect(item.detail).toContain("1 directory surface");
  });
});

describe("computeWeightedScore does not apply eligibility caps (A5)", () => {
  it("keeps the weighted mean when HTTPS fails instead of imposing a second score ceiling", () => {
    const categories: CategoryResult[] = [
      { name: "Technical & Security", score: 0, maxScore: 10, items: [{ label: "HTTPS", status: "fail", detail: "" }] },
      { name: "On-Page SEO", score: 10, maxScore: 10, items: [{ label: "Title", status: "pass", detail: "" }] },
    ];
    expect(computeWeightedScore(categories)).toBe(83);
  });
});
