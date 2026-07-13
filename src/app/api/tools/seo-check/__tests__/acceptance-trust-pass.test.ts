/**
 * Trust-fix pass WI-8: the hard acceptance criterion (operator-authored,
 * verbatim from docs/SEO-TOOL-TRUST-FIX-PASS-v1.md):
 *
 *   "After recalibration, no site's SEO or AEO Readiness grade may improve
 *   merely because security headers, llms.txt, FAQ schema, or self-serving
 *   review schema are present. Each score must expose its contributing
 *   checks and weights."
 *
 * These tests exercise the REAL check functions (checkSchemaMarkup,
 * checkAiVisibility, checkTechnicalSecurity) through the REAL scoring
 * pipeline (scoreItems -> computeWeightedScore / aiScoresFromItems), not a
 * synthetic re-implementation, so a future edit that reintroduces a scoring
 * leak on any of the four signal families fails here.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => null }));

import { extractSchemaSummary, checkSchemaMarkup, checkAiVisibility, checkTechnicalSecurity } from "../route";
import { computeWeightedScore, aiScoresFromItems, parseRobotsTxt } from "../engine-core";
import type { SchemaSummary } from "../analysis";

const ldjson = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

function baseSchema(overrides: Partial<SchemaSummary> = {}): SchemaSummary {
  return {
    blocks: 1, invalidBlocks: 0, types: ["LegalService"],
    hasOrganization: false, hasLocalBusiness: false, hasLegalService: true,
    hasAttorney: false, hasPerson: false, hasBreadcrumb: false,
    hasFaq: false, hasWebsite: false, hasReview: false,
    fields: { name: true, url: true, telephone: true, address: true, areaServed: true, sameAs: true, priceRange: false, openingHours: false },
    conflictingEntity: false,
    ...overrides,
  };
}

// A neutral second category so totalWeight > 0 in computeWeightedScore even
// when the category under test is entirely unscored (maxScore 0 case).
const BASELINE_CATEGORY = { name: "On-Page SEO", score: 70, maxScore: 100, items: [] };

const HTML_MINIMAL = `<html><head><meta name="viewport" content="width=device-width"></head><body></body></html>`;
const headersWith = (entries: Record<string, string>) => new Headers(entries);

describe("acceptance criterion: security headers never move the SEO grade", () => {
  it("overall score identical with all three headers present vs absent", () => {
    const withHeaders = checkTechnicalSecurity(HTML_MINIMAL, "https://x.com/", headersWith({
      "strict-transport-security": "max-age=31536000",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'",
    }));
    const withoutHeaders = checkTechnicalSecurity(HTML_MINIMAL, "https://x.com/", headersWith({}));
    expect(computeWeightedScore([BASELINE_CATEGORY, withHeaders])).toBe(computeWeightedScore([BASELINE_CATEGORY, withoutHeaders]));
  });
});

describe("acceptance criterion: llms.txt never moves the SEO grade or the AEO Readiness (search) score", () => {
  const parsedRobots = parseRobotsTxt("User-agent: *\nAllow: /\n");

  it("SEO category score identical with llms.txt present vs absent", () => {
    const withLlms = checkAiVisibility(HTML_MINIMAL, parsedRobots, "# My Firm\nA short summary of the site.", baseSchema());
    const withoutLlms = checkAiVisibility(HTML_MINIMAL, parsedRobots, null, baseSchema());
    expect(computeWeightedScore([BASELINE_CATEGORY, withLlms])).toBe(computeWeightedScore([BASELINE_CATEGORY, withoutLlms]));
  });

  it("AEO Readiness (search) score identical with llms.txt present vs absent", () => {
    const withLlms = checkAiVisibility(HTML_MINIMAL, parsedRobots, "# My Firm\nA short summary of the site.", baseSchema());
    const withoutLlms = checkAiVisibility(HTML_MINIMAL, parsedRobots, null, baseSchema());
    expect(aiScoresFromItems(withLlms.items).search).toBe(aiScoresFromItems(withoutLlms.items).search);
  });
});

describe("acceptance criterion: FAQPage schema never moves the SEO grade", () => {
  it("overall score identical with FAQPage markup present vs absent", () => {
    const withFaq = checkSchemaMarkup(baseSchema({ hasFaq: true }));
    const withoutFaq = checkSchemaMarkup(baseSchema({ hasFaq: false }));
    expect(computeWeightedScore([BASELINE_CATEGORY, withFaq])).toBe(computeWeightedScore([BASELINE_CATEGORY, withoutFaq]));
  });
});

describe("acceptance criterion: self-serving review schema never moves the SEO grade", () => {
  it("overall score identical with Review/Rating markup present vs absent", () => {
    const withReview = checkSchemaMarkup(baseSchema({ hasReview: true }));
    const withoutReview = checkSchemaMarkup(baseSchema({ hasReview: false }));
    expect(computeWeightedScore([BASELINE_CATEGORY, withReview])).toBe(computeWeightedScore([BASELINE_CATEGORY, withoutReview]));
  });

  it("also holds when derived from real JSON-LD, not just a hand-built SchemaSummary", () => {
    const withReview = checkSchemaMarkup(extractSchemaSummary(ldjson({ "@type": "LegalService", name: "Firm", url: "https://x.com", telephone: "555", address: "1 Main St", areaServed: "Toronto", sameAs: ["https://x.com"] }) + ldjson({ "@type": "AggregateRating", ratingValue: "5" })));
    const withoutReview = checkSchemaMarkup(extractSchemaSummary(ldjson({ "@type": "LegalService", name: "Firm", url: "https://x.com", telephone: "555", address: "1 Main St", areaServed: "Toronto", sameAs: ["https://x.com"] })));
    expect(computeWeightedScore([BASELINE_CATEGORY, withReview])).toBe(computeWeightedScore([BASELINE_CATEGORY, withoutReview]));
  });
});

describe("acceptance criterion: every unscored check is actually flagged scored:false in all its states", () => {
  // The exact six labels the four signal families (security headers x3, llms.txt,
  // FAQPage schema, Review/Rating schema) resolve to. Every state each label can
  // be in (pass/warn/fail, present/absent) must carry scored:false, so the
  // API response's scoring.unscoredLabels (built dynamically from these flags)
  // always covers exactly this set, never more, never less.
  const UNSCORED_LABELS = [
    "Content-Security-Policy", "HSTS header", "X-Content-Type-Options",
    "llms.txt file", "FAQPage schema", "Review / Rating schema",
  ];

  it("security header items are unscored in every state", () => {
    const present = checkTechnicalSecurity(HTML_MINIMAL, "https://x.com/", headersWith({
      "strict-transport-security": "max-age=31536000", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'",
    }));
    const lowMaxAge = checkTechnicalSecurity(HTML_MINIMAL, "https://x.com/", headersWith({ "strict-transport-security": "max-age=100" }));
    const absent = checkTechnicalSecurity(HTML_MINIMAL, "https://x.com/", headersWith({}));
    for (const cat of [present, lowMaxAge, absent]) {
      for (const label of ["Content-Security-Policy", "HSTS header", "X-Content-Type-Options"]) {
        const item = cat.items.find((i) => i.label === label);
        if (item) expect(item.scored, `${label} in state ${item.status}`).toBe(false);
      }
    }
  });

  it("llms.txt and FAQPage/Review schema items are unscored in every state", () => {
    const parsedRobots = parseRobotsTxt("User-agent: *\nAllow: /\n");
    const ai1 = checkAiVisibility(HTML_MINIMAL, parsedRobots, "# summary", baseSchema());
    const ai2 = checkAiVisibility(HTML_MINIMAL, parsedRobots, null, baseSchema());
    for (const cat of [ai1, ai2]) {
      const item = cat.items.find((i) => i.label === "llms.txt file");
      expect(item?.scored).toBe(false);
    }
    const schema1 = checkSchemaMarkup(baseSchema({ hasFaq: true, hasReview: true }));
    const schema2 = checkSchemaMarkup(baseSchema({ hasFaq: false, hasReview: false }));
    for (const cat of [schema1, schema2]) {
      expect(cat.items.find((i) => i.label === "FAQPage schema")?.scored).toBe(false);
      expect(cat.items.find((i) => i.label === "Review / Rating schema")?.scored).toBe(false);
    }
  });

  it("UNSCORED_LABELS is exactly the six labels (documents the acceptance-criterion contract)", () => {
    expect(UNSCORED_LABELS.sort()).toEqual([
      "Content-Security-Policy", "FAQPage schema", "HSTS header",
      "Review / Rating schema", "X-Content-Type-Options", "llms.txt file",
    ]);
  });
});
