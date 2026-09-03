import { expect, test, type Page } from "@playwright/test";

const VIEWPORT_WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const ROUTES = ["/data-deletion", "/privacy"] as const;

async function waitForStableLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

for (const route of ROUTES) {
  for (const width of VIEWPORT_WIDTHS) {
    test(`${route} copy gates pass at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      await waitForStableLayout(page);

      const componentCount = await page.locator("[data-ui-component-content]").count();
      expect(componentCount).toBeGreaterThan(0);
      await expect(page.locator("[data-ui-copy]")).toHaveCount(componentCount * 2);
      await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);

      const audit = await page.evaluate(() => {
        const tolerance = 1;
        const fullWidthFailures: string[] = [];
        const orphanFailures: string[] = [];

        for (const copy of document.querySelectorAll<HTMLElement>("[data-ui-copy]")) {
          const container = copy.closest<HTMLElement>("[data-ui-component-content]");
          if (!container) {
            fullWidthFailures.push("tagged copy has no data-ui-component-content ancestor");
            continue;
          }

          const containerRect = container.getBoundingClientRect();
          const copyRect = copy.getBoundingClientRect();
          const style = getComputedStyle(container);
          const innerLeft =
            containerRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
          const innerRight =
            containerRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
          if (
            Math.abs(copyRect.left - innerLeft) > tolerance
            || Math.abs(copyRect.right - innerRight) > tolerance
          ) {
            fullWidthFailures.push(
              `${container.dataset.uiComponentContent}: copy [${copyRect.left.toFixed(2)}, ${copyRect.right.toFixed(2)}] `
                + `does not match usable bounds [${innerLeft.toFixed(2)}, ${innerRight.toFixed(2)}]`,
            );
          }
        }

        const governedCopy = document.querySelectorAll<HTMLElement>(
          '[data-ui-copy="heading"], [data-ui-copy="body"] > p, [data-ui-copy="body"] > address > *, '
            + '[data-ui-copy="body"] > ul > li',
        );

        for (const guard of governedCopy) {
          const wordFragments: Array<{
            top: number;
            left: number;
            word: string;
            wordId: number;
          }> = [];
          const walker = document.createTreeWalker(guard, NodeFilter.SHOW_TEXT);
          let textNode = walker.nextNode();
          let wordId = 0;
          while (textNode) {
            const value = textNode.textContent ?? "";
            for (const match of value.matchAll(/\S+/g)) {
              const start = match.index ?? 0;
              const range = document.createRange();
              range.setStart(textNode, start);
              range.setEnd(textNode, start + match[0].length);
              for (const rect of Array.from(range.getClientRects())) {
                if (rect.width > 0 && rect.height > 0) {
                  wordFragments.push({
                    top: rect.top,
                    left: rect.left,
                    word: match[0],
                    wordId,
                  });
                }
              }
              wordId += 1;
            }
            textNode = walker.nextNode();
          }

          wordFragments.sort((a, b) => a.top - b.top || a.left - b.left);
          const lines: Array<{ top: number; fragments: typeof wordFragments }> = [];
          for (const fragment of wordFragments) {
            const line = lines.find(
              (candidate) => Math.abs(candidate.top - fragment.top) <= tolerance,
            );
            if (line) line.fragments.push(fragment);
            else lines.push({ top: fragment.top, fragments: [fragment] });
          }

          const finalLine = lines.at(-1);
          const finalLineWords = finalLine
            ? new Set(finalLine.fragments.map((fragment) => fragment.wordId))
            : new Set<number>();
          if (lines.length >= 2 && finalLine && finalLineWords.size === 1) {
            orphanFailures.push(
              `${guard.textContent?.trim().slice(0, 60)}: final line contains only `
                + `"${finalLine.fragments[0].word}"`,
            );
          }
        }

        return {
          fullWidthFailures,
          orphanFailures,
          documentOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          containsEmDash: document.body.innerText.includes("\u2014"),
        };
      });

      if (width === 1440 || width === 320) {
        await page.screenshot({
          path: testInfo.outputPath(`${route.slice(1)}-${width}px.png`),
          fullPage: true,
        });
      }

      expect(audit.fullWidthFailures).toEqual([]);
      expect(audit.orphanFailures).toEqual([]);
      expect(audit.documentOverflow).toBeLessThanOrEqual(1);
      expect(audit.containsEmDash).toBe(false);

      const renderedText = await page
        .locator("[data-ui-component-content]")
        .first()
        .evaluate((element) => element.closest("main")?.innerText ?? "");
      if (route === "/data-deletion") {
        expect(renderedText).toContain("A completed or not-applicable status is the operator's attestation, not provider-issued evidence.");
        expect(renderedText).toContain("A provider-managed status is only a routing marker and cannot, by itself, close external cleanup.");
        expect(renderedText).toContain("remain release gates for this revised commitment");
        expect(renderedText).not.toContain("We apply the request to active copies held by service providers");
        expect(renderedText).not.toContain("Backup copies are not returned to operational use without reapplying completed deletion requests");
      } else {
        expect(renderedText).toContain("Privacy counsel must approve the retention boundary");
        expect(renderedText).toContain("remain release gates for this revised commitment");
        expect(renderedText).not.toContain("are not returned to operational use without reapplying completed deletion requests");
      }
    });
  }
}
