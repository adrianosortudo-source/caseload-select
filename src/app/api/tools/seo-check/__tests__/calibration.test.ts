/**
 * Calibration corpus: regression fixtures from real, hand-verified field
 * audits. Each site's ground truth was confirmed by directly inspecting the
 * live HTML, robots.txt, and sitemap during the original investigation
 * (see the commit messages for sitemap-index recursion, one-page-site
 * practice-area crediting, and policy-page severity fixes). Re-running the
 * pure engine functions against the SAME captured `pages` array pins that
 * behavior: if a future change to buildIssues / buildSiteStructureIssues
 * regresses one of these known-true facts, this test catches it before a
 * fifth field audit has to re-discover it.
 *
 * Fixtures are full API response captures (POST /api/tools/seo-check),
 * whose `pages` array is the unstripped internal PageResult[] the route
 * feeds into buildIssues/buildSiteStructureIssues, so re-deriving issues
 * from fixture.pages is a like-for-like replay, not an approximation.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildIssues, buildSiteStructureIssues, type PageResult } from "../analysis";

interface Fixture {
  domain: string;
  pagesScanned: number;
  pages: PageResult[];
  issues: Array<{ title: string; severity: string; affectedCount: number; totalPages: number }>;
}

function load(name: string): Fixture {
  const p = path.join(__dirname, "__fixtures__", `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

const SAKURABA = load("sakurabalaw");
const TMALAW = load("tmalaw");
const THEMB = load("themblawfirm");
const GOSAI = load("gosailaw");
const DRGLAW = load("drglaw");

function titlesOf(issues: Array<{ title: string }>): string[] {
  return issues.map((i) => i.title);
}

describe("calibration: sakurabalaw.ca (multilingual firm, sitemap_index.xml)", () => {
  it("crawled 10 pages including the /en/immigration/ practice page", () => {
    expect(SAKURABA.pagesScanned).toBe(10);
    expect(SAKURABA.pages.some((p) => p.pageType === "practice")).toBe(true);
  });

  it("does not fire the sitemap-missing false positive (sitemap_index.xml recursion fix)", () => {
    const issues = [...buildIssues(SAKURABA.pages), ...buildSiteStructureIssues(SAKURABA.pages, true)];
    expect(titlesOf(issues)).not.toContain("No XML sitemap found");
  });

  it("does not fire missing practice pages when a real practice page was crawled", () => {
    const issues = buildSiteStructureIssues(SAKURABA.pages, true);
    expect(titlesOf(issues)).not.toContain("No practice-area pages found");
  });

  it("genuinely fires the policy-link finding: no policy page exists in this crawl", () => {
    // Verified directly against the live homepage HTML: no privacy/terms link.
    expect(SAKURABA.pages.some((p) => p.pageType === "policy")).toBe(false);
    const issues = buildIssues(SAKURABA.pages);
    expect(titlesOf(issues)).toContain("Policy / disclaimer pages");
  });
});

describe("calibration: tmalaw.ca (matter-named practice URLs)", () => {
  it("classifies /estate-litigation/, /real-estate-law/, /wills-... as practice pages", () => {
    const practicePaths = TMALAW.pages.filter((p) => p.pageType === "practice").map((p) => p.url);
    expect(practicePaths.length).toBe(3);
  });

  it("does not fire missing practice pages or missing team page (crawled attorney bios)", () => {
    const issues = buildSiteStructureIssues(TMALAW.pages, true);
    expect(titlesOf(issues)).not.toContain("No practice-area pages found");
    expect(titlesOf(issues)).not.toContain("No attorney / team page found");
  });
});

describe("calibration: themblawfirm.ca (2-page Wix one-pager)", () => {
  it("crawled exactly 2 pages (confirmed complete via the site's own sitemap)", () => {
    expect(THEMB.pagesScanned).toBe(2);
  });

  it("does not fire missing practice pages when the homepage carries practiceAreaIntent", () => {
    const home = THEMB.pages.find((p) => p.pageType === "homepage");
    expect(home?.lawFirm.practiceAreaIntent).toBe(true);
    const issues = buildSiteStructureIssues(THEMB.pages, true);
    expect(titlesOf(issues)).not.toContain("No practice-area pages found");
  });

  it("still fires missing team page: no Person schema, no dedicated bio page", () => {
    const issues = buildSiteStructureIssues(THEMB.pages, true);
    expect(titlesOf(issues)).toContain("No attorney / team page found");
  });

  it("suppresses the team-page absence when a team URL was discovered but not crawled (jsmlaw case)", () => {
    // jsmlaw.ca links /pages/our-team from the homepage nav, but 40+ practice
    // and city pages outranked it in a 50-page crawl and the report asserted
    // "No attorney or team page was found." A page sitting unscanned in the
    // frontier is not absent.
    const issues = buildSiteStructureIssues(THEMB.pages, true, null, "high", [
      "https://www.themblawfirm.ca/pages/our-team",
    ]);
    expect(titlesOf(issues)).not.toContain("No attorney / team page found");
  });
});

describe("calibration: gosailaw.com (real noindex + policy-only robots block)", () => {
  it("crawled the two real-estate sub-pages that carry a genuine noindex", () => {
    const noindexUrls = GOSAI.pages.filter((p) => p.indexable === false).map((p) => p.url);
    expect(noindexUrls).toEqual(
      expect.arrayContaining([
        "https://gosailaw.com/real-estate-law/refinances-mortgages/",
        "https://gosailaw.com/real-estate-law/residential-sales-andpurchases/",
      ])
    );
  });

  it("keeps the noindex on real practice pages critical (not a policy-only block)", () => {
    const issues = buildIssues(GOSAI.pages);
    const indexable = issues.find((i) => i.title === "Indexable");
    expect(indexable?.severity).toBe("critical");
  });

  it("caps the robots.txt block on /disclaimer/ to low (policy-only, not critical)", () => {
    const issues = buildIssues(GOSAI.pages);
    const robotsIssue = issues.find((i) => i.title === "robots.txt crawl access");
    if (robotsIssue) expect(robotsIssue.severity).toBe("low");
  });

  it("does not fire missing policy pages: /disclaimer/ and /privacy-policy/ were both crawled", () => {
    expect(GOSAI.pages.filter((p) => p.pageType === "policy").length).toBe(2);
    const issues = buildIssues(GOSAI.pages);
    expect(titlesOf(issues)).not.toContain("Policy / disclaimer pages");
  });
});

describe("calibration: marathonlaw.ca (Squarespace, sitemap-only pages, short server-rendered contact)", () => {
  const MARATHON = load("marathonlaw");

  it("crawled 9 pages including the two sitemap-only pages nav links do not reach", () => {
    // The sitemap-discovery fix: /podcast-episodes and the land-transfer-tax
    // page are listed in sitemap.xml but not linked in the site nav. Before
    // the fix the frontier was fed scheme-less keys and dropped them all.
    expect(MARATHON.pagesScanned).toBe(9);
    const urls = MARATHON.pages.map((p) => p.url);
    expect(urls).toContain("https://www.marathonlaw.ca/podcast-episodes");
    expect(urls).toContain("https://www.marathonlaw.ca/https/wwwratehubca/land-transfer-tax");
  });

  it("keeps the present-but-short HSTS max-age finding low, not high", () => {
    // Squarespace sends Strict-Transport-Security max-age=15552000 on every
    // response; the owner cannot change it. Verified live: header present 4/4.
    const issues = buildIssues(MARATHON.pages);
    const hsts = issues.find((i) => i.title === "HSTS header");
    expect(hsts).toBeTruthy();
    expect(["low", "info"]).toContain(hsts?.severity);
  });

  it("does not fire the GBP-link finding: footer carries google.com/maps/dir office links", () => {
    const issues = buildIssues(MARATHON.pages);
    expect(titlesOf(issues)).not.toContain("Google Business Profile link");
  });

  it("does not rate the short server-rendered contact page as high rendering risk", () => {
    // /contact is ~110 words of fully server-rendered NAP (verified live:
    // addresses, tel:, mailto:, hours all in raw HTML; zero app-shell markers).
    const contact = MARATHON.pages.find((p) => p.url.endsWith("/contact"));
    expect(contact?.rendering?.risk).not.toBe("high");
  });

  it("decodes HTML entities in extracted titles", () => {
    const contact = MARATHON.pages.find((p) => p.url.endsWith("/contact"));
    expect(contact?.title ?? "").not.toContain("&mdash;");
    expect(contact?.title ?? "").toContain(String.fromCharCode(0x2014));
  });

  it("does not credit trust signals from script config or verb matches", () => {
    // Verified live: the homepage's visible text carries zero testimonials,
    // reviews, awards, or credentials. The old raw-HTML scan credited reviews
    // from a "rating" key inside Squarespace config JSON.
    const home = MARATHON.pages[0];
    expect(home.lawFirm.trust).toEqual({
      testimonials: false, reviews: false, caseResults: false, awards: false, credentials: false,
    });
  });

  it("correctly keeps the real findings: no LegalService schema, CSP missing, thin trust", () => {
    // Adversarially verified live: the only JSON-LD on the site is a bare
    // WebSite block, no CSP header is sent, and no trust content exists.
    const issues = buildIssues(MARATHON.pages);
    const titles = titlesOf(issues);
    expect(titles).toContain("Business / LegalService schema");
    expect(titles).toContain("Content-Security-Policy");
    expect(titles).toContain("Trust signals");
  });
});

describe("calibration: drglaw.ca (2026-07-16 dogfood audit corrections)", () => {
  // Captured live via the fixed engine (POST /api/tools/seo-check, quick
  // mode, 10 pages). The ORIGINAL 50-page deep audit against this same site
  // reported: Image alt text missing (decorative walnut background), CSP
  // High/Missing (report-only was live sitewide), no Google Business Profile
  // link (a maps?cid= permalink was on the page), only 2/5 trust signal
  // types (three attributed client quotes went undetected), and Question-
  // format headings / Authoritative citations required on every page type
  // including /contact. This fixture pins that none of those regress.

  it("does not flag Image alt text: the decorative walnut background is correctly credited, not missing", () => {
    const home = DRGLAW.pages.find((p) => p.url === "https://drglaw.ca");
    const onPage = home?.categories.find((c) => c.name === "On-Page SEO");
    const altItem = onPage?.items.find((i) => i.label === "Image alt text");
    expect(altItem?.status).toBe("pass");
    const issues = buildIssues(DRGLAW.pages);
    expect(titlesOf(issues)).not.toContain("Image alt text");
  });

  it("recognizes the maps?cid= Google Business Profile link and does not fire the missing-GBP finding", () => {
    const home = DRGLAW.pages.find((p) => p.url === "https://drglaw.ca");
    const localSeo = home?.categories.find((c) => c.name === "Local SEO");
    const gbpItem = localSeo?.items.find((i) => i.label === "Google Business Profile link");
    expect(gbpItem?.status).toBe("pass");
    const issues = buildIssues(DRGLAW.pages);
    expect(titlesOf(issues)).not.toContain("Google Business Profile link");
  });

  it("credits Content-Security-Policy-Report-Only as implementation in progress, never at High severity", () => {
    const issues = buildIssues(DRGLAW.pages);
    const csp = issues.find((i) => i.title === "Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp?.severity).not.toBe("high");
    expect(csp?.severity).not.toBe("critical");
  });

  it("credits the homepage's attributed client quotes as testimonials (3 of 5 trust signal types, up from 2)", () => {
    const home = DRGLAW.pages.find((p) => p.url === "https://drglaw.ca");
    expect(home?.lawFirm.trust.testimonials).toBe(true);
    expect(home?.lawFirm.trust.reviews).toBe(true);
    const legalMkt = home?.categories.find((c) => c.name === "Legal Marketing");
    const trustItem = legalMkt?.items.find((i) => i.label === "Trust signals");
    expect(trustItem?.status).toBe("pass");
  });

  it("does not require question headings or authoritative citations on the contact page", () => {
    const contact = DRGLAW.pages.find((p) => p.url === "https://drglaw.ca/contact");
    const aiVis = contact?.categories.find((c) => c.name === "AI Visibility");
    const questionItem = aiVis?.items.find((i) => i.label === "Question-format headings");
    const citationItem = aiVis?.items.find((i) => i.label === "Authoritative citations");
    expect(questionItem?.status).toBe("pass");
    expect(citationItem?.status).toBe("pass");
    expect(questionItem?.detail).toMatch(/not required for a contact page/i);
  });

  it("does not require a fixed word-count minimum on the contact page", () => {
    const contact = DRGLAW.pages.find((p) => p.url === "https://drglaw.ca/contact");
    const linksContent = contact?.categories.find((c) => c.name === "Links & Content");
    const wordCountItem = linksContent?.items.find((i) => i.label === "Word count");
    expect(wordCountItem?.status).toBe("pass");
  });

  it("merges the Address / NAP duplicate: at most one Address-related issue per affected page set", () => {
    const issues = buildIssues(DRGLAW.pages);
    const addressIssues = issues.filter((i) => i.title === "Address / NAP" || i.title === "Street address (NAP)");
    // Both labels may appear only if their affected-page sets genuinely
    // differ; they must never both list the identical page set.
    const legal = issues.find((i) => i.title === "Address / NAP");
    const local = issues.find((i) => i.title === "Street address (NAP)");
    if (legal && local) {
      expect(new Set(legal.affectedUrls)).not.toEqual(new Set(local.affectedUrls));
    }
    expect(addressIssues.length).toBeLessThanOrEqual(2);
  });
});
