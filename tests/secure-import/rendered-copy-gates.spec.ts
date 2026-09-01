import { expect, test, type Page } from "@playwright/test";

const VIEWPORT_WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;

async function waitForStableLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

for (const width of VIEWPORT_WIDTHS) {
  test(`Secure Import copy gates pass at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto("/test-screen/secure-import", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await waitForStableLayout(page);

    await expect(page.locator("[data-copy-container]")).toHaveCount(2);
    await expect(page.locator("[data-full-width-copy]")).toHaveCount(4);
    await expect(page.locator("[data-copy-orphan-guard]")).toHaveCount(4);
    await expect(page.locator("#relationship-import-file")).toBeDisabled();

    const audit = await page.evaluate(() => {
      const tolerance = 1;
      const fullWidthFailures: string[] = [];
      const orphanFailures: string[] = [];
      const actionTrackFailures: string[] = [];

      for (const copy of document.querySelectorAll<HTMLElement>("[data-full-width-copy]")) {
        const container = copy.closest<HTMLElement>("[data-copy-container]");
        if (!container) {
          fullWidthFailures.push("guarded copy has no data-copy-container ancestor");
          continue;
        }

        const containerRect = container.getBoundingClientRect();
        const copyRect = copy.getBoundingClientRect();
        const style = getComputedStyle(container);
        const innerLeft = containerRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
        const innerRight = containerRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
        if (Math.abs(copyRect.left - innerLeft) > tolerance || Math.abs(copyRect.right - innerRight) > tolerance) {
          fullWidthFailures.push(
            `${container.dataset.copyContainer}: copy [${copyRect.left.toFixed(2)}, ${copyRect.right.toFixed(2)}] `
            + `does not match usable bounds [${innerLeft.toFixed(2)}, ${innerRight.toFixed(2)}]`,
          );
        }

        const action = container.querySelector<HTMLElement>("[data-copy-action]");
        if (action) {
          const actionRect = action.getBoundingClientRect();
          const overlap = Math.min(copyRect.bottom, actionRect.bottom) - Math.max(copyRect.top, actionRect.top);
          if (overlap > tolerance) {
            actionTrackFailures.push(`${container.dataset.copyContainer}: supporting copy overlaps the action track`);
          }
        }
      }

      for (const guard of document.querySelectorAll<HTMLElement>("[data-copy-orphan-guard]")) {
        const wordFragments: Array<{ top: number; left: number; right: number; word: string; wordId: number }> = [];
        const walker = document.createTreeWalker(guard, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        let wordId = 0;
        while (textNode) {
          const text = textNode.textContent ?? "";
          for (const match of text.matchAll(/\S+/g)) {
            const start = match.index ?? 0;
            const range = document.createRange();
            range.setStart(textNode, start);
            range.setEnd(textNode, start + match[0].length);
            for (const rect of Array.from(range.getClientRects())) {
              if (rect.width > 0 && rect.height > 0) {
                wordFragments.push({ top: rect.top, left: rect.left, right: rect.right, word: match[0], wordId });
              }
            }
            wordId += 1;
          }
          textNode = walker.nextNode();
        }

        wordFragments.sort((a, b) => a.top - b.top || a.left - b.left);
        const lines: Array<{ top: number; fragments: typeof wordFragments }> = [];
        for (const fragment of wordFragments) {
          const line = lines.find((candidate) => Math.abs(candidate.top - fragment.top) <= tolerance);
          if (line) line.fragments.push(fragment);
          else lines.push({ top: fragment.top, fragments: [fragment] });
        }
        const finalLine = lines.at(-1);
        const finalLineWords = finalLine ? new Set(finalLine.fragments.map((fragment) => fragment.wordId)) : new Set<number>();
        if (lines.length >= 2 && finalLine && finalLineWords.size === 1) {
          const finalLineWidth = Math.max(...finalLine.fragments.map((fragment) => fragment.right))
            - Math.min(...finalLine.fragments.map((fragment) => fragment.left));
          orphanFailures.push(
            `${guard.getAttribute("data-copy-orphan-guard")}: final line contains only `
            + `"${finalLine.fragments[0].word}" across ${finalLineWidth.toFixed(2)}px`,
          );
        }
      }
      const root = document.querySelector<HTMLElement>("[data-secure-import-root]");
      const scrollers = root
        ? [...root.querySelectorAll<HTMLElement>("*")]
          .filter((element) => {
            const overflowX = getComputedStyle(element).overflowX;
            return element.scrollWidth > element.clientWidth + tolerance && /^(auto|scroll)$/.test(overflowX);
          })
          .map((element) => element.dataset.secureImportScroller ?? element.tagName.toLowerCase())
        : [];

      return {
        fullWidthFailures,
        orphanFailures,
        actionTrackFailures,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollers,
      };
    });

    if (width === 1440 || width === 320) {
      await page.screenshot({
        path: testInfo.outputPath(`secure-import-${width}px.png`),
        fullPage: true,
      });
    }

    expect(audit.fullWidthFailures).toEqual([]);
    expect(audit.orphanFailures).toEqual([]);
    expect(audit.actionTrackFailures).toEqual([]);
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.scrollers).toEqual(["csv-preview"]);
  });
}
