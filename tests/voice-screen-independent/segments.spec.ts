import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { assertRenderedCopyGates } from "./copy-gates";

const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const WIDGET_ROUTE = "/test/voice-screen/widget";
const BRIEF_ROUTE = "/test/voice-screen/brief";
const EVIDENCE = path.join(process.cwd(), "test-results", "voice-screen-independent-evidence");
const WIDGET = '[data-ui-component-content="live-continuation"]';
const QUESTION = '[data-ui-component-content="demo-decision-prompt"] h2, [data-ui-component-content="demo-text-prompt"] h2';

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function checkLayout(page: Page) {
  await settle(page);
  await assertRenderedCopyGates(page);
  const overflow = await page.evaluate(() => {
    const failures: string[] = [];
    const roots = document.querySelectorAll<HTMLElement>(
      '[data-shell-layout], [data-testid="voice-screen-test-brief"]',
    );
    for (const root of roots) {
      if (!root.getClientRects().length) continue;
      for (const node of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
        if (!node.getClientRects().length) continue;
        const style = getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
          failures.push(node.tagName + " has an internal vertical scrollbar");
        }
        if (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1) {
          failures.push(node.tagName + " has an internal horizontal scrollbar");
        }
        if (node instanceof HTMLTextAreaElement && node.scrollHeight > node.clientHeight + 1) {
          failures.push("textarea clips content instead of growing");
        }
      }
    }
    return failures;
  });
  expect(overflow).toEqual([]);
}

function monitorServiceCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.pathname.startsWith("/api/")) {
      calls.push(request.method() + " " + url.pathname);
    }
  });
  return calls;
}

async function assertNoServiceDependency(page: Page, calls: string[]) {
  expect(calls).toEqual([]);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }))).toEqual({ local: 0, session: 0 });
}

test.beforeAll(() => fs.mkdirSync(EVIDENCE, { recursive: true }));

for (const width of WIDTHS) {
  test(`widget starts independently, qualifies, updates its brief and resets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const serviceCalls = monitorServiceCalls(page);
    await page.goto(WIDGET_ROUTE);
    const widget = page.locator(WIDGET);
    await expect(widget.getByRole("heading", { name: "Pick up where you left off." })).toBeVisible();
    await expect(widget.locator(QUESTION)).toHaveCount(1);
    await checkLayout(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-widget-initial.png`), fullPage: true });

    const firstQuestion = await widget.locator(QUESTION).innerText();
    const questions: string[] = [];
    let savedAnswers = 0;
    for (let step = 0; step < 12; step += 1) {
      const question = widget.locator(QUESTION);
      if (await question.count() === 0) break;
      const text = await question.innerText();
      questions.push(text);
      expect(text).not.toMatch(/your (?:full )?name|your (?:phone|callback|telephone) number/i);
      expect([
        "About how much money is involved?",
        "Do you have an invoice, bill, or statement showing what is owed?",
        "Has any of the amount been paid?",
        "What is the other side saying about why they are not paying?",
      ]).not.toContain(text);
      await checkLayout(page);

      if (step === 0) {
        await page.getByRole("button", { name: "Skip this question", exact: true }).click();
      } else {
        const input = widget.getByRole("textbox");
        if (await input.count()) {
          await input.fill("Fictional test detail: the client confirmed receipt of the invoice and disputed the agreed scope. ".repeat(12));
          await checkLayout(page);
          await widget.getByRole("button", { name: "Save and continue", exact: true }).click();
        } else {
          await widget.getByRole("button").filter({ hasNotText: "Finish with what I have shared" }).first().click();
        }
      }
      savedAnswers += 1;
      await expect.poll(async () => await widget.locator(QUESTION).count()
        ? widget.locator(QUESTION).innerText() : "").not.toBe(text);

      // An independently opened brief is immediately available after the first answer.
      if (step === 0) {
        await page.getByRole("button", { name: "Lawyer brief", exact: true }).click();
        const brief = page.getByTestId("voice-screen-test-brief");
        await expect(brief).toBeVisible();
        await expect(brief.getByTestId("voice-screen-test-answer")).toHaveCount(1);
        await expect(brief).toContainText(firstQuestion);
        await checkLayout(page);
        await page.getByRole("button", { name: "Caller widget", exact: true }).click();
        await expect(widget).toBeVisible();
      }
    }

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(8);
    const finish = widget.getByRole("button", { name: "Finish with what I have shared", exact: true });
    if (await finish.count()) await finish.click();
    await expect(widget.getByRole("heading", { name: "Thank you. Your answers are ready for the firm." })).toBeVisible();
    await checkLayout(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-widget-completed.png`), fullPage: true });

    await page.getByRole("button", { name: "Lawyer brief", exact: true }).click();
    const brief = page.getByTestId("voice-screen-test-brief");
    await expect(brief).toContainText("Alex Morgan");
    await expect(brief.getByTestId("voice-screen-test-answer")).toHaveCount(savedAnswers);
    await checkLayout(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-brief-updated.png`), fullPage: true });

    await page.getByRole("button", { name: "Reset test", exact: true }).click();
    await page.getByRole("button", { name: "Caller widget", exact: true }).click();
    await expect(widget.locator(QUESTION)).toHaveText(firstQuestion);
    await page.getByRole("button", { name: "Lawyer brief", exact: true }).click();
    await expect(brief.getByTestId("voice-screen-test-answer")).toHaveCount(0);
    await assertNoServiceDependency(page, serviceCalls);
  });

  test(`brief opens directly with seeded call information at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const serviceCalls = monitorServiceCalls(page);
    await page.goto(BRIEF_ROUTE);
    const brief = page.getByTestId("voice-screen-test-brief");
    await expect(brief.getByRole("heading", { name: "One inquiry, with the answers together." })).toBeVisible();
    await expect(brief).toContainText("Alex Morgan");
    await expect(brief).toContainText("+1 416-555-0142");
    await expect(brief.getByTestId("voice-screen-test-answer")).toHaveCount(0);
    await checkLayout(page);
    await page.screenshot({ path: path.join(EVIDENCE, `${width}-brief-direct.png`), fullPage: true });
    await assertNoServiceDependency(page, serviceCalls);
  });
}

test("finishing immediately preserves the original inquiry without requiring answers", async ({ page }) => {
  const calls = monitorServiceCalls(page);
  await page.goto(WIDGET_ROUTE);
  const widget = page.locator(WIDGET);
  await widget.getByRole("button", { name: "Finish with what I have shared", exact: true }).click();
  await expect(widget.getByRole("heading", { name: "Thank you. Your answers are ready for the firm." })).toBeVisible();
  await page.getByRole("button", { name: "Lawyer brief", exact: true }).click();
  const brief = page.getByTestId("voice-screen-test-brief");
  await expect(brief).toContainText("Alex Morgan");
  await expect(brief.getByTestId("voice-screen-test-answer")).toHaveCount(0);
  await assertNoServiceDependency(page, calls);
});
