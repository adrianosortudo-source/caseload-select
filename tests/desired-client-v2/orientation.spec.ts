import { expect, test } from "@playwright/test";
import { capture, choose, layout, next } from "./helpers";
import { STAGE_DEFINITIONS } from "../../src/lib/desired-client/screens";

for (const width of [1440, 1024, 768, 640, 375, 320]) {
  test("orientation copy fits at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tools/desired-client-matter");
    await expect(page.getByText("What you will get:", { exact: false })).toBeVisible();
    await expect(page.getByText("Allow about 10 minutes.", { exact: false })).toBeVisible();
    await layout(page);
    if (width === 1440 || width === 320) await capture(page, "orientation-" + width + "-welcome");
    await page.getByRole("button", { name: "Begin without AI" }).click();
    await expect(page.getByText(STAGE_DEFINITIONS[0].explanation)).toBeVisible();
    await layout(page);
    if (width === 1440 || width === 320) await capture(page, "orientation-" + width + "-focus");
  });
}

test("every section explains its purpose during the guided journey", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Begin without AI" }).click();
  await choose(page, "Business & commercial");
  await choose(page, "Commercial agreement drafting and review");
  await choose(page, "We already do it and want more");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[1].explanation)).toBeVisible();
  await choose(page, "Before a planned decision or change");
  await choose(page, "Business or organization");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[2].explanation)).toBeVisible();
  await choose(page, "Complete a planned transaction or process");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[3].explanation)).toBeVisible();
  await choose(page, "It uses work we do well");
  await choose(page, "Usually worthwhile");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[4].explanation)).toBeVisible();
  await choose(page, "Yes, with the current team");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[5].explanation)).toBeVisible();
  await choose(page, "More of the work we already handle well");
  await choose(page, "Several matters we have handled");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[6].explanation)).toBeVisible();
  await layout(page);
  await capture(page, "orientation-768-review");
});
