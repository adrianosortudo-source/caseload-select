import { expect, type Page } from "@playwright/test";

// Same word-rectangle measurement used by the existing Voice-to-Screen journey suite.
export async function assertRenderedCopyGates(page: Page) {
  const audit = await page.evaluate(() => {
    const failures: string[] = [];
    const components = Array.from(
      document.querySelectorAll<HTMLElement>("[data-ui-component-content]"),
    );
    for (const component of components) {
      if (!component.checkVisibility()) continue;
      const componentName = component.dataset.uiComponentContent ?? "unknown";
      const componentRect = component.getBoundingClientRect();
      const style = getComputedStyle(component);
      const innerLeft = componentRect.left + Number.parseFloat(style.paddingLeft || "0");
      const innerRight = componentRect.right - Number.parseFloat(style.paddingRight || "0");

      for (const copy of Array.from(
        component.querySelectorAll<HTMLElement>("[data-ui-copy]"),
      )) {
        if (copy.closest("[data-ui-component-content]") !== component) continue;
        if (copy.dataset.uiCopyException) continue;
        if (!copy.checkVisibility() || copy.getClientRects().length === 0) continue;
        const rect = copy.getBoundingClientRect();
        if (Math.abs(rect.left - innerLeft) > 1.1 || Math.abs(rect.right - innerRight) > 1.1) {
          failures.push(`${componentName}:${copy.dataset.uiCopy} does not use the full content width`);
        }

        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        const words: Array<{ top: number; left: number; right: number; width: number; word: string }> = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index ?? 0);
            range.setEnd(node, (match.index ?? 0) + match[0].length);
            for (const wordRect of Array.from(range.getClientRects())) {
              if (wordRect.width > 0 && wordRect.height > 0) {
                words.push({
                  top: wordRect.top,
                  left: wordRect.left,
                  right: wordRect.right,
                  width: wordRect.width,
                  word: match[0],
                });
              }
            }
          }
        }
        const lines: Array<typeof words> = [];
        for (const word of words.sort((a, b) => a.top - b.top || a.left - b.left)) {
          const line = lines.find((candidate) => Math.abs(candidate[0].top - word.top) <= 1);
          if (line) line.push(word);
          else lines.push([word]);
        }
        if (lines.length > 1 && lines.at(-1)?.length === 1) {
          failures.push(`${componentName}:${copy.dataset.uiCopy} ends with a one-word line`);
        }
        const available = innerRight - innerLeft;
        for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex += 1) {
          const line = lines[lineIndex];
          const nextWord = lines[lineIndex + 1]?.[0];
          if (!nextWord || line.length < 3) continue;
          const used = line.at(-1)!.right - line[0].left;
          const remaining = innerRight - line.at(-1)!.right;
          if (used / available < 0.75 && nextWord.width + 5 <= remaining) {
            failures.push(`${componentName}:${copy.dataset.uiCopy} leaves avoidable line space before ${nextWord.word}`);
          }
        }
      }
    }
    if (document.body.scrollWidth > document.documentElement.clientWidth + 1) {
      failures.push("page has horizontal overflow");
    }
    if (document.body.innerText.includes("—")) failures.push("page contains an em dash");
    return failures;
  });
  expect(audit).toEqual([]);
}

