import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";

const ADMIN_ROUTE = "/admin/prospect-demos";
const STANDALONE_ROUTE = "/demo/prospect/walker-law";
const ROOT = "[data-prospect-demo-presentation]";
const INTAKE = "[data-prospect-demo-intake-overlay]";
const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const TEST_SECRET = "prospect-demo-rendered-test-only-not-a-production-secret";

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function authenticate(page: Page) {
  const payload = Buffer.from(JSON.stringify({
    firm_id: "00000000-0000-4000-8000-000000000264",
    lawyer_id: "00000000-0000-4000-8000-000000000263",
    role: "operator",
    exp: Date.now() + 3_600_000,
  })).toString("base64url");
  const signature = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
  await page.context().addCookies([{
    name: "portal_session", value: `${payload}.${signature}`,
    url: "http://127.0.0.1:3109", httpOnly: true, sameSite: "Lax",
  }]);
}

async function assertStandaloneChrome(page: Page) {
  await expect(page).toHaveURL(/\/demo\/prospect\/[^/?#]+/);
  await expect(page.getByText("Operator console", { exact: true })).toHaveCount(0);
  await expect(page.getByText("CaseLoad Select operator console", { exact: true })).toHaveCount(0);
  await expect(page.locator('form[action="/api/operator/logout"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Build or import", exact: true })).toHaveCount(0);
}

async function openDemo(page: Page) {
  await authenticate(page);
  const response = await page.goto(STANDALONE_ROUTE);
  expect(response?.status()).toBe(200);
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("img-src 'self' data: https:");
  expect(policy).toContain("frame-ancestors 'none'");
  await expect(page.locator(ROOT)).toBeVisible();
  await expect(page.locator(`${INTAKE} textarea`)).toBeVisible();
  await assertStandaloneChrome(page);
  await settle(page);
}

async function openAdminBuilder(page: Page) {
  await authenticate(page);
  const response = await page.goto(ADMIN_ROUTE);
  expect(response?.status()).toBe(200);
  await expect(page.locator("[data-ui-component-content='prospect-demo-builder']")).toBeVisible();
  await settle(page);
}

async function assertImages(page: Page, selector = `${ROOT} img`) {
  await expect.poll(async () => page.locator(selector).evaluateAll((images) => {
    const visible = images.filter((image) => image.getClientRects().length > 0);
    return visible.length > 0 && visible.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
  })).toBe(true);
}

async function assertLayout(page: Page, rootSelector = ROOT) {
  await settle(page);
  const failures = await page.locator(rootSelector).evaluate((root) => {
    const failures: string[] = [];
    const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) failures.push("Document scrolls horizontally");
    if (document.body.scrollWidth > document.documentElement.clientWidth + 1) failures.push("Body scrolls horizontally");
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      const label = element.getAttribute("aria-label") ?? element.dataset.uiComponentContent ?? element.tagName;
      if (/^(auto|scroll)$/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) failures.push(`${label} has an internal horizontal scrollbar`);
      if (/^(auto|scroll)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) failures.push(`${label} has an internal vertical scrollbar`);
      if (element instanceof HTMLTextAreaElement && element.scrollHeight > element.clientHeight + 1) failures.push(`${label} clips its text`);
    }
    const overlay = root.querySelector<HTMLElement>("[data-prospect-demo-intake-overlay]");
    if (overlay && visible(overlay)) {
      if (overlay.scrollHeight > overlay.clientHeight + 1) failures.push("Intake height does not fit its content");
      if (overlay.scrollWidth > overlay.clientWidth + 1) failures.push("Intake width does not fit its content");
    }
    for (const copy of root.querySelectorAll<HTMLElement>("[data-ui-copy]")) {
      if (!visible(copy) || copy.dataset.uiCopyException) continue;
      const component = copy.closest<HTMLElement>("[data-ui-component-content]");
      if (!component) { failures.push("Tagged copy has no component"); continue; }
      const name = `${component.dataset.uiComponentContent}:${copy.dataset.uiCopy}:${copy.innerText.slice(0, 55)}`;
      const componentBox = component.getBoundingClientRect();
      const componentStyle = getComputedStyle(component);
      const left = componentBox.left + parseFloat(componentStyle.borderLeftWidth) + parseFloat(componentStyle.paddingLeft);
      const right = componentBox.right - parseFloat(componentStyle.borderRightWidth) - parseFloat(componentStyle.paddingRight);
      const box = copy.getBoundingClientRect();
      if (Math.abs(box.left - left) > 1.1 || Math.abs(box.right - right) > 1.1) failures.push(`${name} does not fill usable width`);
      const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
      const words: Array<{ id: number; top: number; left: number; right: number; word: string }> = [];
      let node: Node | null;
      let id = 0;
      while ((node = walker.nextNode())) {
        for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index ?? 0);
          range.setEnd(node, (match.index ?? 0) + match[0].length);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width && rect.height) words.push({ id, top: rect.top, left: rect.left, right: rect.right, word: match[0] });
          }
          id += 1;
        }
      }
      const lines: Array<typeof words> = [];
      for (const word of words.sort((a, b) => a.top - b.top || a.left - b.left)) {
        const line = lines.find((candidate) => Math.abs(candidate[0].top - word.top) <= 1);
        if (line) line.push(word); else lines.push([word]);
      }
      if (lines.length > 1 && new Set(lines.at(-1)?.map((word) => word.id)).size === 1) failures.push(`${name} has a one-word final line`);
      for (let index = 0; index < lines.length - 1; index += 1) {
        const line = lines[index];
        const next = lines[index + 1][0];
        const used = line.at(-1)!.right - line[0].left;
        if (line.length >= 3 && used / (right - left) < 0.75 && next.right - next.left + 5 <= right - line.at(-1)!.right) failures.push(`${name} leaves avoidable line space before ${next.word}`);
      }
      if (copy.innerText.includes("—")) failures.push(`${name} includes an em dash`);
    }
    return failures;
  });
  expect(failures).toEqual([]);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.assign(window, { prospectDemoCspViolations: [] as string[] });
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { prospectDemoCspViolations: string[] }).prospectDemoCspViolations.push(`${event.effectiveDirective}:${event.blockedURI}`);
    });
  });
});

