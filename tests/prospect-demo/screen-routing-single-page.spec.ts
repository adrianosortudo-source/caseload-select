import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

const APP_URL = process.env.SCREEN_ROUTING_APP_PREVIEW?.replace(/\/$/, "") ?? "";
const SITE_URL = process.env.SCREEN_ROUTING_SITE_PREVIEW?.replace(/\/$/, "") ?? "";
const OIDC_TOKEN = process.env.SCREEN_ROUTING_OIDC_TOKEN ?? "";
const REPORTED_INPUT = "my ex wife wont allow me to enter our home and pick up my stuff";
const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;

type ExtractRequest = {
  description: string;
  matter_type: string;
  routing?: { selection: string; active_area: string; revision: number };
};

type MockResponder = (route: Route, request: ExtractRequest, ordinal: number) => Promise<void>;

async function observeSafeNetwork(page: Page) {
  const requests: ExtractRequest[] = [];
  const blockedPosts: string[] = [];
  const pageErrors: string[] = [];
  let responder: MockResponder | null = null;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      if (url.pathname === "/api/extract") {
        const body = request.postDataJSON() as ExtractRequest;
        requests.push(body);
        if (responder) await responder(route, body, requests.length);
        else await route.abort();
      } else {
        blockedPosts.push(request.url());
        await route.abort();
      }
      return;
    }
    const headers = OIDC_TOKEN && url.origin === APP_URL
      ? { ...request.headers(), "x-vercel-trusted-oidc-idp-token": OIDC_TOKEN }
      : request.headers();
    await route.continue({ headers });
  });
  return {
    requests,
    blockedPosts,
    pageErrors,
    setResponder(next: MockResponder | null) { responder = next; },
  };
}

test.beforeEach(() => {
  test.skip(!OIDC_TOKEN, "The paired Vercel preview requires an OIDC token supplied by the test runner.");
});

function mockExtraction(
  setResponder: (next: MockResponder | null) => void,
  responseFor: (request: ExtractRequest, ordinal: number) => Record<string, unknown>,
) {
  setResponder(async (route, request, ordinal) => {
    const json = responseFor(request, ordinal);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
  });
}

async function assertSingleDocument(page: Page, widgetVisible = true) {
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator("header.topbar")).toHaveCount(1);
  await expect(page.locator("#case-input")).toHaveCount(1);
  if (widgetVisible) await expect(page.locator("#case-input")).toBeVisible();
  const named = await page.locator("#case-input").evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    return input.labels?.length > 0 || Boolean(input.getAttribute("aria-label") || input.getAttribute("aria-labelledby"));
  });
  expect(named, "the inquiry text area needs a persistent accessible name").toBe(true);
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

test("direct, Tools, and legacy links reach the paired single-page demo without loading AI", async ({ page }) => {
  test.skip(!APP_URL || !SITE_URL, "Paired app and site preview URLs were not supplied.");
  const { requests, blockedPosts, pageErrors } = await observeSafeNetwork(page);

  const direct = await page.goto(`${APP_URL}/tools/screen`);
  expect(direct?.status()).toBe(200);
  await assertSingleDocument(page);
  expect(requests).toHaveLength(0);
  expect(blockedPosts).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);
  await settle(page);
  const inputBox = await page.locator("#case-input").boundingBox();
  expect(inputBox, "the inquiry control should be visible on the initial desktop viewport").not.toBeNull();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(720);

  await page.goto(`${SITE_URL}/tools.html`);
  const toolsLink = page.locator('a[href*="/tools/screen"]').first();
  await expect(toolsLink).toBeVisible();
  const destination = new URL((await toolsLink.getAttribute("href"))!, SITE_URL);
  expect(destination.origin).toBe(new URL(APP_URL).origin);
  expect(destination.pathname).toBe("/tools/screen");
  await toolsLink.click();
  await expect(page).toHaveURL(new RegExp(`${new URL(APP_URL).host.replaceAll(".", "\\.")}/tools/screen`));
  await assertSingleDocument(page);
  expect(requests).toHaveLength(0);

  await page.goto(`${SITE_URL}/tools/screen-demo.html?practice_area=family&channel=voice`);
  await expect(page).toHaveURL(new RegExp(`${new URL(APP_URL).host.replaceAll(".", "\\.")}/tools/screen`));
  expect(new URL(page.url()).searchParams.get("practice_area")).toBe("family");
  expect(new URL(page.url()).searchParams.get("channel")).toBe("voice");
  await assertSingleDocument(page, false);
  await expect(page.locator('[data-channel-panel="voice"]')).toBeVisible();
  await expect(page.locator("#firm-profile-select")).toHaveValue("family");
  await expect(page.locator('.channel-tab[data-channel="voice"]')).toHaveAttribute("aria-selected", "true");
  expect(requests).toHaveLength(0);
  expect(blockedPosts).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);
});

