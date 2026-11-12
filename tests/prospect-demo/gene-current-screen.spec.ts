import { expect, test } from "@playwright/test";

// The public share route must work without the operator's account or local library.
test("Gene share page uses one current widget and preserves its draft at every width", async ({ page }, testInfo) => {
  const response = await page.goto("/tools/screen/gene-colman");
  expect(response?.status()).toBe(200);
  expect((await page.context().cookies()).some(cookie => cookie.name === "portal_session")).toBe(false);
  const iframe = page.locator('iframe[title="Gene family-law SCREEN demonstration"]');
  await expect(iframe).toHaveAttribute("src", "/screen-demo-app/index.html?embed=1&profile=gene&practice_area=family");
  const widget = page.frameLocator('iframe[title="Gene family-law SCREEN demonstration"]');
  const input = widget.getByRole("textbox", { name: "Tell us how a lawyer can help you today.", exact: true });
  await expect(input).toBeVisible();
  await expect(page.getByLabel("Prospect", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.locator('img[src*="gene-colman.webp"]').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1986);
  const draft = "My ex-wife is not allowing me to see our son. We both live in Ontario. I need help with parenting time.";
  await input.fill(draft);
  const originalFrame = await iframe.elementHandle();

  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ["Website preview", "Lawyer brief", "Side by side"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(input).toHaveValue(draft);
      expect(await iframe.evaluate((element, original) => element === original, originalFrame)).toBe(true);
      await expect.poll(() => widget.locator("html").evaluate(element => ({
        horizontal: element.scrollWidth <= element.clientWidth + 1,
        vertical: element.scrollHeight <= element.clientHeight + 1,
      }))).toEqual({ horizontal: true, vertical: true });
      expect(await page.locator("html").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const internalScrollAreas = await page.locator("[data-gene-current-screen]").evaluate(root => Array.from(root.querySelectorAll("*")).filter(element => {
        const style = getComputedStyle(element);
        return element.getClientRects().length && ((/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) || (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1));
      }).length);
      expect(internalScrollAreas).toBe(0);
      if ([1440, 375, 320].includes(width) && view === "Website preview") {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: testInfo.outputPath(`gene-current-website-${width}.png`), fullPage: false });
      }
    }
  }
});