import { expect, test } from "@playwright/test";
import { capture, layout } from "./helpers";
import { STAGE_DEFINITIONS } from "../../src/lib/desired-client/screens";

for (const width of [1440, 1024, 768, 640, 375, 320]) {
  test("welcome and first step fit at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tools/desired-client-matter");
    await expect(page.getByRole("heading", { name: "Define your desired client" })).toBeVisible();
    await expect(page.getByText("A firm can have a full calendar and still be building the wrong practice.", { exact: false })).toBeVisible();
    await expect(page.getByText("about 10 minutes", { exact: false })).toBeVisible();
    await layout(page);
    if (width === 1440 || width === 320) await capture(page, "orientation-" + width + "-welcome");
    await page.getByRole("button", { name: "Define my desired client" }).click();
    await expect(page.getByText(STAGE_DEFINITIONS[0].explanation)).toBeVisible();
    await layout(page);
    if (width === 1440 || width === 320) await capture(page, "orientation-" + width + "-practice");
  });
}

test("the six sections explain their purpose and allow explicit unknowns", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Define my desired client" }).click();

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
  await page.getByRole("button",{name:"Define my desired client"}).click();
  await expect(page.getByRole("status").filter({hasText:"AI follow-up questions are unavailable right now"})).toBeVisible();
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
  await page.getByRole("button",{name:"Define my desired client"}).click();
  await page.getByRole("checkbox",{name:/Allow up to three short AI follow-up questions/}).check();
  await page.getByRole("group",{name:"What do you want this profile to help your firm do?"}).getByRole("radio").last().check();
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await expect(page.getByText(STAGE_DEFINITIONS[1].explanation)).toBeVisible();
  await expect(page.locator(".dc-stage > .dc-alert")).toContainText("AI follow-up questions are unavailable right now");
  expect(postRequests).toBe(1);

  await page.getByRole("button",{name:STAGE_DEFINITIONS[0].label}).click();
  await expect(page.getByRole("status").filter({hasText:"AI follow-up questions are unavailable right now"})).toBeVisible();
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
  await page.getByRole("button", { name: "Define my desired client" }).click();
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
  await expect(notice).toHaveText("This draft has reached its limit for AI follow-up checks. Your answers are saved, and you can continue without another AI follow-up.");
  expect(clarificationRequests).toBe(7);

  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(notice).toBeVisible();
    await layout(page, ".dc-stage > .dc-alert");
    if (width === 1440 || width === 320) await page.screenshot({ path: testInfo.outputPath(`follow-up-limit-${width}.png`), fullPage: true });
  }
});
