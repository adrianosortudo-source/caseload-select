import { expect, test } from "@playwright/test";
import { renderedCopyFailures, renderedManifest, useSyntheticOperator } from "./browser-support";

// Public facts from operations/luna_continuous_v1/control/evidence/
// sobirovs_coordinator_readback_20260924_v1.json (read-back 2026-09-24).
test("the linked firm profile shows retained Sobirovs facts at six widths", async ({ page, context }, testInfo) => {
  await useSyntheticOperator(context, renderedManifest());
  const firmId = "8d892094-f43b-48bb-aa51-eee5766dabbe";
  const assessment = {
    id: "7fc25a5c-21aa-4e14-b895-ef1dd3b0f14f", table: "gta_prospect_qualification_assessments",
    data: { id: "7fc25a5c-21aa-4e14-b895-ef1dd3b0f14f", firm_id: firmId, qualification_state: "qualified", assessed_on: "2026-09-24", criteria: { record: {
      lawyerCount: { count: 3, sourceUrl: "https://sobirovs.com/about-us/our-team/", observedAt: "2026-09-24" },
      decisionMaker: { name: "Rakhmad Sobirov", role: "Co-Founder and Managing Lawyer", authorityEvidence: { sourceUrl: "https://sobirovs.com/about-us/careers/", observedAt: "2026-09-24" } },
      email: { address: "rakhmad@sobirovs.com", attributedTo: "Rakhmad Sobirov", sourceUrl: "https://sobirovs.com/team/rakhmad-sobirov/", observedAt: "2026-09-24" },
      advertising: { status: "pixels-detected", recentAdStatus: "not-verified", observations: [{ vendor: "google_ads", kind: "conversion-tag", identifier: "AW-378398717", sourceUrl: "https://sobirovs.com/", observedAt: "2026-09-24" }] },
    } } },
    semanticSha256: "a".repeat(64), date: { observedAt: null, observedOn: "2026-09-24", precision: "date_only" },
    dateLabel: "Observed September 24, 2026", freshness: "current", sourceUrls: [], legacyCriteria: [],
    qualificationCategory: "Qualified", enrichment: [], retractions: [], profileSource: null,
  };
  const detail = {
    firm: { id: firmId, displayName: "Sobirovs Professional Corporation", websiteUrl: "https://sobirovs.com/", sourceRecordKey: "luna-whole-firm-sobirovs-com-2026-09-24", revision: "receipt-backed-preview" },
    sections: [{ key: "qualification", title: "Qualification", state: "available", items: [assessment], errorId: null, incomplete: false, nextCursors: {} }],
    complete: true, revisionStable: true, profileChoices: [], readAt: "2026-09-24T09:21:48Z", rendererVersion: "prospect-enrichment/v1",
  };
  await page.route("**/api/admin/prospect-enrichment/firms/**", route => route.fulfill({ json: { firm: detail } }));
  await page.route("**/api/admin/prospect-enrichment/candidates?**", route => route.fulfill({ json: { coverageRevision: 1, readWarnings: [], complete: true, items: [], nextCursor: null, inventoryCount: 0, filteredCount: 0 } }));

  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/admin/prospects/firms/${firmId}`);
    const profile = page.getByTestId("prospect-research-detail");
    await expect(profile.getByRole("heading", { name: "Sobirovs Professional Corporation" })).toBeVisible();
    for (const text of ["Observed lawyer count", "Named owner or decision maker", "Attributed direct email", "Advertising signal status", "Advertising signals and sources", "Roster observed", "Email observed"]) {
      await expect(profile.getByText(text, { exact: true })).toBeVisible();
    }
    for (const value of ["Rakhmad Sobirov", "rakhmad@sobirovs.com", "AW-378398717", "2026-09-24"]) {
      await expect(profile.getByText(value, { exact: true }).first()).toBeVisible();
    }
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await renderedCopyFailures(page), `${width}px firm research`).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${width}-sobirovs-firm-research.png`), fullPage: true });
  }
});
