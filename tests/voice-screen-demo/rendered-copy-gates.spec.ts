import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const EVIDENCE = path.join(process.cwd(), "test-results", "voice-screen-demo-evidence");
const ROUTE = "/demo/voice-to-screen";

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function assertRenderedCopyGates(page: Page) {
  const audit = await page.evaluate(() => {
    const failures: string[] = [];
    const components = Array.from(
      document.querySelectorAll<HTMLElement>("[data-ui-component-content]"),
    );
    for (const component of components) {
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

async function completeGrantedPath(page: Page) {
  await page.getByLabel("Caller type").selectOption("new");
  await page.getByLabel("Yes, send the link").check();
  await page
    .getByLabel("Caller confirms this number is correct and safe to text")
    .check();
  await page.getByRole("button", { name: "End simulated call" }).click();
  await expect(page.getByText("Sample law firm · Simulated SMS")).toBeVisible();
  await settle(page);
  await assertRenderedCopyGates(page);
  await page.getByRole("button", { name: "Open your Screen" }).click();

  const questions: string[] = [];
  for (let count = 0; count < 12; count += 1) {
    const finish = page.getByRole("button", { name: "Finish Screen" });
    if (await finish.isVisible().catch(() => false)) {
      await finish.click();
      break;
    }
    const question = page.locator("label[for='continuation-answer']");
    await expect(question).toBeVisible();
    await settle(page);
    await assertRenderedCopyGates(page);
    questions.push(await question.innerText());
    const firstOption = page.locator("div[class*='options'] button").first();
    if (await firstOption.isVisible().catch(() => false)) await firstOption.click();
    else await page.getByRole("button", { name: "Skip this question" }).click();
  }

  expect(questions.length).toBeGreaterThan(0);
  expect(questions.length).toBeLessThanOrEqual(8);
  expect(questions).not.toContain("About how much money is involved?");
  expect(questions).not.toContain("Do you have an invoice, bill, or statement showing what is owed?");
  expect(questions).not.toContain("Has any of the amount been paid?");
  expect(questions).not.toContain("What is the other side saying about why they are not paying?");
  await expect(page.getByText("Ready for demonstration review")).toBeVisible();
  await expect(page.getByText("Callback request remains open", { exact: false })).toBeVisible();
  await expect(page.getByText("No written answers yet.")).toHaveCount(0);
}

test.beforeAll(() => fs.mkdirSync(EVIDENCE, { recursive: true }));

for (const width of WIDTHS) {
  test(`Voice to Screen passes the full rendered journey at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const nonGetRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") nonGetRequests.push(`${request.method()} ${request.url()}`);
    });

    await page.goto(ROUTE);
    await settle(page);
    await expect(page.getByRole("heading", { name: "One inquiry. A continuous conversation." })).toBeVisible();
    await assertRenderedCopyGates(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-initial.png`), fullPage: true });
    await completeGrantedPath(page);
    await settle(page);
    await assertRenderedCopyGates(page);

    expect(page.url()).toBe(`http://127.0.0.1:3108${ROUTE}`);
    expect(page.url()).not.toMatch(/Alex|416|555|invoice/i);
    expect(nonGetRequests).toEqual([]);
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({
      local: 0,
      session: 0,
    });
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-final.png`), fullPage: true });
  });
}

test("declined, unclear, unsafe, urgent and existing callers never see an invitation", async ({ page }) => {
  const scenarios = [
    { callerType: "new", permission: "No, just call me back", safe: false },
    { callerType: "new", permission: "No clear answer", safe: false },
    { callerType: "new", permission: "Yes, send the link", safe: false },
    { callerType: "urgent", permission: "Yes, send the link", safe: true },
    { callerType: "existing", permission: "Yes, send the link", safe: true },
  ];
  for (const scenario of scenarios) {
    await page.goto(ROUTE);
    await settle(page);
    await page.getByLabel("Caller type").selectOption(scenario.callerType);
    await page.getByLabel(scenario.permission).check();
    if (scenario.safe) {
      await page
        .getByLabel("Caller confirms this number is correct and safe to text")
        .check();
    }
    await page.getByRole("button", { name: "End simulated call" }).click();
    await expect(page.getByText("No text invitation was created", { exact: false })).toBeVisible();
    await expect(page.getByText("Sample law firm · Simulated SMS")).toHaveCount(0);
  }
});
