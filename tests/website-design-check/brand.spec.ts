import { expect, test, type Page, type Frame } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./fixture";

const WIDTHS = [1440, 1024, 768, 640, 375, 320];
const EVIDENCE = path.join(process.cwd(), "test-results/website-design-check-evidence");

async function settle(page: Page | Frame) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function brandGates(page: Page | Frame) {
  await settle(page);
  const failures = await page.evaluate(() => {
    const failures: string[] = [];
    const scope = document.querySelector<HTMLElement>(".dc-page")!;
    const number = (value: string) => Number.parseFloat(value) || 0;
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const lum = (color: number[]) => color.slice(0,3).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((v,c,i) => v + c * [0.2126,0.7152,0.0722][i],0);
    if (document.documentElement.scrollWidth > innerWidth) failures.push("page overflows horizontally");
    if (scope.querySelector(".ts")) failures.push("ineligible terminal square");
    for (const el of scope.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (number(style.borderRadius)) failures.push(`${el.className}: rounded geometry`);
      if (style.fontStyle === "italic") failures.push(`${el.className}: italics`);
    }
    for (const h of scope.querySelectorAll<HTMLElement>("h1,h2,h3")) {
      if (!getComputedStyle(h).fontFamily.toLowerCase().includes("manrope")) failures.push(`${h.className}: heading font`);
    }
    for (const copy of scope.querySelectorAll<HTMLElement>("[data-ui-copy]")) {
      const rect = copy.getBoundingClientRect(), style = getComputedStyle(copy);
      if (!rect.width || !rect.height) continue;
      if (copy.dataset.uiCopy !== "heading" && !style.fontFamily.includes("DM Sans")) failures.push(`${copy.className}: body font`);
      const component = copy.closest<HTMLElement>("[data-ui-component-content]")!;
      const box = component.getBoundingClientRect(), cs = getComputedStyle(component);
      const left = box.left + number(cs.paddingLeft) + number(cs.borderLeftWidth);
      const right = box.right - number(cs.paddingRight) - number(cs.borderRightWidth);
      if (Math.abs(rect.left-left)>1.1 || Math.abs(rect.right-right)>1.1) failures.push(`${copy.className}: copy does not use component measure (${rect.width} of ${right-left})`);
      const walker = document.createTreeWalker(copy,NodeFilter.SHOW_TEXT);
      const words: {top:number;text:string;left:number;right:number;width:number}[] = [];
      let node: Node | null;
      while ((node=walker.nextNode())) {
        for (const match of (node.textContent??"").matchAll(/\S+/g)) {
          const range=document.createRange();range.setStart(node,match.index!);range.setEnd(node,match.index!+match[0].length);
          for (const r of range.getClientRects()) if(r.width && r.height) words.push({top:r.top,text:match[0],left:r.left,right:r.right,width:r.width});
        }
      }
      const lines: {top:number;words:typeof words}[]=[];
      for(const word of words){let line=lines.find(l=>Math.abs(l.top-word.top)<1.5);if(!line){line={top:word.top,words:[]};lines.push(line)}line.words.push(word)}
      lines.sort((a,b)=>a.top-b.top);
      if(lines.length>1 && lines.at(-1)!.words.length===1) failures.push(`${copy.className}: orphan ${lines.at(-1)!.words[0].text} in ${copy.textContent}`);
      for(let i=0;i<lines.length-1;i++){
        const current=lines[i].words, next=lines[i+1].words[0];
        const remaining=rect.right-current[current.length-1].right;
        const used=current[current.length-1].right-current[0].left;
        if(used<rect.width*.75 && next.width+4<remaining) failures.push(`${copy.className}: avoidably short nonfinal line in ${copy.textContent} [width=${rect.width.toFixed(2)} used=${used.toFixed(2)} next=${next.text} nextWidth=${next.width.toFixed(2)} remaining=${remaining.toFixed(2)} font=${style.fontSize}/${style.fontWeight}/${style.fontFamily}]`);
      }
      let ancestor: HTMLElement | null=copy;
      let background="rgb(255, 255, 255)";
      while(ancestor){const bg=getComputedStyle(ancestor).backgroundColor;if(bg!=="rgba(0, 0, 0, 0)" && bg!=="transparent"){background=bg;break}ancestor=ancestor.parentElement}
      const values=[lum(rgb(style.color)),lum(rgb(background))].sort((a,b)=>a-b);
      const ratio=(values[1]+0.05)/(values[0]+0.05);
      const large=number(style.fontSize)>=24 || (number(style.fontSize)>=18.66 && number(style.fontWeight)>=700);
      if(ratio<(large?3:4.5)) failures.push(`${copy.className}: contrast ${ratio.toFixed(2)}`);
    }
    const input=scope.querySelector<HTMLInputElement>(".dc-input-field"), wrap=scope.querySelector<HTMLElement>(".dc-input-field-wrap");
    if(input && wrap){const a=input.getBoundingClientRect(),b=wrap.getBoundingClientRect();if(a.left<b.left || a.right>b.right+1) failures.push("URL input clipped by wrapper")}
    const note=scope.querySelector<HTMLElement>(".dc-unlock-line"),header=scope.querySelector<HTMLElement>(".dc-report-header");
    if(note && header && note.parentElement!==header) failures.push("score explanation is trapped in a sibling column");
    for(const row of scope.querySelectorAll<HTMLElement>(".dc-finding-item")){
      if(getComputedStyle(row).backgroundColor!=="rgba(0, 0, 0, 0)") failures.push("nested finding card background");
    }
    return failures;
  });
  expect(failures).toEqual([]);
}

