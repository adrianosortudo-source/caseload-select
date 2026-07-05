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
