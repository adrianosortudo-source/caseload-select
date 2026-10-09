import { completeAnswers, validBlueprint } from "../../src/lib/desired-client/__tests__/blueprint-helpers";
import { validateAnalysisResult } from "../../src/lib/desired-client/output";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { capture, exportedLayout, layout, layoutFailures, settled } from "./helpers";
import { STAGE_DEFINITIONS } from "../../src/lib/desired-client/screens";

for (const width of [1440, 1024, 768, 640, 390, 375, 320]) {
  test("welcome and first step fit at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tools/desired-client-matter");
    await expect(page.getByRole("heading", { name: "Define the work you want" })).toBeVisible();
    await page.getByText("About the exercise", { exact: true }).click();
    await expect(page.getByText("A firm can have a full calendar and still be building the wrong practice.", { exact: false })).toBeVisible();
    await expect(page.getByText("about 10 minutes", { exact: false })).toBeVisible();
    await page.getByText("About the exercise", { exact: true }).click();
    await layout(page);
    if (width === 1440 || width === 320) await capture(page, "orientation-" + width + "-welcome");
    await page.getByRole("button", { name: "Build my profile" }).first().click();
    await expect(page.getByText(STAGE_DEFINITIONS[0].explanation)).toBeVisible();
    await layout(page);
    if (width === 1440 || width === 320) await capture(page, "orientation-" + width + "-practice");
  });
}

test("the six sections explain their purpose and allow explicit unknowns", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Build my profile" }).first().click();

  const group = (name: string) => page.getByRole("group", { name, exact: true });
  const chooseLast = async (name: string, role: "radio" | "checkbox" = "radio") => group(name).getByRole(role).last().check();
  const continueToNext = async (stage: number) => {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (stage < 7) await expect(page.getByText(STAGE_DEFINITIONS[stage - 1].explanation)).toBeVisible();
    else await expect(page.getByRole("heading", { name: STAGE_DEFINITIONS[stage - 1].heading })).toBeVisible();
  };

  await chooseLast("What do you want this profile to help your firm do?");
  await continueToNext(2);
  await page.getByLabel("Practice area for the work list").selectOption({ label: "Business & commercial" });
  await chooseLast("Which type of legal work should we focus on?");
  await chooseLast("How much experience does the firm have with this type of work?");
  await chooseLast("Who is the client in this situation?");
  await chooseLast("What event or situation creates the need for legal help?");
  await chooseLast("At what stage does the client usually contact a lawyer?");
  await page.getByLabel("Which specific matter and legal work would the firm welcome again?").fill("A buyer of an established business needs an asset purchase agreement reviewed before final terms are agreed.");
  await chooseLast("What progress does this client want?");
  await continueToNext(3);
  await chooseLast("Why would the firm choose this work again?", "checkbox");
  await chooseLast("How does the fee compare with the effort?");
  await continueToNext(4);
  await chooseLast("What is most likely to matter to this client when choosing a firm?", "checkbox");
  await chooseLast("Which strength can your firm bring to this matter?");
  await continueToNext(5);
  await chooseLast("Which early signs would make this matter worth a closer look?", "checkbox");
  await continueToNext(6);
  await chooseLast("What evidence has the firm seen for this type of work?", "checkbox");
  await chooseLast("What would the firm want to review over time? (optional)");
  await continueToNext(7);
  await expect(page.getByRole("heading", { name: "Review your direction" })).toBeVisible();
  await expect(page.getByText("Not sure", { exact: true })).toBeVisible();
  await layout(page);
  await capture(page, "orientation-768-review");
});

test("known-disabled AI hides follow-up consent and continues without a request",async({page})=>{
  let postRequests=0;
  await page.route("**/api/tools/desired-client-matter/analyze",async apiRoute=>{
    if(apiRoute.request().method()==="GET"){
      await apiRoute.fulfill({status:200,contentType:"application/json",body:JSON.stringify({enabled:false})});
      return;
    }
    postRequests+=1;
    await apiRoute.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"AI_DISABLED"}})});
  });

  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button",{name:"Build my profile"}).first().click();
  await expect(page.getByRole("status").filter({hasText:"AI follow-ups are unavailable"})).toBeVisible();
  await expect(page.getByRole("checkbox",{name:/Allow up to three short AI follow-up questions/})).toHaveCount(0);
  await page.getByRole("group",{name:"What do you want this profile to help your firm do?"}).getByRole("radio").last().check();
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await expect(page.getByText(STAGE_DEFINITIONS[1].explanation)).toBeVisible();
  expect(postRequests).toBe(0);
});

