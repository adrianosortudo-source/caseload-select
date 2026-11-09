import { measureResidualCandidates } from "./residual-measurements";
import { auditRenderedCopy } from "./rendered-copy";
import { expect, test } from "@playwright/test";
import { completeFixture as fixture, partialFixture } from "./fixtures";
async function load(page: import("@playwright/test").Page, result = fixture) {
 await page.route("**/api/tools/positioning-check", route => route.fulfill({ json: result }));
 await page.goto("/tools/positioning-check"); await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
 await page.getByLabel("Your firm’s website").fill("https://example.ca/");
 await page.getByRole("button", { name: "Review my website", exact: true }).click();
 await expect(page.getByRole("heading", { name: "Your positioning review" })).toBeVisible();
}test("pasted HTTP, HTTPS and bare addresses all submit the secure website", async ({ page }) => {
 for (const input of ["http://galelaw.ca/", "  HTTPS://GALELAW.CA/  ", "galelaw.ca"]) {
  await page.route("**/api/tools/positioning-check", async route => { expect(route.request().postDataJSON()).toEqual({ url: "https://galelaw.ca/" }); await route.fulfill({ json: fixture }); });
  await page.goto("/tools/positioning-check"); await page.getByLabel("Your firm’s website").fill(input); await page.getByRole("button", { name: "Review my website" }).click();
  await expect(page.getByRole("heading", { name: "Your positioning review" })).toBeVisible(); await expect(page.getByLabel("Your firm’s website")).toHaveValue("https://galelaw.ca/");
  await page.unroute("**/api/tools/positioning-check");
 }
});
test("one report contains both parts and retains the complete evidence", async ({ page, context }) => {
 await context.grantPermissions(["clipboard-read", "clipboard-write"]);
 let calls = 0; page.on("request", request => { if(request.url().includes("/api/tools/positioning-check")) calls++; });
 await load(page);
 await expect(page.getByRole("heading", {name:"Your position today",exact:true})).toBeVisible();
 await expect(page.getByRole("heading", {name:"Possible directions",exact:true})).toBeVisible();
 expect(await page.locator("#pc-today-title").evaluate(el => !!(el.compareDocumentPosition(document.getElementById("pc-directions-title")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await expect(page.getByRole("tab")).toHaveCount(0); await expect(page.locator("details")).toHaveCount(0);
 await expect(page.getByRole("button",{name:"I’m unsure",exact:true})).toHaveAttribute("aria-pressed","true");
 const d=fixture.part2.directions[0];
 for(const item of fixture.part2.directions) await expect(page.getByRole("button",{name:item.label,exact:true})).toContainText(item.audienceSituation);
 await page.getByRole("button",{name:d.label,exact:true}).click();
 await expect(page.getByText(d.communicationImplication,{exact:true})).toBeVisible();
 await expect(page.getByText(d.tradeoff,{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Why we reached this reading",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Evidence",exact:true})).toBeFocused();
 await expect(page.locator(".pc-assessment")).toHaveCount(8);
 await expect(page.getByText(fixture.part1.statement,{exact:true})).toBeVisible();
 await expect(page.getByText(fixture.part1.rationale,{exact:true})).toBeVisible();
 for(const item of fixture.part2.directions) {
  await expect(page.getByText(item.possibleStatement,{exact:true})).toBeVisible();
  await expect(page.getByText(item.clientExpectation,{exact:true})).toBeVisible();
  for(const q of item.validationQuestions) await expect(page.getByText(q,{exact:true})).toBeVisible();
 }
 const source=fixture.part1.elements.find(a=>a.evidenceIds.length)!.evidenceIds[0];
 await page.locator(".pc-assessment").filter({has:page.locator('a[href="#evidence-'+source+'"]')}).first().locator('a[href="#evidence-'+source+'"]').click();
 await expect(page.locator("#evidence-"+source)).toBeFocused();
 await expect(page.locator("#evidence-"+source).getByRole("link",{name:"Read the source"})).toHaveAttribute("target","_blank");
 await page.getByRole("button",{name:"Return to report",exact:true}).first().click();
 await expect(page.getByRole("button",{name:d.label,exact:true})).toHaveAttribute("aria-pressed","true");
 await page.getByRole("button",{name:"Read this direction’s full reasoning",exact:true}).click();
 await expect(page.locator("#evidence-direction-"+d.id)).toBeFocused();
 await page.getByRole("button",{name:"Return to report",exact:true}).first().click();
 await page.getByRole("button",{name:"Explore next steps",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Next steps",exact:true})).toBeFocused();
 await expect(page.locator(".pc-next-steps>li")).toHaveCount(3);
 await expect(page.getByRole("link",{name:"Discuss your positioning"})).toHaveAttribute("href","https://caseloadselect.ca/conversation.html");
 await page.getByRole("button",{name:"Copy discussion brief"}).click();
 await expect(page.locator("p[role=status]")).toContainText("Discussion brief copied");
 const clipboard=await page.evaluate(()=>navigator.clipboard.readText());
 expect(clipboard).toContain(d.label); expect(clipboard).toContain(d.possibleStatement);
 for(const q of d.validationQuestions) expect(clipboard).toContain(q);
 await page.getByRole("button",{name:"Evidence and references",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Evidence",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Return to report",exact:true}).first().click();
 for(const [label,reading] of [["Keep the current direction","Retaining your present direction is a valid choice."],["I’m unsure","You do not need to choose now."]]) {
  await page.getByRole("button",{name:label,exact:true}).click(); await expect(page.getByText(reading,{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"Explore next steps",exact:true}).click();
  await page.getByRole("button",{name:"Copy discussion brief"}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(label==="I’m unsure"?"Unsure; discuss the options":label);
  await page.getByRole("button",{name:"Return to report",exact:true}).click();
  await expect(page.getByRole("button",{name:label,exact:true})).toHaveAttribute("aria-pressed","true");
 }
 expect(calls).toBe(1);
 await page.getByRole("button",{name:"Review another website",exact:true}).click();
 await page.getByLabel("Your firm’s website").fill("not a website");
 await page.getByRole("button",{name:"Review my website",exact:true}).click();
 await expect(page.getByRole("heading",{name:"The review could not finish"})).toBeFocused();
 await expect(page.getByRole("heading",{name:"Your positioning review"})).toHaveCount(0);
});
test("partial, unavailable image and null rating stay honest in evidence", async ({ page }) => {
 await load(page,partialFixture); await expect(page.getByRole("heading",{name:"This is a partial review"})).toBeVisible();
 await page.getByRole("button",{name:"View coverage limits",exact:true}).click(); await expect(page.locator("#evidence-coverage")).toBeFocused();
 await page.getByRole("button",{name:"Return to report",exact:true}).first().click();
 await page.getByRole("button",{name:"Why we reached this reading",exact:true}).click();
 const consistency=page.locator('[data-ui-component-content="assessment-consistency"]');
 await expect(consistency).toContainText("Not assessed"); await expect(consistency).toContainText("No confidence rating"); await expect(consistency).not.toContainText("0/3");
 await expect(page.getByText("Visual positioning was not assessed. No image-based conclusions are included.",{exact:true})).toBeVisible();
 await expect(page.locator('[data-ui-component-content="coverage"]')).toContainText("unavailable; not analysed");
});
test("unclear and conflicting main findings never appear certain", async ({page})=>{
 const result=structuredClone(fixture);
 const central=result.part1.elements.find(a=>a.key==="central_promise")!;
 central.status="not_assessable";central.confidence=null;central.clarity=null;central.conflict=true;
 const audience=result.part1.elements.find(a=>a.key==="audience")!;audience.status="unclear";audience.confidence="low";
 await load(page,result);
 await expect(page.locator('[data-ui-component-content="website-message"]')).toContainText("Not assessed · No confidence rating · Conflicting evidence");
 await expect(page.locator('[data-ui-component-content="fact-audience"]')).toContainText("Unclear · low confidence");
 await expect(page.locator('[data-ui-component-content="website-message"]')).not.toContainText("0/3");
});
test("provider failure has one explicit retry and no report", async ({ page }) => {
 await page.route("**/api/tools/positioning-check",route=>route.fulfill({status:503,json:{status:"error",code:"provider_unavailable",message:"The review service is unavailable. Try again shortly.",retryable:true}}));
 await page.goto("/tools/positioning-check");await page.addStyleTag({content:"nextjs-portal { display: none !important; }"});
 await page.getByLabel("Your firm’s website").fill("https://example.ca/");await page.getByRole("button",{name:"Review my website",exact:true}).click();
 await expect(page.locator(".pc-notice[role=alert]")).toContainText("unavailable");await expect(page.getByRole("button",{name:"Try again",exact:true})).toHaveCount(1);
 await expect(page.getByRole("heading",{name:"Your positioning review"})).toHaveCount(0);
});
for (const width of [1440,1024,768,640,390,375,320]) test("report fits "+width+"px with full-width component copy",async({page},testInfo)=>{
 await page.setViewportSize({width,height:1000});await load(page);
 async function capture(name:string){
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));});
  const result=await page.evaluate(auditRenderedCopy);
  if(result.failures.length){const measured=await page.evaluate(measureResidualCandidates,result.failures.map(f=>f.text));await testInfo.attach("residual-"+name+"-"+width+".json",{body:JSON.stringify(measured,null,2),contentType:"application/json"});}
  await page.screenshot({path:"test-results/positioning-check/"+name+"-"+width+".png",fullPage:true});
  expect.soft(result,name).toEqual({overflow:false,failures:[]});
 }
 await capture("brief-unsure");
 for(const d of fixture.part2.directions){await page.getByRole("button",{name:d.label,exact:true}).click();await capture("brief-"+d.id);}
 await page.getByRole("button",{name:"Why we reached this reading",exact:true}).click();await capture("evidence");
 await page.getByRole("button",{name:"Explore next steps",exact:true}).click();await capture("next-steps");
 await load(page,partialFixture);await capture("partial");await page.getByRole("button",{name:"Why we reached this reading",exact:true}).click();await capture("partial-evidence");
 await page.getByRole("button",{name:"Return to report",exact:true}).first().click();await page.getByRole("button",{name:"Review another website",exact:true}).click();
 await page.unroute("**/api/tools/positioning-check");
 await page.route("**/api/tools/positioning-check",route=>route.fulfill({status:503,json:{status:"error",code:"provider_unavailable",message:"The review service is unavailable. Try again shortly.",retryable:true}}));
 await page.getByRole("button",{name:"Review my website",exact:true}).click();await expect(page.locator(".pc-notice[role=alert]")).toBeVisible();await capture("provider-error");
 await page.unroute("**/api/tools/positioning-check");await page.route("**/api/tools/positioning-check",route=>route.fulfill({status:422,json:{status:"error",code:"blocked_or_unreadable",message:"We could not read enough public content at this secure address. Check that the website opens using https:// and try again.",retryable:true}}));
 await page.getByRole("button",{name:"Review my website",exact:true}).click();await expect(page.locator(".pc-notice[role=alert]")).toContainText("secure address");await capture("secure-address-error");
});
test("consultation action has readable contrast in both themes",async({page})=>{
 const luminance=(rgb:number[])=>rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 for(const colorScheme of ["light","dark"] as const){
  await page.emulateMedia({colorScheme});await page.setViewportSize({width:390,height:1000});await load(page);await page.getByRole("button",{name:"Explore next steps",exact:true}).click();
  const action=page.locator(".pc-actions .pc-button");const colors=await action.evaluate(el=>({foreground:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
  const parse=(s:string)=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);const fg=luminance(parse(colors.foreground)),bg=luminance(parse(colors.background));
  expect((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)).toBeGreaterThanOrEqual(4.5);
  await page.locator(".pc-actions").screenshot({path:"test-results/positioning-check/consultation-"+colorScheme+"-390.png"});
  await page.screenshot({path:"test-results/positioning-check/next-steps-"+colorScheme+"-390.png",fullPage:true});
 }
});

