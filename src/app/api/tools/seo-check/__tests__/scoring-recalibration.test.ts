/**
 * Phase A scoring recalibration (BUILD_PLAN_seo_check_scoring_recalibration_v2.md).
 *
 * Covers the three fixes (applicability exemptions, vacuous/duplicated schema
 * passes, and the rebalanced weights via eligibility caps) plus the new
 * hreflang check. See engine-core.ts (applyPageTypeApplicability,
 * applyEligibilityCaps, deriveEligibilityGates) and route.ts
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
  applyEligibilityCaps,
  describeEligibilityCaps,
  deriveEligibilityGates,
  scoreItems,
  type CategoryResult,
} from "../engine-core";
import { checkHreflang, checkSchemaMarkup, extractSchemaSummary, checkEntitySameAs } from "../route";
import type { SchemaSummary } from "../analysis";

describe("applyPageTypeApplicability: exempted items are scored:false, not free passes (A1)", () => {
  it("marks an exempted item scored:false, and scoreItems on the result excludes it from maxScore", () => {
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

    const { maxScore } = scoreItems(result.items);
    expect(maxScore).toBe(0);
  });
});

describe("applyEligibilityCaps: HTTPS, indexability and rendering cap on failure only (A4)", () => {
  it("not indexable caps at 35", () => {
    expect(applyEligibilityCaps(90, { httpsOk: true, indexableOk: false, renderingOk: true })).toBe(35);
  });

  it("not HTTPS caps at 50", () => {
    expect(applyEligibilityCaps(90, { httpsOk: false, indexableOk: true, renderingOk: true })).toBe(50);
  });

  it("high-risk rendering caps at 60", () => {
    expect(applyEligibilityCaps(90, { httpsOk: true, indexableOk: true, renderingOk: false })).toBe(60);
  });

  it("a score already below every cap is left unchanged", () => {
    expect(applyEligibilityCaps(30, { httpsOk: true, indexableOk: true, renderingOk: true })).toBe(30);
  });
});

describe("describeEligibilityCaps: explains which caps applied and why (C2)", () => {
  it("returns an empty array when every gate passes", () => {
    expect(describeEligibilityCaps({ httpsOk: true, indexableOk: true, renderingOk: true })).toEqual([]);
  });

  it("returns one entry for a single failing gate", () => {
    const result = describeEligibilityCaps({ httpsOk: true, indexableOk: false, renderingOk: true });
    expect(result).toHaveLength(1);
    expect(result[0].gate).toBe("indexable");
    expect(result[0].cap).toBe(35);
  });

  it("returns three entries in indexable, https, rendering order when every gate fails", () => {
    const result = describeEligibilityCaps({ httpsOk: false, indexableOk: false, renderingOk: false });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.cap)).toEqual([35, 50, 60]);
  });

  it("every entry for a fully failing gate set has non-empty headline, reason and fix", () => {
    const result = describeEligibilityCaps({ httpsOk: false, indexableOk: false, renderingOk: false });
    for (const entry of result) {
      expect(entry.headline.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.fix.length).toBeGreaterThan(0);
    }
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

  it("a business entity with an empty sameAsUrls returns status: fail and is scored", () => {
    const item = checkEntitySameAs(schemaWith([]), true);
    expect(item.status).toBe("fail");
    expect(item.scored).not.toBe(false);
  });

  it("only LinkedIn and Instagram returns status: fail (no directory surfaces)", () => {
    const item = checkEntitySameAs(
      schemaWith(["https://www.linkedin.com/company/firm", "https://www.instagram.com/firm"]),
      true
    );
    expect(item.status).toBe("fail");
  });

  it("Google Maps, Bing Places and an LSO URL returns status: pass", () => {
    const item = checkEntitySameAs(
      schemaWith([
        "https://www.google.com/maps/place/firm",
        "https://www.bingplaces.com/bizprofile/firm",
        "https://lso.ca/lawyers/firm",
      ]),
      true
    );
    expect(item.status).toBe("pass");
  });

  it("regression: the real drglaw.ca shape (Google Maps + Instagram + LinkedIn) is warn with directories.length === 1", () => {
    const schema = schemaWith([
      "https://www.google.com/maps/place/drglaw",
      "https://www.instagram.com/drglaw",
      "https://www.linkedin.com/company/drglaw",
    ]);
    const item = checkEntitySameAs(schema, true);
    expect(item.status).toBe("warn");
    // Exactly one directory surface (Google Maps) among the three URLs;
    // Instagram and LinkedIn count as hygiene, not directory coverage.
    expect(item.detail).toContain("1 directory surface");
  });
});

describe("deriveEligibilityGates + applyEligibilityCaps: the http-fallback path end to end (D1)", () => {
  const categoriesWithFailingHttps: CategoryResult[] = [
    {
      name: "Technical & Security",
      score: 0,
      maxScore: 10,
      items: [{ label: "HTTPS", status: "fail", detail: "Site loads over HTTP. Google penalises non-HTTPS sites." }],
    },
  ];

  it("deriveEligibilityGates returns httpsOk: false when Technical & Security's HTTPS item has status: fail", () => {
    const gates = deriveEligibilityGates(categoriesWithFailingHttps, "low");
    expect(gates.httpsOk).toBe(false);
  });

  it("applyEligibilityCaps caps a score of 88 to 50 using gates derived from a failing HTTPS item", () => {
    const gates = deriveEligibilityGates(categoriesWithFailingHttps, "low");
    expect(applyEligibilityCaps(88, gates)).toBe(50);
  });
});
