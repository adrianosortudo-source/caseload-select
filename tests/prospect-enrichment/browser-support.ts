import { readFileSync } from "node:fs";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { createSessionCookie } from "../../src/lib/portal-auth";

export const localOrigin = "http://127.0.0.1:3100";
export type RenderedManifest = {
  synthetic: true;
  operator: { firmId: string; lawyerId: string };
  firmId: string; runId: string; sourceRunKey: string; stageEnvelopePath: string; comparisonRequestPath: string;
  packages: { review: string; applied: string; held: string; conflict: string };
};
export function renderedManifest(): RenderedManifest {
  const file = process.env.PROSPECT_ENRICHMENT_RENDERED_MANIFEST;
  if (!file) throw new Error("Set PROSPECT_ENRICHMENT_RENDERED_MANIFEST to the synthetic fixture manifest produced by the disposable local/CI database seed. Rendered acceptance requires real routes and operator auth.");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as RenderedManifest;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (manifest.synthetic !== true || !manifest.operator || !manifest.packages || !manifest.stageEnvelopePath || !manifest.comparisonRequestPath || !/^run-[a-f0-9]{32}$/.test(manifest.sourceRunKey) ||
    ![manifest.firmId, manifest.runId, manifest.operator.firmId, manifest.operator.lawyerId, ...Object.values(manifest.packages)].every((id) => typeof id === "string" && uuid.test(id))) {
    throw new Error("The rendered manifest must contain only seeded synthetic UUIDs, operator membership, all four package states and a local stage-envelope path.");
  }
  return manifest;
}
export async function useSyntheticOperator(context: BrowserContext, manifest: RenderedManifest) {
  if (!process.env.PORTAL_SECRET?.toLowerCase().includes("test")) throw new Error("Rendered tests require a dedicated test-only PORTAL_SECRET shared by the local server. Never use a production secret.");
  const cookie = createSessionCookie(manifest.operator.firmId, { role: "operator", lawyer_id: manifest.operator.lawyerId });
  await context.addCookies([{ name: cookie.name, value: cookie.value, url: localOrigin, httpOnly: true, sameSite: "Lax" }]);
}
export async function waitForResearch(page: Page) {
  await expect(page).not.toHaveURL(/login/);
  await expect(page.locator('[data-ui-component-content^="research-"]').first()).toBeVisible();
  await expect(page.getByText(/^Loading research|^Loading firm|^Loading evidence/)).toHaveCount(0);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
export async function renderedCopyFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const failures: string[] = [];
    const components = document.querySelectorAll<HTMLElement>('[data-ui-component-content^="research-"]');
    for (const component of components) {
      const bounds = component.getBoundingClientRect(), style = getComputedStyle(component);
      const left = bounds.left + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth);
      const right = bounds.right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth);
      for (const copy of component.querySelectorAll<HTMLElement>("[data-ui-copy]")) {
        if (copy.closest("[data-ui-component-content]") !== component || copy.hasAttribute("data-ui-copy-exception") || !copy.getClientRects().length) continue;
        const name = component.dataset.uiComponentContent + "/" + copy.dataset.uiCopy, box = copy.getBoundingClientRect();
        if (Math.abs(box.left - left) > 1 || Math.abs(box.right - right) > 1) failures.push(name + ": copy does not use full content width");
        if (copy.textContent?.includes("\u2014")) failures.push(name + ": em dash");
        const words: { top: number; left: number; right: number; text: string }[] = [];
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
            const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
            for (const rect of range.getClientRects()) if (rect.width && rect.height) words.push({ top: rect.top, left: rect.left, right: rect.right, text: match[0] });
          }
        }
        const lines: typeof words[] = [];
        for (const word of words) { const line = lines.find((candidate) => Math.abs(candidate[0].top - word.top) <= 1); if (line) line.push(word); else lines.push([word]); }
        lines.sort((a, b) => a[0].top - b[0].top);
        if (lines.length > 1 && lines.at(-1)!.length === 1) failures.push(name + ": single-word final line");
        for (let index = 0; index < lines.length - 1; index++) {
          const line = lines[index], next = lines[index + 1][0];
          const width = Math.max(...line.map((word) => word.right)) - Math.min(...line.map((word) => word.left));
          const remaining = right - Math.max(...line.map((word) => word.right));
          if (width < (right - left) * 0.75 && next.right - next.left + 5 <= remaining) failures.push(name + ": avoidably short nonfinal line");
        }
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) failures.push("page: horizontal overflow outside a scroll region");
    return failures;
  });
}
export async function retainEveryItem(page: Page) {
  for (;;) {
    for (const item of await page.locator('[data-ui-component-content="research-review-item"]').all()) {
      await item.getByLabel("Intended disposition").selectOption("retain_only");
      await item.getByLabel("Reason for retaining this item").fill("Synthetic browser review retains this evidence without a profile choice.");
    }
    const next = page.getByRole("button", { name: "Next 25 items", exact: true });
    if (await next.isDisabled()) break;
    await next.click();
  }
}