test("web reset rejects a late same-text result and confirmed selector changes retain the narrative", async ({ page }) => {
  test.skip(!APP_URL, "Paired app preview URL was not supplied.");
  const { requests, blockedPosts, pageErrors, setResponder } = await observeSafeNetwork(page);
  let releaseFirst!: () => void;
  let releaseThird!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const thirdResponseGate = new Promise<void>((resolve) => { releaseThird = resolve; });
  setResponder(async (route, request, ordinal) => {
    if (ordinal === 1 || ordinal === 3) {
      await (ordinal === 1 ? firstResponseGate : thirdResponseGate);
      const staleCandidate = ordinal === 1 ? "real_estate" : "family";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mode: "live", extracted: { __practice_area: staleCandidate } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mode: "live", extracted: { __practice_area: "family" } }) });
  });

  await page.goto(`${APP_URL}/tools/screen?practice_area=family`);
  await assertSingleDocument(page);
  await page.locator("#case-input").fill(REPORTED_INPUT);
  await page.locator("#screen-btn").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ description: REPORTED_INPUT, matter_type: "family_general", routing: { selection: "family", active_area: "family" } });
  await page.locator("#reset-btn").click();
  await expect(page.locator("#intake-hero")).toBeVisible();
  await page.locator("#firm-profile-select").selectOption("family");
  await page.locator("#case-input").fill(REPORTED_INPUT);
  await page.locator("#screen-btn").click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator("#intake-recap")).toBeVisible();
  releaseFirst();
  await expect(page.locator("#firm-profile-select")).toHaveValue("family");
  await expect(page.locator("#recap-text")).toContainText(REPORTED_INPUT);
  await expect(page.locator("#brief-mount")).not.toContainText("Residential Purchase and Sale");

  await page.locator("#edit-btn").click();
  await page.locator("#firm-profile-select").selectOption("family");
  await page.locator("#case-input").fill(REPORTED_INPUT);
  await page.locator("#screen-btn").click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({ description: REPORTED_INPUT, matter_type: "family_general", routing: { selection: "family", active_area: "family" } });
  await page.locator("#firm-profile-select").selectOption("real_estate");
  await expect(page.locator("#practice-area-notice")).toContainText("Start a new case in the selected area using this description?");
  await page.getByRole("button", { name: "Start new case", exact: true }).click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3]).toMatchObject({ description: REPORTED_INPUT, matter_type: "real_estate_general", routing: { selection: "real_estate", active_area: "real_estate" } });
  await expect(page.locator("#firm-profile-select")).toHaveValue("real_estate");
  await expect(page.locator("#recap-text")).toContainText(REPORTED_INPUT);
  await expect(page.getByText("Confirm the practice area", { exact: false })).toBeVisible();
  await expect(page.locator("#brief-mount")).not.toContainText("Family General");
  releaseThird();
  await expect(page.locator("#firm-profile-select")).toHaveValue("real_estate");
  await expect(page.locator("#brief-mount")).not.toContainText("Family General");
  expect(blockedPosts).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);
});

