import { expect, test } from "@playwright/test";
import { completeAnswers, validBlueprint } from "../../src/lib/desired-client/__tests__/blueprint-helpers";

const route = "**/api/tools/desired-client-matter/analyze";
const storageKey = "cls-desired-client-v2";
const answers = completeAnswers();
const result = validBlueprint();

test("a reviewed six-section draft becomes a synthesized blueprint and HTML report", async ({ page }) => {
  let analysisCalls = 0;
  await page.addInitScript(({ key, savedAnswers }) => {
    const now = Date.now();
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      answers: savedAnswers,
      currentStage: 7,
      lastEditedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
    }));
  }, { key: storageKey, savedAnswers: answers });

  await page.route(route, async requestRoute => {
    analysisCalls += 1;
    const request = requestRoute.request().postDataJSON();
    await requestRoute.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: request.requestId,
        answerRevision: request.answerRevision,
        reviewRunId: request.reviewRunId,
        result,
      }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Continue my saved draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your direction", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create my Desired Client Blueprint", exact: true }).click();

  const blueprintTitle = page.getByRole("heading", { level: 1 });
  await expect(blueprintTitle).toBeVisible();
  await expect(blueprintTitle).toContainText("Business & commercial");
  await expect(page.getByText(result.brief.definition_sentence, { exact: true })).toBeVisible();
  await expect(page.getByText("Our desired-client definition", { exact: true })).toBeVisible();
  await expect(page.getByText("Points still to resolve", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download HTML report", exact: true })).toBeVisible();
  expect(analysisCalls).toBe(1);

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML report", exact: true }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const path = await download.path();
  const html = await import("node:fs/promises").then(fs => fs.readFile(path!, "utf8"));
  expect(html).toContain("Desired Client Blueprint");
  const exportedDefinition = html.match(/<section class="definition"><h2>Our desired-client definition<\/h2><p>([\s\S]*?)<\/p><\/section>/)?.[1];
  expect(exportedDefinition).toBeDefined();
  const plainDefinition = exportedDefinition!
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  expect(plainDefinition).toBe(result.brief.definition_sentence);
});
