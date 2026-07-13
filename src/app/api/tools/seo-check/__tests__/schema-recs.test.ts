/**
 * Trust-fix pass WI-2 (review schema) + WI-3 (FAQPage schema).
 *
 * WI-2: presence of Review/Rating schema is the flag (self-serving markup on
 * a firm's own site is ineligible for Google review stars), never absence.
 * Neither direction moves any score.
 *
 * WI-3: FAQPage schema is unscored and neutral in both directions. Google
 * limited FAQ rich results to government and health sites in 2023, so
 * presence is not a win and absence is not a defect.
 *
 * See docs/SEO-TOOL-TRUST-FIX-PASS-v1.md.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => null }));

import { extractSchemaSummary, checkSchemaMarkup } from "../route";
import type { SchemaSummary } from "../analysis";

const ldjson = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// A baseline SchemaSummary held otherwise constant, so isolated true/false
// flips on hasReview / hasFaq are the ONLY variable between two comparisons.
// (Deriving two summaries from unrelated JSON-LD blocks, e.g. AggregateRating-
// only vs LegalService-only, changes many other fields too and produces a
// real score delta unrelated to the flag under test.)
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

describe("Review / Rating schema recommendation", () => {
  it("presence yields a warn(unscored) item; detail says ineligible, fix does not say 'add review schema'", () => {
    const cat = checkSchemaMarkup(baseSchema({ hasReview: true }));
    const item = cat.items.find((i) => i.label === "Review / Rating schema");
    expect(item).toBeTruthy();
    expect(item?.status).toBe("warn");
    expect(item?.scored).toBe(false);
    expect(item?.detail).toMatch(/ineligible/i);
    expect(item?.fix).not.toMatch(/add aggregaterating or review schema/i);
  });

  it("absence yields a neutral pass(unscored) item with no recommendation to add markup", () => {
    const cat = checkSchemaMarkup(baseSchema({ hasReview: false }));
    const item = cat.items.find((i) => i.label === "Review / Rating schema");
    expect(item).toBeTruthy();
    expect(item?.status).toBe("pass");
    expect(item?.scored).toBe(false);
    expect(item?.fix).toBeUndefined();
  });

  it("category score is identical whether review markup is present or absent (all else equal)", () => {
    const withReview = checkSchemaMarkup(baseSchema({ hasReview: true }));
    const withoutReview = checkSchemaMarkup(baseSchema({ hasReview: false }));
    expect(withReview.score).toBe(withoutReview.score);
    expect(withReview.maxScore).toBe(withoutReview.maxScore);
  });
});

describe("FAQPage schema is unscored and neutral both directions", () => {
  it("presence is pass, unscored, and does not claim a rich-result win", () => {
    const cat = checkSchemaMarkup(baseSchema({ hasFaq: true }));
    const item = cat.items.find((i) => i.label === "FAQPage schema");
    expect(item?.status).toBe("pass");
    expect(item?.scored).toBe(false);
    expect(item?.detail).not.toMatch(/supports faq readiness/i);
  });

  it("absence is pass, unscored, and issues no fix recommendation", () => {
    const cat = checkSchemaMarkup(baseSchema({ hasFaq: false }));
    const item = cat.items.find((i) => i.label === "FAQPage schema");
    expect(item?.status).toBe("pass");
    expect(item?.scored).toBe(false);
    expect(item?.fix).toBeUndefined();
  });

  it("category score is identical whether FAQPage markup is present or absent (all else equal)", () => {
    const withFaq = checkSchemaMarkup(baseSchema({ hasFaq: true }));
    const withoutFaq = checkSchemaMarkup(baseSchema({ hasFaq: false }));
    expect(withFaq.score).toBe(withoutFaq.score);
    expect(withFaq.maxScore).toBe(withoutFaq.maxScore);
  });
});
