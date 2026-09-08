import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const EVIDENCE = path.join(process.cwd(), "test-results", "prospect-qualified-evidence");
const STRUTHERS_FIRM_ID = "FIRM-7XGYP723JDAXDAB2J76RVNSVD5";

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function assertRenderedGates(page: Page) {
  const audit = await page.evaluate(() => {
    const failures: string[] = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      failures.push(`document overflows by ${document.documentElement.scrollWidth - document.documentElement.clientWidth}px`);
    }
    const components = Array.from(document.querySelectorAll<HTMLElement>("[data-ui-component-content]"));
    for (const component of components) {
      const componentName = component.dataset.uiComponentContent ?? "unknown";
      const componentRect = component.getBoundingClientRect();
      const style = getComputedStyle(component);
      const innerLeft = componentRect.left + Number.parseFloat(style.paddingLeft || "0");
      const innerRight = componentRect.right - Number.parseFloat(style.paddingRight || "0");
      for (const copy of Array.from(component.querySelectorAll<HTMLElement>("[data-ui-copy]"))) {
        if (copy.closest("[data-ui-component-content]") !== component || copy.dataset.uiCopyException) continue;
        const rect = copy.getBoundingClientRect();
        if (Math.abs(rect.left - innerLeft) > 1.1 || Math.abs(rect.right - innerRight) > 1.1) {
          failures.push(`${componentName}:${copy.dataset.uiCopy} does not use full content width`);
        }
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        const words: Array<{ top: number; word: string }> = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index ?? 0);
            range.setEnd(node, (match.index ?? 0) + match[0].length);
            for (const wordRect of Array.from(range.getClientRects())) {
              if (wordRect.width > 0 && wordRect.height > 0) words.push({ top: wordRect.top, word: match[0] });
            }
          }
        }
        const lines: Array<Array<{ top: number; word: string }>> = [];
        for (const word of words.sort((left, right) => left.top - right.top)) {
          const line = lines.find((candidate) => Math.abs(candidate[0].top - word.top) <= 1);
          if (line) line.push(word);
          else lines.push([word]);
        }
        if (lines.length > 1 && lines.at(-1)?.length === 1) {
          failures.push(`${componentName}:${copy.dataset.uiCopy} ends with a one-word line`);
        }
      }
    }
    return failures;
  });
  expect(audit).toEqual([]);
}

test.beforeAll(() => fs.mkdirSync(EVIDENCE, { recursive: true }));

for (const width of WIDTHS) {
  test(`qualified list and audit pass rendered gates at ${width}px`, async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dev/prospect-qualified-preview");
    await settle(page);
    await expect(page.getByRole("heading", { name: "All prospect records" })).toBeVisible();
    await page.getByRole("button", { name: /^Shared registry/ }).click();
    await expect(page.getByText("20 of", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "More qualification filters" }).click();
    await page.getByLabel("Advertising source type").selectOption("ad_library_record");
    await expect(page.getByText("8 of", { exact: false })).toBeVisible();
    await assertRenderedGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-firm-expansion.png`), fullPage: true });

    await page.goto(`/dev/prospect-qualified-preview?audit=${STRUTHERS_FIRM_ID}`);
    await settle(page);
    await expect(page.getByRole("heading", { name: "Marketing review priorities" })).toBeVisible();
    await expect(page.locator('[data-ui-component-content="marketing-review-priorities"] li')).toHaveCount(2);
    await assertRenderedGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-struthers-audit.png`), fullPage: true });
    expect(browserErrors).toEqual([]);
  });
}
