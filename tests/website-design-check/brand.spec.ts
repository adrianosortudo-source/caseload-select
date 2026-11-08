import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./fixture";

const WIDTHS = [1440, 1024, 768, 640, 375, 320];
const EVIDENCE = path.join(process.cwd(), "test-results/website-design-check-evidence");

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function brandGates(page: Page) {
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
      const words: {top:number;text:string}[] = [];
      let node: Node | null;
      while ((node=walker.nextNode())) {
        for (const match of (node.textContent??"").matchAll(/\S+/g)) {
          const range=document.createRange();range.setStart(node,match.index!);range.setEnd(node,match.index!+match[0].length);
          for (const r of range.getClientRects()) if(r.width && r.height) words.push({top:r.top,text:match[0]});
        }
      }
      const lines: {top:number;words:string[]}[]=[];
      for(const word of words){let line=lines.find(l=>Math.abs(l.top-word.top)<1.5);if(!line){line={top:word.top,words:[]};lines.push(line)}line.words.push(word.text)}
      lines.sort((a,b)=>a.top-b.top);
      if(lines.length>1 && lines.at(-1)!.words.length===1) failures.push(`${copy.className}: orphan ${lines.at(-1)!.words[0]} in ${copy.textContent}`);
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
    await expect(page.getByRole("alert")).toHaveText("Enter a domain to check.");
    await expect(page.getByLabel("Public website URL")).toHaveAttribute("aria-invalid","true");
    await brandGates(page);
    await page.getByLabel("Public website URL").fill("https://synthetic-fixture.example/");
    await expect(page.locator(".dc-input-prefix")).toHaveCount(0);
    await page.screenshot({path:path.join(EVIDENCE,`${width}-input.png`),fullPage:true});
    let release!:()=>void;
    const wait=new Promise<void>(resolve=>{release=resolve});
    await page.route("**/api/tools/website-design-check",async route=>{await wait;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(fixture)})});
    await page.getByRole("button",{name:"Check my site",exact:true}).click();
    await expect(page.getByRole("status")).toBeVisible();
    await brandGates(page);
    release();
    await expect(page.getByRole("heading",{name:"Enter your email to view the report"})).toBeVisible();
    await brandGates(page);
    await page.getByRole("button",{name:"View report",exact:true}).click();
    await expect(page.getByRole("alert")).toHaveText("Enter a valid email address.");
    await brandGates(page);
    await page.getByRole("button",{name:"Skip, show me the report"}).click();
    await expect(page.locator(".dc-report-domain")).toHaveText(fixture.domain);
    await brandGates(page);
    await page.screenshot({path:path.join(EVIDENCE,`${width}-report.png`),fullPage:true});
    await page.getByRole("button",{name:"Check another site"}).click();
    await expect(page.getByLabel("Public website URL")).toHaveValue("");
  });
}

test("embedded tool preserves its compact surface",async({page})=>{
  await page.goto("/tools/website-design-check?embed=1");
  await expect(page.locator(".dc-nav")).toHaveCount(0);
  await expect(page.locator(".dc-hero")).toHaveCount(0);
  await expect(page.getByLabel("Public website URL")).toBeVisible();
  await expect(page.locator(".cls-footer")).toBeHidden();
});