test.beforeAll(()=>fs.mkdirSync(EVIDENCE,{recursive:true}));
for(const width of WIDTHS){
  test(`brand and flow at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.goto("/tools/website-design-check");
    await expect(page.getByRole("heading",{level:1})).toHaveText("Website Design & Conversion Check");
    await brandGates(page);
    await page.getByRole("button",{name:"Check my site",exact:true}).click();
    await expect(page.locator("#dc-domain-error")).toHaveText("Enter a domain to check.");
    await expect(page.getByLabel("Public website URL")).toHaveAttribute("aria-invalid","true");
    await brandGates(page);
    await page.getByLabel("Public website URL").fill("https://synthetic-fixture.example/");
    await expect(page.locator(".dc-input-prefix")).toHaveCount(0);
    await page.screenshot({path:path.join(EVIDENCE,`${width}-input.png`),fullPage:true});
    let release!:()=>void;
    const wait=new Promise<void>(resolve=>{release=resolve});
    await page.route("**/api/tools/website-design-check",async route=>{await wait;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(fixture)})});
    try {
      await page.getByRole("button",{name:"Check my site",exact:true}).click();
      await expect(page.getByRole("status")).toBeVisible();
      await brandGates(page);
    } finally {
      release();
    }
    await expect(page.locator(".dc-report-domain")).toHaveText(fixture.domain);
    await brandGates(page);
    const closedText=await page.locator(".dc-report").innerText();
    const words=closedText.trim().split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(300);
    expect(await page.locator(".dc-path-section .dc-finding-item").count()).toBeLessThanOrEqual(3);
    await page.screenshot({path:path.join(EVIDENCE,`${width}-report.png`),fullPage:true});
    await expect(page.locator(".dc-categories-preview")).toBeHidden();
    await expect(page.locator(".dc-disclaimer")).toBeVisible();
    const disclosure=page.locator(".dc-report-details");
    await expect(disclosure).not.toHaveAttribute("open", "");
    await page.getByText("Other automated checks").focus();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("open", "");
    await brandGates(page);
    await expect(page.locator(".dc-report-details .dc-findings-list > li")).toHaveCount(fixture.rankedFindings.length);
    await page.screenshot({path:path.join(EVIDENCE,`${width}-expanded.png`),fullPage:true});
    await page.getByRole("button",{name:"Check another site"}).click();
    await expect(page.getByLabel("Public website URL")).toHaveValue("");
    await expect(page.locator(".dc-categories-preview")).toBeVisible();
  });
}

test("embedded tool preserves its compact surface",async({page})=>{
  await page.goto("/tools/website-design-check?embed=1");
  await expect(page.locator(".dc-nav")).toHaveCount(0);
  await expect(page.locator(".dc-hero")).toHaveCount(0);
  await expect(page.getByLabel("Public website URL")).toBeVisible();
  await expect(page.locator(".cls-footer")).toBeHidden();
});

test("failed scan keeps the entered URL and supports a retry",async({page})=>{
  await page.setViewportSize({width:375,height:900});
  await page.goto("/tools/website-design-check");
  await page.route("**/api/tools/website-design-check",route=>route.fulfill({status:502,contentType:"application/json",body:JSON.stringify({error:"Could not render this site. Try again or check the domain."})}));
  await page.getByLabel("Public website URL").fill("https://synthetic-fixture.example/");
  await page.getByRole("button",{name:"Check my site",exact:true}).click();
  await expect(page.locator("#dc-domain-error")).toHaveText("Could not render this site. Try again or check the domain.");
  await expect(page.getByLabel("Public website URL")).toHaveValue("https://synthetic-fixture.example/");
  await brandGates(page);
});

for(const width of WIDTHS){
  test(`embedded report in host at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.route("**/api/tools/website-design-check",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(fixture)}));
    await page.route("**/website-check-test-host", route => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head><body><iframe title="Embedded checker" style="width:100%;height:800px;border:0" src="/tools/website-design-check?embed=1"></iframe></body></html>',
    }));
    await page.goto("/website-check-test-host");
    const frame=page.frameLocator('iframe[title="Embedded checker"]');
    await frame.getByLabel("Public website URL").fill("synthetic-fixture.example");
    await frame.getByRole("button",{name:"Check my site",exact:true}).click();
    await expect(frame.locator(".dc-report-domain")).toHaveText(fixture.domain);
    await expect(frame.locator(".dc-report-details")).not.toHaveAttribute("open","");
    const actualFrame=page.frames().find(f=>f.url().includes("embed=1"))!;
    await brandGates(actualFrame);
    if([1440,375,320].includes(width)) await page.screenshot({path:path.join(EVIDENCE,`${width}-embedded-closed.png`),fullPage:true});
    await frame.locator(".dc-report-details > summary").click();
    await expect(frame.locator(".dc-report-details")).toHaveAttribute("open","");
    await brandGates(actualFrame);
    if([1440,375,320].includes(width)) await page.screenshot({path:path.join(EVIDENCE,`${width}-embedded-expanded.png`),fullPage:true});
  });
}
test("copy succeeds or offers a focused manual copy field",async({page,context})=>{
  await context.grantPermissions(["clipboard-write","clipboard-read"]);
  await page.goto("/tools/website-design-check");
  await page.route("**/api/tools/website-design-check",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(fixture)}));
  await page.getByLabel("Public website URL").fill("synthetic-fixture.example");
  await page.getByRole("button",{name:"Check my site",exact:true}).click();
  await page.getByRole("button",{name:"Copy action plan"}).click();
  await expect(page.getByText("Action plan copied.")).toBeVisible();
  const copiedPlan = await page.evaluate(()=>navigator.clipboard.readText());
  expect(copiedPlan).toContain("The heading overlaps the button");
  expect(copiedPlan).toContain("desktop screenshot:");
  expect(copiedPlan).not.toContain("base64");
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,"writeText",{value:()=>Promise.reject(new Error("denied"))}));
  await page.getByRole("button",{name:"Copy action plan"}).click();
  await expect(page.getByLabel("Action plan for manual copy")).toBeFocused();
  await expect(page.getByLabel("Action plan for manual copy")).toHaveValue(/The heading overlaps the button/);
});