test("an explicit AI_DISABLED follow-up response updates availability without spending a question",async({page})=>{
  let postRequests=0;
  await page.route("**/api/tools/desired-client-matter/analyze",async apiRoute=>{
    if(apiRoute.request().method()==="GET"){
      await apiRoute.fulfill({status:200,contentType:"application/json",body:JSON.stringify({enabled:true})});
      return;
    }
    postRequests+=1;
    await apiRoute.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"AI_DISABLED"}})});
  });

  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button",{name:"Build my profile"}).first().click();
  await page.getByRole("checkbox",{name:/Allow up to three short AI follow-up questions/}).check();
  await page.getByRole("group",{name:"What do you want this profile to help your firm do?"}).getByRole("radio").last().check();
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await expect(page.getByText(STAGE_DEFINITIONS[1].explanation)).toBeVisible();
  await expect(page.locator(".dc-stage > .dc-alert")).toContainText("AI follow-ups are unavailable");
  expect(postRequests).toBe(1);

  await page.getByRole("button",{name:STAGE_DEFINITIONS[0].label}).click();
  await expect(page.getByRole("status").filter({hasText:"AI follow-ups are unavailable"})).toBeVisible();
  await expect(page.getByRole("checkbox",{name:/Allow up to three short AI follow-up questions/})).toHaveCount(0);
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await expect(page.getByText(STAGE_DEFINITIONS[1].explanation)).toBeVisible();
  expect(postRequests).toBe(1);
});

test("a spent local follow-up budget is explained accurately and wraps at every supported width", async ({ page }, testInfo) => {
  let clarificationRequests = 0;
  await page.route("**/api/tools/desired-client-matter/analyze", async apiRoute => {
    if (apiRoute.request().method() === "GET") {
      await apiRoute.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true }) });
      return;
    }
    clarificationRequests += 1;
    await apiRoute.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "AI_UNAVAILABLE" } }) });
  });

  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Build my profile" }).first().click();
  await page.locator('[data-ui-component-content="desired-client-ai-follow-up"] input[type="checkbox"]').check();

  const group = (name: string) => page.getByRole("group", { name, exact: true });
  const chooseLast = async (name: string, role: "radio" | "checkbox" = "radio") => group(name).getByRole(role).last().check();
  const continueToNext = async (stage: number) => {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (stage < 7) await expect(page.getByText(STAGE_DEFINITIONS[stage - 1].explanation)).toBeVisible();
    else await expect(page.getByRole("heading", { name: STAGE_DEFINITIONS[stage - 1].heading })).toBeVisible();
  };

  await chooseLast("What do you want this profile to help your firm do?");
  await continueToNext(2);
  await page.getByLabel("Practice area for the work list").selectOption({ label: "Business & commercial" });
  await chooseLast("Which type of legal work should we focus on?");
  await chooseLast("How much experience does the firm have with this type of work?");
  await chooseLast("Who is the client in this situation?");
  await chooseLast("What event or situation creates the need for legal help?");
  await chooseLast("At what stage does the client usually contact a lawyer?");
  await page.getByLabel("Which specific matter and legal work would the firm welcome again?").fill("A buyer of an established business needs an asset purchase agreement reviewed before final terms are agreed.");
  await chooseLast("What progress does this client want?");
  await continueToNext(3);
  await chooseLast("Why would the firm choose this work again?", "checkbox");
  await chooseLast("How does the fee compare with the effort?");
  await continueToNext(4);
  await chooseLast("What is most likely to matter to this client when choosing a firm?", "checkbox");
  await chooseLast("Which strength can your firm bring to this matter?");
  await continueToNext(5);
  await chooseLast("Which early signs would make this matter worth a closer look?", "checkbox");
  await continueToNext(6);
  await chooseLast("What evidence has the firm seen for this type of work?", "checkbox");
  await chooseLast("What would the firm want to review over time? (optional)");
  await continueToNext(7);
  expect(clarificationRequests).toBe(6);

  // The practice-area and matter choices intentionally start a fresh
  // clarification run, so the first stage's earlier failed request is not
  // part of this run's six-request budget. Revisit Focus once to spend the
  // sixth request, then revisit it again to verify the local cap.
  await page.getByRole("button", { name: STAGE_DEFINITIONS[0].label }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(STAGE_DEFINITIONS[1].explanation)).toBeVisible();
  expect(clarificationRequests).toBe(7);

  await page.getByRole("button", { name: STAGE_DEFINITIONS[0].label }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const notice = page.locator(".dc-stage > .dc-alert");
  await expect(notice.locator("p")).toHaveText([
    "The local follow-up request budget has reached its limit.",
    "Your answers are saved.",
    "Continue without AI follow-up.",
  ]);
  expect(clarificationRequests).toBe(7);

  for (const width of [1440, 1024, 768, 640, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(notice).toBeVisible();
    await layout(page, ".dc-stage > .dc-alert--notice p");
    if (width === 1440 || width === 320) await page.screenshot({ path: testInfo.outputPath(`follow-up-limit-${width}.png`), fullPage: true });
  }
});

