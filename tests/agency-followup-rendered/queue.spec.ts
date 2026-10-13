import { expect, test } from "@playwright/test";

const widths = [1440, 1024, 768, 640, 375, 320];

test("actual follow-up queue keeps copy full-width and avoids orphan lines at supported widths", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { name: "Follow-up journeys" })).toBeVisible();

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(80);
    const audit = await page.locator("[data-ui-component-content]").evaluateAll((components) => components.map((component) => {
      const box = component.getBoundingClientRect();
      const style = getComputedStyle(component);
      const left = box.left + parseFloat(style.paddingLeft);
      const right = box.right - parseFloat(style.paddingRight);
      const measure = right - left;
      const copy = [...component.querySelectorAll<HTMLElement>("[data-ui-copy]")]
        .filter((element) => element.closest("[data-ui-component-content]") === component).map((element) => {
        const rect = element.getBoundingClientRect();
        const text = element.textContent ?? "";
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const byLine = new Map<number, Array<{ left: number; right: number; word: string }>>();
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const raw = node.textContent ?? "";
          for (const match of raw.matchAll(/\S+/g)) {
            const start = match.index ?? 0;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + match[0].length);
            const wordRect = range.getBoundingClientRect();
            if (wordRect.width === 0 || wordRect.height === 0) continue;
            const top = Math.round(wordRect.top);
            const words = byLine.get(top) ?? [];
            words.push({ left: wordRect.left, right: wordRect.right, word: match[0] });
            byLine.set(top, words);
          }
        }
        const lines = [...byLine.entries()].sort(([a], [b]) => a - b).map(([, line]) => line);
        const orphan = lines.length > 1 && lines.at(-1)?.length === 1;
        const shortNonfinal = lines.slice(0, -1).some((line, index) => {
          const used = Math.max(...line.map((word) => word.right)) - Math.min(...line.map((word) => word.left));
          if (used >= measure * 0.75) return false;
          const nextWord = lines[index + 1]?.[0];
          if (!nextWord) return false;
          const lineRight = Math.max(...line.map((word) => word.right));
          return nextWord.right - nextWord.left <= right - lineRight;
        });
        return {
          text,
          width: rect.width,
          left: rect.left,
          right: rect.right,
          measure,
          orphan,
          shortNonfinal,
          lines: lines.map((line) => line.map((word) => word.word).join(" ")),
        };
      });
      return { boxWidth: box.width, measure, copy };
    }));

    expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width + 1);
    for (const component of audit) {
      for (const element of component.copy) {
        expect(Math.abs(element.width - component.measure), `copy track width at ${width}px: ${element.text}`).toBeLessThanOrEqual(1);
        expect(element.orphan, `orphan at ${width}px: ${element.text}; lines=${element.lines.join(" | ")}`).toBe(false);
        expect(element.shortNonfinal, `short nonfinal line at ${width}px: ${element.text}; lines=${element.lines.join(" | ")}`).toBe(false);
      }
    }
    if ([1440, 375, 320].includes(width)) {
      await page.screenshot({ path: `test-results/agency-followup-rendered/queue-${width}.png`, fullPage: true });
    }
  }
});