for (const width of WIDTHS) {
  test(`Website, split and full-height input render at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    const mutations: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) mutations.push(`${request.method()} ${request.url()}`); });
    await page.setViewportSize({ width, height: 900 });
    await openDemo(page);
    await assertImages(page);
    await assertLayout(page);
    await page.screenshot({ path: testInfo.outputPath(`website-${width}.png`), fullPage: true });
    const textarea = page.locator(`${INTAKE} textarea`);
    const initial = await textarea.inputValue();
    const longDescription = "A fictional business is owed money for completed services. The client has the signed proposal, invoice, and email messages. ".repeat(26);
    await textarea.fill(longDescription);
    await assertLayout(page);
    await page.getByRole("button", { name: "Split view", exact: true }).click();
    await expect(textarea).toHaveValue(longDescription);
    await assertImages(page);
    await assertLayout(page);
    await textarea.fill(initial);
    await assertLayout(page);
    await page.screenshot({ path: testInfo.outputPath(`split-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Lawyer view", exact: true }).click();
    await assertLayout(page);
    await page.getByRole("button", { name: "Website", exact: true }).click();
    await expect(textarea).toHaveValue(initial);
    expect(errors).toEqual([]);
    expect(mutations).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { prospectDemoCspViolations: string[] }).prospectDemoCspViolations)).toEqual([]);
  });
}

test("Guided intake reaches the brief and keeps answers across view switches", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const mutations: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (/maximum update depth/i.test(message.text())) errors.push(message.text()); });
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) mutations.push(`${request.method()} ${request.url()}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await page.getByRole("button", { name: "Split view", exact: true }).click();
  await page.getByRole("button", { name: "Continue matter review", exact: true }).click();
  await expect(page.getByText("Review in progress", { exact: true }).first()).toBeVisible();
  for (let count = 0; count < 12; count += 1) {
    const contact = page.getByRole("button", { name: "Continue to contact details", exact: true });
    if (await contact.isVisible()) { await contact.click(); break; }
    if (await page.locator('input[name="client_name"]').isVisible()) break;
    const skip = page.getByRole("button", { name: "Skip this question", exact: true });
    await expect(skip).toBeVisible();
    await skip.click();
    await settle(page);
  }
  await page.locator('input[name="client_name"]').fill("Fictional Alex");
  await page.locator('input[name="client_phone"]').fill("4165550123");
  await page.locator('input[name="client_email"]').fill("alex@example.test");
  await page.getByRole("button", { name: "Lawyer view", exact: true }).click();
  await page.getByRole("button", { name: "Split view", exact: true }).click();
  await expect(page.locator('input[name="client_name"]')).toHaveValue("Fictional Alex");
  await page.getByRole("button", { name: "Complete demonstration", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The demonstration is complete." })).toBeVisible();
  await expect(page.getByText("Brief ready", { exact: true }).first()).toBeVisible();
  await assertImages(page);
  await assertLayout(page);
  await page.screenshot({ path: testInfo.outputPath("completed-brief.png"), fullPage: true });
  expect(errors).toEqual([]);
  expect(mutations).toEqual([]);
});

test("Exported prospect package imports, persists, and reloads under the real image policy", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdminBuilder(page);
  const builder = "[data-ui-component-content='prospect-demo-builder']";
  await expect(page.getByRole("button", { name: "Export selected", exact: true })).toBeEnabled();
  await assertImages(page, `${builder} img`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await fs.readFile(downloadPath!, "utf8"));
  exported.profile.id = "qa-imported-prospect";
  exported.profile.slug = "qa-imported-prospect";
  exported.profile.firmName = "Imported Demo Firm";
  exported.profile.websiteTitle = "Imported Demo Firm website";
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: "imported-prospect.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByText("Imported Demo Firm was imported into this browser.")).toBeVisible();
  await assertImages(page, `${builder} img`);
  const standalonePromise = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Open website demo", exact: true }).click();
  const standalone = await standalonePromise;
  await standalone.waitForLoadState("domcontentloaded");
  await expect(standalone).toHaveURL(/\/demo\/prospect\/qa-imported-prospect$/);
  await expect(standalone.getByRole("heading", { name: "Imported Demo Firm intake preview" })).toBeVisible();
  await assertStandaloneChrome(standalone);
  await assertImages(standalone);
  await assertLayout(standalone);
  await standalone.reload();
  await expect(standalone.locator(ROOT)).toBeVisible();
  await expect(standalone.getByRole("heading", { name: "Imported Demo Firm intake preview" })).toBeVisible();
  await assertStandaloneChrome(standalone);
  await assertImages(standalone);
  await assertLayout(standalone);
  await standalone.screenshot({ path: testInfo.outputPath("imported-profile-reloaded.png"), fullPage: true });
  expect(await standalone.evaluate(() => (window as unknown as { prospectDemoCspViolations: string[] }).prospectDemoCspViolations)).toEqual([]);
});