test("canonical branding spans the landing, questionnaire, review, failure, report and offline export", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const widths = [1440, 1024, 768, 640, 390, 375, 320];
  const fixture = completeAnswers();
  const generated = validateAnalysisResult(validBlueprint(fixture), fixture, [])!;
  let release: (() => void) | undefined;
  let failNext = true;
  let postCount = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as Window & { copiedProfile?: string }).copiedProfile = text; } } });
    window.print = () => { (window as Window & { printRequested?: boolean }).printRequested = true; };
  });
  await page.route("**/api/tools/desired-client-matter/analyze", async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true }) });
    postCount++;
    const request = route.request().postDataJSON();
    await new Promise<void>(resolve => { release = resolve; });
    if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "AI_UNAVAILABLE" } }) }); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, requestId: request.requestId, answerRevision: request.answerRevision, reviewRunId: request.reviewRunId, result: generated }) });
  });
  const fontsAndSurfaces = async () => {
    await settled(page);
    const issues = await page.evaluate(async () => {
      const issues: string[] = [];
      for (const [weight, family] of [[800, "DC Manrope"], [400, "DC DM Sans"], [600, "DC Oxanium"]] as const) {
        const loaded = await document.fonts.load(`${weight} 16px "${family}"`);
        if (!loaded.length || loaded.some(face => face.status !== "loaded")) issues.push("Font not loaded: " + family);
      }
      for (const element of document.querySelectorAll<HTMLElement>(".dc-route h1,.dc-route h2,.dc-route h3,.dc-route .dc-question__legend")) {
        if (!element.checkVisibility()) continue;
        const style = getComputedStyle(element);
        if (element.matches(".eyebrow,.detail-label,.dc-report-definition h2")) continue;
        if (!style.fontFamily.includes("DC Manrope") || style.fontWeight !== "800") issues.push("Incorrect heading type: " + element.textContent);
      }
      for (const element of document.querySelectorAll<HTMLElement>(".dc-route button,.dc-route dialog,.dc-route .dc-report-card,.dc-route .dc-option,.dc-route .dc-evidence-label")) {
        if (!element.checkVisibility()) continue;
        const style = getComputedStyle(element);
        if (style.borderRadius !== "0px" || style.boxShadow !== "none") issues.push("Noncanonical surface: " + element.className);
      }
      const channels = (color: string) => color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [255, 255, 255];
      const luminance = (rgb: number[]) => rgb.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      for (const element of document.querySelectorAll<HTMLElement>(".dc-route [data-ui-copy],.dc-route button,.dc-route a")) {
        if (!element.checkVisibility({ checkOpacity: true }) || element.matches(":disabled") || element.closest("details:not([open])") || !element.textContent?.trim()) continue;
        const style = getComputedStyle(element);
        let ancestor: HTMLElement | null = element;
        let background = "rgb(255, 255, 255)";
        while (ancestor) {
          const candidate = getComputedStyle(ancestor).backgroundColor;
          if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") { background = candidate; break; }
          ancestor = ancestor.parentElement;
        }
        const foregroundL = luminance(channels(style.color)), backgroundL = luminance(channels(background));
        const contrast = (Math.max(foregroundL, backgroundL) + .05) / (Math.min(foregroundL, backgroundL) + .05);
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        if (contrast < (large ? 3 : 4.5)) issues.push(`Low contrast (${contrast.toFixed(2)}): ${element.textContent}`);
      }
      return issues;
    });
    expect(issues).toEqual([]);
  };
  const audit = async (state: string, selector?: string) => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await fontsAndSurfaces();
      expect.soft(await layoutFailures(page, selector), `${state} at ${width}px`).toEqual([]);
      // Assertions cover every width. Keep transient-state captures compact enough
      // to finish within the real analysis timeout on slower local machines.
      if (["welcome", "start", "review", "report"].includes(state) || width === 1440 || width === 320)
        await page.screenshot({ path: testInfo.outputPath(`branding-${state}-${width}.png`), fullPage: true, style: "nextjs-portal{visibility:hidden}" });
    }
  };
  await page.goto("/tools/desired-client-matter");
  await audit("welcome");
  expect(await page.locator(".terminal-square").count()).toBe(1);
  expect(await page.locator(".dc-landing").innerText()).not.toMatch(/Visual prototype|saved-draft demo|dummy/i);
  const firstTab = page.getByRole("tab", { name: "Matter", exact: true });
  await firstTab.focus();
  expect(await firstTab.evaluate(element => { const style = getComputedStyle(element); return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2; })).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Goals", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel")).toContainText("Evidence to test");
  await page.keyboard.press("Home");
  await expect(firstTab).toBeFocused();
  for (let index = 0; index < 6; index++) {
    await page.getByRole("tab").nth(index).click();
    await audit("example-" + index, ".dc-landing [data-ui-copy]");
  }
  await page.getByRole("button", { name: "Build my profile", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await audit("start");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Define the work you want", exact: true })).toBeVisible();
  // Seed an existing complete synthetic draft, using the production storage contract.
  await page.evaluate(answers => {
    const now = Date.now();
    localStorage.setItem("cls-desired-client-v2", JSON.stringify({ schemaVersion: 2, answers, currentStage: 7, lastEditedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400000).toISOString() }));
  }, fixture);
  await page.reload();
  await page.getByRole("button", { name: "Start a new draft", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await audit("dialog", ".dc-dialog [data-ui-copy]");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Continue my profile", exact: true }).first().click();
  for (const stage of STAGE_DEFINITIONS.slice(0, 6)) {
    await page.getByRole("button", { name: stage.label, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await audit("stage-" + stage.id);
  }
  await page.getByRole("button", { name: STAGE_DEFINITIONS[6].label, exact: true }).click();
  await audit("review");
  await page.getByRole("button", { name: "Create my Desired Client Blueprint", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connecting your answers" })).toBeVisible();
  await audit("loading");
  await expect.poll(() => Boolean(release)).toBe(true);
  release!(); release = undefined;
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await audit("error");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  release!(); release = undefined;
  await expect(page.locator(".dc-brief")).toBeVisible();
  await audit("report");
  await page.getByRole("button", { name: "Copy profile", exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { copiedProfile?: string }).copiedProfile)).toContain("OUR DESIRED-CLIENT DEFINITION");
  expect(await page.evaluate(() => (window as Window & { copiedProfile?: string }).copiedProfile)).toContain("CLIENT DECISION PATHWAY");
  await page.getByRole("button", { name: "Yes, this reflects our direction", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Continue my profile", exact: true }).first().click();
  await expect(page.getByText("Wording reviewed", { exact: true }).first()).toBeVisible();
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML report", exact: true }).click();
  const file = testInfo.outputPath("branded-offline-report.html");
  await (await downloadReady).saveAs(file);
  const exported = await page.context().newPage();
  const external: string[] = [];
  exported.on("request", request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await exported.goto(pathToFileURL(file).href);
  await exported.evaluate(() => document.fonts.ready);
  for (const width of widths) {
    await exported.setViewportSize({ width, height: 1000 });
    await exportedLayout(exported);
    expect(await exported.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await exported.evaluate(() => document.fonts.check('800 16px "DC Manrope"') && document.fonts.check('400 16px "DC DM Sans"') && document.fonts.check('600 16px "DC Oxanium"'))).toBe(true);
    await exported.screenshot({ path: testInfo.outputPath(`branding-html-${width}.png`), fullPage: true });
  }
  expect(external).toEqual([]);
  await exported.emulateMedia({ media: "print" });
  const pdf = await exported.pdf({ path: testInfo.outputPath("branding-report-print.pdf"), printBackground: true });
  expect(pdf.byteLength).toBeGreaterThan(0);
  await exported.close();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".dc-report-logo")).toBeVisible();
  const appPrint = await page.pdf({ path: testInfo.outputPath("branding-app-print.pdf"), printBackground: true });
  expect(appPrint.byteLength).toBeGreaterThan(0);
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: /Print/ }).click();
  expect(await page.evaluate(() => (window as Window & { printRequested?: boolean }).printRequested)).toBe(true);
  await page.getByRole("button", { name: "Edit the definition", exact: true }).click();
  await expect(page.getByRole("heading", { name: STAGE_DEFINITIONS[1].heading, exact: true })).toBeVisible();
  expect(postCount).toBe(2);
});