test("visual findings lead and automated checks stay collapsed",async({page})=>{
  await page.goto("/tools/website-design-check");
  await page.route("**/api/tools/website-design-check",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(fixture)}));
  await page.getByLabel("Public website URL").fill("synthetic-fixture.example");
  await page.getByRole("button",{name:"Check my site",exact:true}).click();
  await expect(page.getByText("Desktop and mobile screenshots reviewed. 1 visual change identified.")).toBeVisible();
  await expect(page.getByText("The heading overlaps the button.")).toBeVisible();
  await expect(page.locator(".dc-report-details")).not.toHaveAttribute("open", "");
  await page.getByText("View readable screenshot").first().click();
  const viewer = page.getByLabel("desktop screenshot, scroll to inspect");
  await expect(viewer).toBeVisible();
  const image = viewer.locator("img");
  await expect(image).toHaveJSProperty("naturalWidth", 1280);
  await expect(image).toHaveJSProperty("naturalHeight", 900);
  await expect(image).toHaveAttribute("alt", "desktop captured page");
});
for (const width of [1440, 320]) {
  test(`visual assessment scenarios at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const original = fixture.visualReview!;
    const one = original.findings[0];
    const cases = [
      { name: "multiple", review: { ...original, findings: [one, { ...one, id: "visual-2", captureId: "mobile" as const, section: "Contact", element: "Button", observation: "The button overlaps the contact label." }] }, text: "Desktop and mobile screenshots reviewed. 2 visual changes identified.", findings: 2 },
      { name: "one", review: original, text: "Desktop and mobile screenshots reviewed. 1 visual change identified.", findings: 1 },
      { name: "zero", review: { ...original, findings: [] }, text: "No specific visual issues identified in these captures.", findings: 0 },
      { name: "desktop only", review: { ...original, status: "partial" as const, captures: [original.captures[0], { id: "mobile" as const, available: false, reason: "capture_unavailable" as const }], viewportReviews: [original.viewportReviews[0]], reasonCodes: ["capture_unavailable" as const] }, text: "Visual assessment is incomplete. 1 visual change identified in the available evidence.", findings: 1, limitation: "Mobile capture unavailable." },
      { name: "vision failure", review: { ...original, status: "unavailable" as const, viewportReviews: [], findings: [], reasonCodes: ["vision_unavailable" as const] }, text: "Visual assessment unavailable.", findings: 0, limitation: "Captured, not visually assessed." },
      ...(["challenge", "login"] as const).map(kind => ({ name: kind, review: { ...original, status: "unavailable" as const, viewportReviews: original.viewportReviews.map(r => ({ ...r, pageKind: kind })), findings: [], reasonCodes: ["unsuitable_page" as const] }, text: "Visual assessment unavailable.", findings: 0, limitation: `${kind} page shown; normal homepage visual assessment was not possible.` })),
    ];
    let response = fixture;
    await page.route("**/api/tools/website-design-check", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) }));
    for (const scenario of cases) {
      response = { ...fixture, visualReview: scenario.review };
      await page.goto("/tools/website-design-check");
      await page.getByLabel("Public website URL").fill("synthetic-fixture.example");
      await page.getByRole("button", { name: "Check my site", exact: true }).click();
      await expect(page.getByText(scenario.text, { exact: true }), scenario.name).toBeVisible();
      await expect(page.locator(".dc-path-section .dc-finding-item"), scenario.name).toHaveCount(scenario.findings);
      if (scenario.limitation) await expect(page.getByText(scenario.limitation, { exact: false }).first(), scenario.name).toBeVisible();
      await brandGates(page);
      if (scenario.name === "one") {
        const expander = page.getByText("View readable screenshot").first();
        await expander.focus(); await page.keyboard.press("Enter");
        const viewer = page.getByLabel("desktop screenshot, scroll to inspect");
        await expect(viewer).toBeVisible();
        await expect(viewer.locator("img")).toHaveJSProperty("naturalWidth", 1280);
        await viewer.locator("img").evaluate((image: HTMLImageElement) => { image.src = "data:image/png;base64,broken"; });
        await expect(page.locator(".dc-finding-item [role=alert]")).toContainText("could not be displayed");
        await page.getByRole("button", { name: "Copy action plan" }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("screenshot could not be displayed");
        await brandGates(page);
      }
    }
  });
}
