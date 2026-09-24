import { expect, test } from "@playwright/test";
import { candidateDetail, candidateHistory, candidateList, candidateSummaries } from "./candidate-fixtures";
import { renderedCopyFailures, renderedManifest, useSyntheticOperator } from "./browser-support";

test("every disposition remains searchable and readable at six widths", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/admin/prospect-enrichment/candidates**", async route => {
    const url = new URL(route.request().url()), id = url.pathname.split("/")[5];
    if (id) { await route.fulfill({ json: url.pathname.endsWith("/history") ? candidateHistory(id) : candidateDetail(id) }); return; }
    const status = url.searchParams.get("originalStatus"), text = url.searchParams.get("text"), fieldValue = url.searchParams.get("fieldValue");
    const items = candidateSummaries.filter(candidate => (!status || candidate.originalStatuses.includes(status)) && (!text || JSON.stringify(candidateHistory(candidate.id)).includes(text)) && (!fieldValue || fieldValue === "false"));
    await route.fulfill({ json: { ...candidateList, items, filteredCount: items.length } });
  });
  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/dev/prospect-candidate-preview");
    await expect(page.getByTestId("candidate-summary")).toHaveCount(8);
    await page.getByLabel("Original status", { exact: true }).fill("not_selected");
    await page.getByRole("button", { name: "Search candidates", exact: true }).click();
    await expect(page.getByTestId("candidate-summary")).toHaveCount(1);
    await expect(page.getByTestId("candidate-summary")).toContainText("needs_evidence");
    await expect(page).toHaveURL(/cr_originalStatus=not_selected/);
    await page.getByRole("button", { name: "Clear research filters" }).click();
    await expect(page.getByTestId("candidate-summary")).toHaveCount(8);
    await page.goBack(); await expect(page.getByTestId("candidate-summary")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear research filters" }).click();
    await page.getByLabel("Research field (JSON pointer)", { exact: true }).fill("/unknownFact");
    await page.getByLabel("Exact field value (JSON)", { exact: true }).fill("false");
    await page.getByRole("button", { name: "Search candidates", exact: true }).click();
    await expect(page.getByTestId("candidate-summary")).toHaveCount(8);
    expect(await renderedCopyFailures(page)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(width + "-candidate-list.png"), fullPage: true });
    for (const candidate of candidateSummaries) {
      await page.goto("/dev/prospect-candidate-preview?candidateId=" + candidate.id);
      await expect(page.getByRole("heading", { level: 2, name: candidate.displayName })).toBeVisible();
      await expect(page.getByText("Not linked to a verified firm", { exact: true })).toBeVisible();
      await expect(page.getByTestId("candidate-revision")).toHaveCount(2);
      const revision = page.getByTestId("candidate-revision").first();
      await revision.getByText("Evidence, exact fields and original revision", { exact: true }).click();
      await expect(revision.getByText("/unknownFact", { exact: false }).first()).toBeVisible();
      await expect(revision.getByRole("link", { name: "https://synthetic.example.test/research", exact: true })).toBeVisible();
      await revision.getByText("Complete original JSON", { exact: true }).click();
      await expect(revision.getByText("Consent", { exact: true })).toBeVisible();
      await expect(revision.getByText("needs_evidence", { exact: true }).first()).toBeVisible();
      await expect(revision.getByText("False", { exact: true }).first()).toBeVisible();
      expect(await renderedCopyFailures(page)).toEqual([]);
      if (candidate.originalStatuses[0] === "not_selected") await page.screenshot({ path: testInfo.outputPath(width + "-candidate-profile.png"), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test("authenticated candidate UI reads the transactional disposable database projection", async ({ page, context }) => {
  const manifest = renderedManifest(); await useSyntheticOperator(context, manifest);
  const response = await page.request.get("/api/admin/prospect-enrichment/candidates?limit=100");
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  const list = await response.json(); expect(list.inventoryCount).toBeGreaterThan(0); expect(list.items.length).toBeGreaterThan(0);
  const candidate = list.items.find((item: { revisionCount: number }) => item.revisionCount > 0); expect(candidate).toBeTruthy();
  await page.goto("/admin/prospects/candidates?cr_text=" + encodeURIComponent(candidate.identityKey));
  await expect(page.getByRole("heading", { name: "All researched candidates" })).toBeVisible();
  await page.getByRole("link", { name: candidate.displayName, exact: true }).first().click();
  await expect(page.getByRole("heading", { name: candidate.displayName, exact: true })).toBeVisible();
  await expect(page.getByTestId("candidate-revision").first()).toBeVisible();
  await page.getByTestId("candidate-revision").first().getByText("Evidence, exact fields and original revision", { exact: true }).click();
  await expect(page.getByTestId("candidate-revision").first().getByText("Complete original JSON", { exact: true })).toBeVisible();
  const history = await page.request.get(`/api/admin/prospect-enrichment/candidates/${candidate.id}/history?coverageRevision=${list.coverageRevision}`);
  expect(history.status()).toBe(200); const body = await history.json(); expect(body.items.length).toBeGreaterThan(0); expect(body.items.every((item: { candidateId: string }) => item.candidateId === candidate.id)).toBe(true);
});
