import { test, expect } from "@playwright/test";
import { localOrigin, renderedManifest, useSyntheticOperator, waitForResearch, renderedCopyFailures, retainEveryItem } from "./browser-support";

for (const width of [1440, 1024, 768, 640, 375, 320]) {
  test("research surfaces use readable full-width copy at " + width, async ({ page, context }, testInfo) => {
    const fixture = renderedManifest();
    await useSyntheticOperator(context, fixture);
    await page.setViewportSize({ width, height: 1000 });
    const externalRequests: string[] = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (!["http:", "https:"].includes(url.protocol) || url.origin === localOrigin) await route.continue();
      else { externalRequests.push(url.origin); await route.abort(); }
    });
    const surfaces = [
      ["inbox", "/admin/prospects"],
      ["review", "/admin/prospects/research-packages/" + fixture.packages.review],
      ["applied", "/admin/prospects/research-packages/" + fixture.packages.applied],
      ["held", "/admin/prospects/research-packages/" + fixture.packages.held],
      ["conflict", "/admin/prospects/research-packages/" + fixture.packages.conflict],
      ["firm", "/admin/prospects/firms/" + fixture.firmId],
      ["run", "/admin/prospects/research-runs/" + fixture.runId],
    ];
    for (const [name, path] of surfaces) {
      await page.goto(localOrigin + path);
      await waitForResearch(page);
      if (name === "conflict") await expect(page.getByRole("alert")).toContainText("More than one firm may use this website."); else await expect(page.getByRole("alert")).toHaveCount(0);
      const failures = await renderedCopyFailures(page);
      await page.screenshot({ path: testInfo.outputPath(name + "-" + width + ".png"), fullPage: true });
      expect(failures, name + " at " + width).toEqual([]);
      if (name === "review") {
        await retainEveryItem(page);
        await page.getByRole("button", { name: "Prepare exact review", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Confirm reviewed changes" })).toBeVisible();
        await waitForResearch(page);
        await page.screenshot({ path: testInfo.outputPath("confirmation-" + width + ".png"), fullPage: true });
        expect(await renderedCopyFailures(page)).toEqual([]);
      }
    }
    expect(externalRequests, "Research review must not make third-party requests").toEqual([]);
  });
}
