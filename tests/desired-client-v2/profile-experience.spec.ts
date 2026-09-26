import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { capture, choose, layout, next } from "./helpers";

test("optional question groups stay visible and a basic result offers an AI profile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Begin with a basic summary" }).click();
  await choose(page, "Business & commercial");
  await choose(page, "Commercial agreement drafting and review");
  await choose(page, "We already do it and want more");
  await next(page);
  await choose(page, "Before a planned decision or change");
  await choose(page, "Business or organization");
  await expect(page.getByRole("heading", { name: "First contact (optional)" })).toBeVisible();
  await expect(page.getByLabel("Who makes the first contact?").first()).toBeVisible();
  await next(page);
  await choose(page, "Complete a planned transaction or process");
  await expect(page.getByRole("heading", { name: "Client concerns (optional)" })).toBeVisible();
  await expect(page.getByLabel("I'm worried about the cost")).toBeVisible();
  await next(page);
  await choose(page, "It uses work we do well");
  await choose(page, "Usually worthwhile");
  await expect(page.getByRole("heading", { name: "Commercial detail (optional)" })).toBeVisible();
  await expect(page.getByText("Typical total team time")).toBeVisible();
  await next(page);
  await choose(page, "Yes, with the current team");
  await expect(page.getByRole("heading", { name: "Important limit (optional)" })).toBeVisible();
  await expect(page.getByLabel("Too little preparation time")).toBeVisible();
  await layout(page);
  await capture(page, "profile-experience-375-delivery");
  await next(page);
  await choose(page, "More of the work we already handle well");
  await choose(page, "Several matters we have handled");
  await expect(page.getByRole("heading", { name: "Work to promote less (optional)" })).toBeVisible();
  await expect(page.getByLabel("Nothing identified yet")).toBeVisible();
  await next(page);
  await page.getByRole("button", { name: "Create a basic summary" }).click();
  await expect(page.getByRole("heading", { name: "Your Answer Summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The pattern you selected" })).toBeVisible();
  await expect(page.getByText("This summarizes your selections. It has not interpreted them with AI.")).toBeVisible();
  await capture(page, "profile-experience-375-summary");
  await page.getByRole("button", { name: "Create an AI profile" }).click();
  await expect(page.getByText("With AI assistance, your answers", { exact: false })).toBeVisible();
  await layout(page);
});



test("validated AI result leads with a synthesized profile", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(path.resolve("tests/desired-client-v2/fixtures/ai-profile-synthetic.json"), "utf8"));
  await page.setViewportSize({ width: 768, height: 900 });
  await page.addInitScript(({ answers, brief }) => {
    const now = Date.now();
    localStorage.setItem("cls-desired-client-v2", JSON.stringify({
      schemaVersion: 2, answers, currentStage: 7,
      lastEditedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      savedBrief: { brief, sourceBriefRevision: answers.revision, generatedAt: new Date(now).toISOString(), wordingReviewed: false, mode: "ai" },
    }));
  }, fixture);
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Resume with AI assistance" }).click();
  await expect(page.getByRole("heading", { name: "Your Desired Client Profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The client and matter to pursue" })).toBeVisible();
  await expect(page.getByText(fixture.brief.definition.text)).toBeVisible();
  await expect(page.getByText("AI-generated profile.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Why this work fits" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What to validate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where marketing can start" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the client wants to achieve" })).toHaveCount(0);
  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await layout(page);
    expect(await page.locator('[data-ui-copy-exception="AI-generated wording with variable line breaks"]').evaluateAll(elements => elements.every(element => {
      const rect = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return rect.width > 0 && rect.left >= parent.left - 1 && rect.right <= parent.right + 1 && element.scrollWidth <= element.clientWidth + 1;
    }))).toBe(true);
    if ([1440, 768, 320].includes(width)) await capture(page, "profile-experience-" + width + "-ai");
  }
});
