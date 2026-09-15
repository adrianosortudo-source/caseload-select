import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 1000 },
  { width: 390, height: 844 },
] as const;

async function waitForStableLayout(page: Page) {
  await page.locator("[data-channel-conversation-slot] [data-channel-conversation-panel]").waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

for (const variant of ["new", "stored"] as const) {
  for (const viewport of VIEWPORTS) {
    test(`${variant} brief composes the report at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const response = await page.goto(
        `/test-screen/lead-report-conversation?variant=${variant}`,
        { waitUntil: "networkidle" },
      );
      expect(response?.status()).toBe(200);
      await waitForStableLayout(page);

      const fixture = page.locator("[data-lead-report-page]");
      await expect(fixture).toHaveAttribute("data-fixture-brief-variant", variant);
      await expect(
        page.locator(".brief-main-right [data-channel-conversation-slot] [data-channel-conversation-panel]"),
      ).toHaveCount(1);
      await expect(page.locator("[data-intake-transcript-panel]")).toHaveCount(1);

      const geometry = await page.evaluate(() => {
        const box = (selector: string) => {
          const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
          };
        };
        return {
          report: box(".brief-main-left"),
          rail: box(".brief-main-right"),
          conversation: box("[data-channel-conversation-panel]"),
          facts: box('[data-group="facts"]'),
          mainGrid: box(".brief-main-grid"),
          transcript: box("[data-intake-transcript-panel]"),
          overflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      expect(geometry.overflow).toBeLessThanOrEqual(1);
      if (viewport.width === 1440) {
        expect(geometry.report.width).toBeGreaterThanOrEqual(800);
        expect(geometry.rail.width).toBeGreaterThanOrEqual(280);
        expect(geometry.rail.width).toBeLessThanOrEqual(301);
        expect(geometry.report.right).toBeLessThan(geometry.rail.left);
        expect(geometry.conversation.left).toBeGreaterThanOrEqual(geometry.rail.left);
        expect(geometry.conversation.right).toBeLessThanOrEqual(geometry.rail.right + 1);
        expect(geometry.mainGrid.bottom).toBeLessThanOrEqual(geometry.transcript.top);
      } else {
        expect(geometry.facts.bottom).toBeLessThanOrEqual(geometry.conversation.top);
        expect(geometry.conversation.bottom).toBeLessThanOrEqual(geometry.transcript.top);
      }

      await fixture.screenshot({
        path: testInfo.outputPath(`lead-report-${variant}-${viewport.width}px.png`),
      });
    });
  }
}