test("Voice pauses for area confirmation and visible channel tabs match the supported UI", async ({ page }) => {
  test.skip(!APP_URL, "Paired app preview URL was not supplied.");
  const { requests, blockedPosts, pageErrors, setResponder } = await observeSafeNetwork(page);
  mockExtraction(setResponder, () => ({ mode: "live", extracted: { __practice_area: "corporate" } }));
  await page.goto(`${APP_URL}/tools/screen?practice_area=family&channel=voice`);
  await assertSingleDocument(page, false);
  await expect(page.locator('[data-channel-panel="voice"]')).toBeVisible();
  const visibleChannels = await page.locator(".channel-tab[data-channel]").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-channel")));
  expect(visibleChannels).toEqual(["widget", "whatsapp", "sms", "instagram", "facebook", "voice"]);
  await expect(page.locator(".channel-tab[data-channel='gbp']")).toHaveCount(0);

  await page.locator("#voice-sim [data-sample-list] .voice-sample-play").first().click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].matter_type).toBe("family_general");
  expect(requests[0].routing).toMatchObject({ selection: "family", active_area: "family" });
  await expect(page.getByText("Confirm the practice area", { exact: false })).toBeVisible();
  await expect(page.locator("#brief-mount")).not.toContainText("Corporate General");
  await expect(page.locator("#voice-sim").getByRole("button", { name: /family/i })).toBeVisible();
  await page.locator("#voice-sim").getByRole("button", { name: /family/i }).click();
  await expect(page.locator("#firm-profile-select")).toHaveValue("family");
  expect(blockedPosts).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);
});

test("WhatsApp, SMS, Instagram, and Facebook let the visitor keep the selected area", async ({ page }) => {
  test.skip(!APP_URL, "Paired app preview URL was not supplied.");
  const { requests, blockedPosts, pageErrors, setResponder } = await observeSafeNetwork(page);
  mockExtraction(setResponder, () => ({ mode: "live", extracted: { __practice_area: "corporate" } }));

  for (const channel of ["whatsapp", "sms", "instagram", "facebook"] as const) {
    await page.goto(`${APP_URL}/tools/screen?practice_area=family&channel=${channel}`);
    await expect(page.locator(`#${channel}-examples .example-btn`).first()).toBeVisible();
    const expectedRequestCount = requests.length + 1;
    await page.locator(`#${channel}-examples .example-btn`).first().click();
    await expect.poll(() => requests.length).toBe(expectedRequestCount);
    const request = requests.at(-1)!;
    expect(request.matter_type, channel).toBe("family_general");
    expect(request.routing, channel).toMatchObject({ selection: "family", active_area: "family" });

    const simulator = page.locator(`#${channel}-sim`);
    await expect(simulator).toContainText(/confirm the practice area/i);
    await expect(page.locator("#brief-mount")).not.toContainText("Corporate General");
    if (channel === "sms") {
      await simulator.locator("[data-input]").fill("2");
    } else {
      const familyChoice = simulator.locator("button").filter({ hasText: /family/i }).last();
      await expect(familyChoice).toBeVisible();
      await familyChoice.click();
    }
    if (channel === "sms") await simulator.locator("[data-send]").click();
    await expect(page.locator("#brief-mount")).toContainText("Family General");
    await expect(page.locator("#firm-profile-select")).toHaveValue("family");
    expect(requests.length, `${channel} confirmation should not need another extraction`).toBe(expectedRequestCount);
  }
  expect(blockedPosts).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);
});

