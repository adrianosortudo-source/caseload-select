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
  scoreItems,
  type CategoryResult,
} from "../engine-core";
import { checkHreflang, checkSchemaMarkup, extractSchemaSummary } from "../route";

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
    // (fail), and "Breadcrumb schema" (warn, unaffected by this plan) — three
    // scored items at weight 10 each, none of them full-credit passes.
    // maxScore therefore does not reach the 8-item x 10 = 80 an unfixed
    // vacuous-pass engine would have produced.
    expect(result.maxScore).toBe(30);
    expect(result.maxScore).toBeLessThan(result.items.length * 10);
    expect(result.score).toBeLessThanOrEqual(result.maxScore);
  });
});
