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
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(page.getByTestId("candidate-summary")).toHaveCount(8);
    await page.getByLabel("Original status", { exact: true }).fill("not_selected");
    await page.getByRole("button", { name: "Search candidates", exact: true }).click();
    await expect(page.getByTestId("candidate-summary")).toHaveCount(1);
    await expect(page.getByTestId("candidate-summary")).toContainText("needs_evidence");
    await expect(page).toHaveURL(/cr_originalStatus=not_selected/);
    await page.getByRole("button", { name: "Clear research filters" }).click();
    await expect(page).not.toHaveURL(/cr_originalStatus=/);
    await expect(page.getByTestId("candidate-summary")).toHaveCount(8);
    await page.goBack(); await expect(page.getByTestId("candidate-summary")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear research filters" }).click();
    await expect(page).not.toHaveURL(/cr_originalStatus=/);
    await expect(page.getByTestId("candidate-summary")).toHaveCount(8);
    await page.getByLabel("Research field (JSON pointer)", { exact: true }).fill("/unknownFact");
    await page.getByLabel("Exact field value (JSON)", { exact: true }).fill("false");
    await page.getByRole("button", { name: "Search candidates", exact: true }).click();
    await expect(page.getByTestId("candidate-summary")).toHaveCount(8);
    expect(await renderedCopyFailures(page)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(width + "-candidate-list.png"), fullPage: true });
    for (const candidate of candidateSummaries) {
      await page.goto("/dev/prospect-candidate-preview?candidateId=" + candidate.id);
      await expect(page.getByRole("heading", { level: 2, name: "Candidate research", exact: true })).toBeVisible();
      await expect(page.getByTestId("candidate-research-name")).toHaveText(candidate.displayName);
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
      await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      expect(await renderedCopyFailures(page), width + "px / " + candidate.displayName).toEqual([]);
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
  await expect(page.getByRole("heading", { name: "Candidate research", exact: true })).toBeVisible();
  await expect(page.getByTestId("candidate-research-name")).toHaveText(candidate.displayName);
  await expect(page.getByTestId("candidate-revision").first()).toBeVisible();
  await page.getByTestId("candidate-revision").first().getByText("Evidence, exact fields and original revision", { exact: true }).click();
  await expect(page.getByTestId("candidate-revision").first().getByText("Complete original JSON", { exact: true })).toBeVisible();
  const history = await page.request.get(`/api/admin/prospect-enrichment/candidates/${candidate.id}/history?coverageRevision=${list.coverageRevision}`);
  expect(history.status()).toBe(200); const body = await history.json(); expect(body.items.length).toBeGreaterThan(0); expect(body.items.every((item: { candidateId: string }) => item.candidateId === candidate.id)).toBe(true);
  const firmResponse = await page.request.get(`/api/admin/prospect-enrichment/candidates?firmId=${manifest.firmId}`);
  expect(firmResponse.status()).toBe(200); const linked = await firmResponse.json();
  expect(linked.items.length).toBeGreaterThan(0);
  expect(linked.items.every((item: { verifiedFirmId: string; identityState: string }) => item.verifiedFirmId === manifest.firmId && item.identityState === "resolved")).toBe(true);
  await page.goto(`/admin/prospects/firms/${manifest.firmId}`);
  await expect(page.getByRole("heading", { name: "Research for this firm", exact: true })).toBeVisible();
  const linkedSummary = page.getByTestId("candidate-summary").filter({ hasText: linked.items[0].identityKey }).first();
  await expect(linkedSummary).toBeVisible();
  await linkedSummary.getByText("Research revisions and source evidence", { exact: true }).click();
  await expect(linkedSummary.getByTestId("candidate-revision").first()).toBeVisible();

});