test("expanded report and conversation layout fit six widths", async ({ page }, testInfo: TestInfo) => {
  test.skip(!APP_URL, "Paired app preview URL was not supplied.");
  const { requests, blockedPosts, pageErrors, setResponder } = await observeSafeNetwork(page);
  mockExtraction(setResponder, () => ({ mode: "live", extracted: { __practice_area: "corporate" } }));
  await page.goto(`${APP_URL}/tools/screen?practice_area=corporate`);
  const longInput = `My cofounder and I each own half of a software company. A customer has not paid an $18,000 invoice for completed work, and the company needs to decide whether to continue the contract. We have a signed agreement and email records. ${"I want the lawyer to review the transaction history and explain what information is still needed. ".repeat(7)}`;
  await page.locator("#case-input").fill(longInput);
  await page.locator("#case-input").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#screen-btn")).toBeFocused();
  await page.locator("#case-input").fill(longInput);
  await page.locator("#screen-btn").click();
  await expect(page.locator("#intake-recap")).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ description: longInput, matter_type: "corporate_general", routing: { selection: "corporate", active_area: "corporate" } });
  await page.locator("#expand-brief").click();
  await expect(page.locator("#brief-mount")).toBeVisible();
  await expect(page.locator(".brief-frame .axis-block-score").first()).toBeVisible();
  await expect(page.locator(".brief-frame .nap-cell").first()).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    const metrics = await page.evaluate(() => {
      const report = document.querySelector<HTMLElement>(".brief-frame");
      const mainGrid = report?.querySelector<HTMLElement>(".brief-main-grid");
      const mainLeft = report?.querySelector<HTMLElement>(".brief-main-left");
      const cover = report?.querySelector<HTMLElement>(".brief-cover");
      const contact = report?.querySelector<HTMLElement>(".brief-group-nap");
      const napValues = Array.from(report?.querySelectorAll<HTMLElement>(".nap-value-missing") ?? []).map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return Array.from(range.getClientRects()).length;
      });
      const scoreRows = Array.from(report?.querySelectorAll<HTMLElement>(".axis-block-score") ?? []).map((element) => {
        const cell = element.closest<HTMLElement>(".axis-block");
        return { cellWidth: cell?.clientWidth ?? 0, scrollWidth: cell?.scrollWidth ?? 0 };
      });
      const scrollers = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => {
        const style = getComputedStyle(element);
        const overflowing = /^(auto|scroll)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
        return overflowing && !(element instanceof HTMLTextAreaElement);
      }).map((element) => element.className || element.id || element.tagName);
      return {
        viewport: document.documentElement.clientWidth,
        docWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        reportWidth: report?.clientWidth ?? 0,
        reportScrollWidth: report?.scrollWidth ?? 0,
        mainGridWidth: mainGrid?.clientWidth ?? 0,
        mainLeftWidth: mainLeft?.clientWidth ?? 0,
        coverWidth: cover?.clientWidth ?? 0,
        coverScrollWidth: cover?.scrollWidth ?? 0,
        contactWidth: contact?.clientWidth ?? 0,
        contactScrollWidth: contact?.scrollWidth ?? 0,
        napValues,
        napCellWidths: Array.from(report?.querySelectorAll<HTMLElement>(".nap-cell") ?? []).map((element) => element.clientWidth),
        scoreRows,
        scrollers,
        copy: document.body.innerText,
      };
    });
    expect(metrics.viewport).toBe(width);
    expect(metrics.docWidth).toBeLessThanOrEqual(width + 1);
    expect(metrics.bodyWidth).toBeLessThanOrEqual(width + 1);
    expect(metrics.scrollers, `unexpected nested page scroller at ${width}px`).toEqual([]);
    expect(metrics.copy).not.toMatch(/[—]/);
    if (width >= 1024) {
      expect(metrics.reportWidth).toBeGreaterThan(400);
      expect(metrics.reportScrollWidth).toBeLessThanOrEqual(metrics.reportWidth + 1);
      expect(metrics.mainLeftWidth).toBeGreaterThanOrEqual(metrics.mainGridWidth * 0.9);
    } else if (metrics.reportWidth > 0) {
      expect(metrics.reportScrollWidth).toBeLessThanOrEqual(metrics.reportWidth + 1);
    }
    expect(metrics.coverScrollWidth).toBeLessThanOrEqual(metrics.coverWidth + 1);
    expect(metrics.contactScrollWidth).toBeLessThanOrEqual(metrics.contactWidth + 1);
    expect(metrics.napCellWidths.length).toBeGreaterThan(0);
    expect(metrics.napCellWidths.every((cellWidth) => cellWidth >= 72), `contact cells should remain readable at ${width}px`).toBe(true);
    expect(metrics.napValues.every((lines) => lines <= 2), `NAP values should stay readable at ${width}px`).toBe(true);
    expect(metrics.scoreRows.length).toBeGreaterThan(0);
    expect(metrics.scoreRows.every((row) => row.scrollWidth <= row.cellWidth + 1), `score cells should fit at ${width}px`).toBe(true);
    if (width === 1440 || width === 375) {
      await page.screenshot({ path: testInfo.outputPath(`expanded-report-${width}.png`), fullPage: true });
    }
  }
  expect(blockedPosts).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);
});
