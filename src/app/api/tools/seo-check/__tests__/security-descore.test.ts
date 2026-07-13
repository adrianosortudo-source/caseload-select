/**
 * Trust-fix pass WI-5: security-hygiene headers (CSP, HSTS, X-Content-Type-
 * Options) are shown and still generate issues-list findings at their
 * calibrated severities, but contribute nothing to the Technical & Security
 * category score. HTTPS and Mixed content remain scored: they directly
 * affect accessibility and search eligibility.
 *
 * See docs/SEO-TOOL-TRUST-FIX-PASS-v1.md.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => null }));

import { checkTechnicalSecurity } from "../route";
import { buildIssues, type PageResult } from "../analysis";
import type { CategoryResult } from "../engine-core";

const HTML_HTTPS_ONLY = `<html><head><meta name="viewport" content="width=device-width"></head><body></body></html>`;

function headersWith(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("security header items are excluded from the category score", () => {
  it("identical Technical & Security score with all three headers present vs all three absent", () => {
    const withHeaders = checkTechnicalSecurity(HTML_HTTPS_ONLY, "https://x.com/", headersWith({
      "strict-transport-security": "max-age=31536000",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'",
      "content-encoding": "gzip",
    }));
    const withoutHeaders = checkTechnicalSecurity(HTML_HTTPS_ONLY, "https://x.com/", headersWith({
      "content-encoding": "gzip",
    }));
    expect(withHeaders.score).toBe(withoutHeaders.score);
    expect(withHeaders.maxScore).toBe(withoutHeaders.maxScore);
  });

  it("CSP, HSTS (all three variants), and X-Content-Type-Options items all carry scored:false", () => {
    const cat = checkTechnicalSecurity(HTML_HTTPS_ONLY, "https://x.com/", headersWith({
      "strict-transport-security": "max-age=100",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'",
    }));
    for (const label of ["Content-Security-Policy", "HSTS header", "X-Content-Type-Options"]) {
      const item = cat.items.find((i) => i.label === label);
      expect(item?.scored, `${label} should be scored:false`).toBe(false);
    }
  });

  it("HTTPS and Mixed content remain scored (not flagged scored:false)", () => {
    const cat = checkTechnicalSecurity(HTML_HTTPS_ONLY, "https://x.com/", headersWith({}));
    const https = cat.items.find((i) => i.label === "HTTPS");
    const mixed = cat.items.find((i) => i.label === "Mixed content");
    expect(https?.scored).not.toBe(false);
    expect(mixed?.scored).not.toBe(false);
  });
});

describe("issues-list findings still fire for missing security headers", () => {
  const mkPage = (categories: CategoryResult[]): PageResult => ({
    url: "https://x.com/",
    title: "Home",
    pageType: "homepage",
    pageScore: 0,
    pageGrade: "A",
    aiVisibilityScore: 0,
    categories,
    failCount: 0,
    warnCount: 0,
    httpStatus: 200,
    indexable: true,
    indexability: {
      httpStatus: 200, redirected: false, redirectHops: 0, canonical: null, canonicalSelf: null,
      canonicalSameOrigin: null, metaNoindex: false, metaNofollow: false, headerNoindex: false,
      headerNofollow: false, indexable: true, inSitemap: null, mixedSignals: false,
    },
    schema: { blocks: 0, invalidBlocks: 0, types: [], hasOrganization: false, hasLocalBusiness: false, hasLegalService: false, hasAttorney: false, hasPerson: false, hasBreadcrumb: false, hasFaq: false, hasWebsite: false, hasReview: false, fields: { name: false, url: false, telephone: false, address: false, areaServed: false, sameAs: false, priceRange: false, openingHours: false }, conflictingEntity: false },
    lawFirm: { practiceAreaIntent: false, trust: { testimonials: false, reviews: false, caseResults: false, awards: false, credentials: false } } as PageResult["lawFirm"],
    wordCount: 0,
    keyWarnings: [],
  });

  it("missing CSP/HSTS/XCTO still produce findings in buildIssues despite being unscored", () => {
    const cat = checkTechnicalSecurity(HTML_HTTPS_ONLY, "https://x.com/", headersWith({}));
    const issues = buildIssues([mkPage([cat])]);
    const titles = issues.map((i) => i.title);
    expect(titles).toContain("Content-Security-Policy");
    expect(titles).toContain("HSTS header");
    expect(titles).toContain("X-Content-Type-Options");
  });
});
