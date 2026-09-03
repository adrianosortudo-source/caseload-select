import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const EVIDENCE = path.join(process.cwd(), "test-results", "operator-login-evidence");

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function assertRenderedCopyGates(page: Page) {
  const audit = await page.evaluate(() => {
    const failures: string[] = [];
    const components = Array.from(document.querySelectorAll<HTMLElement>("[data-ui-component-content]"));
    for (const component of components) {
      const componentName = component.dataset.uiComponentContent ?? "unknown";
      const componentRect = component.getBoundingClientRect();
      const style = getComputedStyle(component);
      const innerLeft = componentRect.left + Number.parseFloat(style.paddingLeft || "0");
      const innerRight = componentRect.right - Number.parseFloat(style.paddingRight || "0");

      for (const copy of Array.from(component.querySelectorAll<HTMLElement>("[data-ui-copy]"))) {
        if (copy.closest("[data-ui-component-content]") !== component) continue;
        if (copy.dataset.uiCopyException) continue;
        const rect = copy.getBoundingClientRect();
        if (Math.abs(rect.left - innerLeft) > 1.1 || Math.abs(rect.right - innerRight) > 1.1) {
          failures.push(`${componentName}:${copy.dataset.uiCopy} does not use the full content width`);
        }

        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        const words: Array<{ top: number; word: string }> = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index ?? 0);
            range.setEnd(node, (match.index ?? 0) + match[0].length);
            for (const wordRect of Array.from(range.getClientRects())) {
              if (wordRect.width > 0 && wordRect.height > 0) words.push({ top: wordRect.top, word: match[0] });
            }
          }
        }
        const lines: Array<Array<{ top: number; word: string }>> = [];
        for (const word of words.sort((a, b) => a.top - b.top)) {
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
  test(`operator sign-in states pass rendered gates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    await page.goto("/operator/login");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Operator access" })).toBeVisible();
    await assertRenderedCopyGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-operator-initial.png`), fullPage: true });

    await page.goto("/operator/login?error=invalid");
    await settle(page);
    await expect(page.getByText("This operator link is invalid.")).toBeVisible();
    await assertRenderedCopyGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-operator-invalid.png`), fullPage: true });

    await page.goto("/operator/login");
    await settle(page);
    await page.route("**/api/operator/request-link", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.getByLabel("Email").fill("operator@example.test");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText("Check your inbox")).toBeVisible();
    await settle(page);
    await assertRenderedCopyGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-operator-confirmation.png`), fullPage: true });

    await page.goto("/portal/login");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Lawyer portal" })).toBeVisible();
    await assertRenderedCopyGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-lawyer-initial.png`), fullPage: true });

    await page.goto("/portal/login?error=invalid");
    await settle(page);
    await expect(page.getByText("This link is invalid.", { exact: false })).toBeVisible();
    await assertRenderedCopyGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-lawyer-invalid.png`), fullPage: true });

    await page.goto("/portal/login");
    await settle(page);
    await page.route("**/api/portal/request-link", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.getByLabel("Email").fill("lawyer@example.test");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText("Check your inbox")).toBeVisible();
    await settle(page);
    await assertRenderedCopyGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-lawyer-confirmation.png`), fullPage: true });
  });
}
