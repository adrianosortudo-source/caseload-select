import { expect, test } from "@playwright/test";
import { capture, choose, layout, next } from "./helpers";
import { STAGE_DEFINITIONS } from "../../src/lib/desired-client/screens";

for (const width of [1440, 1024, 768, 640, 375, 320]) {
  test("orientation copy fits at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tools/desired-client-matter");
    await expect(page.getByText("one-page Desired Client Blueprint", { exact: false })).toBeVisible();
    await expect(page.getByText("About 10 minutes for a first draft.", { exact: true })).toBeVisible();
    await layout(page);
    if (width === 1440 || width === 320) await capture(page, "orientation-" + width + "-welcome");
    await page.getByRole("button", { name: "Build my client profile" }).first().click();
    await expect(page.getByText(STAGE_DEFINITIONS[0].explanation)).toBeVisible();
    await layout(page);
    if (width === 1440 || width === 320) await capture(page, "orientation-" + width + "-focus");
  });
}

test("the HTML example shows a complete working draft without generating a profile", async ({ page }) => {
  const analysisRequests: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().includes("/api/tools/desired-client-matter/analyze")) {
      analysisRequests.push(request.url());
    }
  });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("link", { name: "See an example Blueprint" }).click();
  const example = page.locator("#example-blueprint");
  await expect(example).toBeInViewport();
  await expect(example.getByRole("heading", { name: "Desired client portrait" }).first()).toBeVisible();
  await example.locator("details > summary").click();
  const complete = example.getByRole("article", { name: "Complete fictional Desired Client Blueprint" });
  for (const heading of ["Client need", "Firm value", "Marketing direction", "Proposed Screen questions", "Still to confirm", "Answers and sources"]) {
    await expect(complete.getByRole("heading", { name: heading, level: 4 })).toBeVisible();
  }
  await expect(example.getByRole("link", { name: /pdf/i })).toHaveCount(0);
  await expect(example.getByRole("button", { name: /pdf/i })).toHaveCount(0);
  expect(analysisRequests).toEqual([]);
  await page.getByRole("button", { name: "Build my client profile" }).first().click();
  await expect(page.getByText(STAGE_DEFINITIONS[0].explanation)).toBeVisible();
});

for (const width of [1440, 320]) {
  test(`the standalone example is printable HTML at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tools/desired-client-matter");
    const [examplePage] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "Open the complete example on its own page" }).click(),
    ]);
    await examplePage.setViewportSize({ width, height: 1000 });
    await expect(examplePage).toHaveURL(/\/tools\/desired-client-matter\/example$/);
    const report = examplePage.getByRole("article", { name: "Complete fictional Desired Client Blueprint" });
    await expect(report).toBeVisible();
    await expect(report.getByRole("heading", { name: "Proposed Screen questions", level: 4 })).toBeVisible();
    await expect(examplePage.getByRole("link", { name: /pdf/i })).toHaveCount(0);
    await expect(examplePage.getByRole("button", { name: /pdf/i })).toHaveCount(0);
    expect(await examplePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await examplePage.emulateMedia({ media: "print" });
    await expect(examplePage.locator(".dc-site-header")).toBeHidden();
    await expect(examplePage.getByRole("button", { name: "Print this HTML Blueprint" })).toBeHidden();
    await expect(report).toBeVisible();
  });
}

test("every section explains its purpose during the guided journey", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Build my client profile" }).first().click();
  await choose(page, "Business & commercial");
  await choose(page, "Commercial agreement drafting and review");
  await choose(page, "We already do it and want more");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[1].explanation)).toBeVisible();
  await choose(page, "A business purchase, sale or ownership change is planned");
  await choose(page, "Before a planned decision or change");
  await choose(page, "Business or organization");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[2].explanation)).toBeVisible();
  await choose(page, "Complete a planned transaction or process");
  await choose(page, "I'm worried about the cost");
  await choose(page, "I don't know what happens next");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[3].explanation)).toBeVisible();
  await choose(page, "It uses work we do well");
  await choose(page, "The fee usually supports the effort");
  await choose(page, "Usually worthwhile");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[4].explanation)).toBeVisible();
  await choose(page, "A clearly agreed scope");
  await choose(page, "Yes, with the current team");
  await choose(page, "They are open to agreeing the scope and next step");
  await next(page);
  await expect(page.getByText(STAGE_DEFINITIONS[5].explanation)).toBeVisible();
  await choose(page, "More of the work we already handle well");
  await choose(page, "Several matters we have handled");
  await choose(page, "Fee and time records");
  await next(page);
  await expect(page.getByRole("heading", { name: "Review your direction" })).toBeVisible();
  await layout(page);
  await capture(page, "orientation-768-review");
});