test("reviewed firm identity links to the existing firm profile route", async ({ page }) => {
  const fixture = candidateDetail(candidateSummaries[0].id), firmId = "84000000-0000-4000-8000-000000000001";
  await page.route("**/api/admin/prospect-enrichment/candidates/**", route => route.fulfill({ json: route.request().url().includes("/history") ? candidateHistory(fixture.candidate.id) : { ...fixture, candidate: { ...fixture.candidate, identityState: "resolved", verifiedFirmId: firmId } } }));
  await page.goto("/dev/prospect-candidate-preview?candidateId=" + fixture.candidate.id);
  await expect(page.getByRole("link", { name: firmId, exact: true })).toHaveAttribute("href", "/admin/prospects/firms/" + firmId);
});


test("canonical firm profile searches linked producers and retains retracted choices at six widths", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const firmId = "84000000-0000-4000-8000-000000000001";
  const linked = [candidateSummaries[0], candidateSummaries[2]].map((candidate, index) => ({ ...candidate, identityNamespace: `source:producer-${index}`, identityState: "resolved" as const, verifiedFirmId: firmId, readWarnings: [] }));
  const requests: URL[] = [];
  await page.route("**/api/admin/prospect-enrichment/candidates**", async route => {
    const url = new URL(route.request().url()), id = url.pathname.split("/")[5]; requests.push(url);
    if (id) {
      const candidate = linked.find(item => item.id === id)!;
      const choice = { selected_value: false, evidenceState: "retracted", retractions: [{ event_type: "evidence_retracted", reason: "Synthetic source withdrawn", replacementSources: [], replacementSourceState: "not_recorded" }] };
      await route.fulfill({ json: url.pathname.endsWith("/history") ? candidateHistory(id) : { ...candidateDetail(id), candidate, profileChoices: [choice] } }); return;
    }
    expect(url.searchParams.get("firmId")).toBe(firmId);
    await route.fulfill({ json: { ...candidateList, items: linked, filteredCount: linked.length } });
  });
  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/dev/prospect-candidate-preview?firmId=${firmId}&cr_firmId=85000000-0000-4000-8000-000000000001`);
    await expect(page.getByRole("heading", { name: "Synthetic verified firm", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Research for this firm", exact: true })).toBeVisible();
    await expect(page.getByLabel("Verified firm ID", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("candidate-summary")).toHaveCount(2);
    await page.getByLabel("Search all research", { exact: true }).fill("source evidence");
    await page.getByRole("button", { name: "Search candidates", exact: true }).click();
    await expect(page).toHaveURL(/cr_text=source\+evidence/);
    await expect(page.getByTestId("candidate-summary")).toHaveCount(2);
    await page.getByRole("button", { name: "Clear research filters" }).click();
    await expect(page).not.toHaveURL(/cr_text=/);
    await expect(page).toHaveURL(new RegExp("cr_firmId=" + firmId));
    await expect(page.getByTestId("candidate-summary")).toHaveCount(2);
    for (let index = 0; index < linked.length; index++) {
      const summary = page.getByTestId("candidate-summary").nth(index);
      await expect(summary).toContainText(linked[index].originalStatuses[0]);
      await summary.getByText("Research revisions and source evidence", { exact: true }).click();
      await expect(summary.getByTestId("candidate-research-name")).toHaveText(linked[index].displayName);
      await expect(summary.getByText("Retracted finding", { exact: true })).toBeVisible();
      await expect(summary.getByText("No current value selected.", { exact: false })).toBeVisible();
      await summary.getByText("Complete choice and source history", { exact: true }).click();
      await expect(summary.getByText("Synthetic source withdrawn", { exact: true })).toBeVisible();
      await expect(summary.getByRole("link", { name: "Search all research for this firm", exact: true })).toHaveAttribute("href", `/admin/prospects/candidates?cr_firmId=${firmId}`);
      await summary.getByTestId("candidate-revision").first().getByText("Evidence, exact fields and original revision", { exact: true }).click();
      await expect(summary.getByRole("link", { name: "https://synthetic.example.test/research", exact: true })).toBeVisible();
    }
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await renderedCopyFailures(page), width + "px linked firm profile").toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(width + "-firm-candidate-profile.png"), fullPage: true });
  }
  expect(requests.some(url => url.searchParams.get("text") === "source evidence")).toBe(true);
});
