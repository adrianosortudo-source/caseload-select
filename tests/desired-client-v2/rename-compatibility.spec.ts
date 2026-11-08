import { expect, test } from "@playwright/test";
import { completeAnswers } from "../../src/lib/desired-client/__tests__/blueprint-helpers";
import { layout } from "./helpers";
import { buildStructuredBlueprintV4 } from "../../src/lib/desired-client/structured-blueprint";

test("the new name and legacy address share the same tool and framing policy", async ({ page }) => {
  for (const route of ["/tools/desired-client-matter", "/tools/best-cases-profile"]) {
    const response = await page.goto(route + "?embed=1");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-frame-options"]).toBeUndefined();
    expect(response?.headers()["content-security-policy"]).toContain("https://caseloadselect.ca");
    await expect(page).toHaveTitle("Best Cases Profile | CaseLoad Select");
    await expect(page.getByRole("button", { name: "Build my profile", exact: true }).first()).toBeVisible();
    await expect(page.getByText("What is Best Cases Profile?", { exact: true })).toBeVisible();
  }
});

test("a reviewed saved report survives navigation from the old address to the new one", async ({ page }) => {
  let analysisCalls = 0;
  await page.route("**/api/tools/desired-client-matter/analyze", async route => {
    if (route.request().method() === "POST") analysisCalls++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false }) });
  });
  const answers = completeAnswers();
  const now = Date.now();
  const draft = {
    schemaVersion: 2, answers, currentStage: 7,
    lastEditedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 86400000).toISOString(),
    savedBrief: {
      brief: buildStructuredBlueprintV4(answers),
      sourceAnswersSnapshot: structuredClone(answers), sourceAnswersVersion: "dcm-v3.3",
      sourceBriefRevision: answers.revision, generatedAt: new Date(now).toISOString(),
      wordingReviewed: true, mode: "structured",
    },
  };
  await page.goto("/tools/desired-client-matter");
  await page.evaluate(value => localStorage.setItem("cls-desired-client-v2", JSON.stringify(value)), draft);
  await page.goto("/tools/best-cases-profile");
  await expect(page.getByRole("button", { name: "Continue my saved draft", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue my saved draft", exact: true }).click();
  await expect(page.locator(".dc-brief")).toContainText("BEST CASES PROFILE");
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("cls-desired-client-v2")!));
  expect(restored.answers).toEqual(draft.answers);
  expect(restored.savedBrief).toEqual(draft.savedBrief);
  expect(restored.expiresAt).toBe(draft.expiresAt);
  expect(analysisCalls).toBe(0);
});

test("the confidentiality reminder reflows in the 320px public wrapper", async ({ page }) => {
  // The wrapper's 16px sides and iframe borders leave a 286px child viewport.
  await page.setViewportSize({ width: 286, height: 1000 });
  await page.goto("/tools/best-cases-profile?embed=1");
  await layout(page, ".closing [data-ui-copy]");
});
