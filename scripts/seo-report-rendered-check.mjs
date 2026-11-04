// Replays saved public results. Never calls the scan API or submits an email.
// Usage: node scripts/seo-report-rendered-check.mjs --url URL --soni FILE --sakuraba FILE --output DIRECTORY
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, v, i, all) => i % 2 ? pairs : [...pairs, [v.replace(/^--/, ''), all[i + 1]]], []));
for (const key of ['url', 'soni', 'sakuraba', 'output']) assert(args[key], `Missing --${key}`);
const origin = new URL(args.url).origin;
const output = resolve(args.output);
await mkdir(output, { recursive: true });
const gate = ({selector})=>{
const failures=[];
const visible=e=>{
 if(e.closest('details:not([open])')&&!e.closest('summary'))return false;
 const s=getComputedStyle(e),r=e.getBoundingClientRect();
 return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';
};
const elements=[...document.querySelectorAll(selector)].flatMap(e=>e.tagName==='UL'?(e.classList.contains('seo-weight-list')?[]:[...e.children].filter(x=>x.tagName==='LI')):[e]);
for(const el of elements){
 if(!visible(el)||el.dataset.uiCopyException)continue;
 const rect=el.getBoundingClientRect(),comp=el.closest('[data-ui-component-content]');
 const words=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
 for(let n=walker.nextNode();n;n=walker.nextNode()){
  if(!n.parentElement||!visible(n.parentElement))continue;
  const re=/\S+/g;let m;
  while((m=re.exec(n.textContent))){
   const range=document.createRange();range.setStart(n,m.index);range.setEnd(n,m.index+m[0].length);
   for(const r of range.getClientRects())if(r.width&&r.height)words.push({word:m[0],top:r.top,left:r.left,right:r.right,width:r.width});
  }
 }
 const lines=[];
 for(const w of words){let l=lines.find(x=>Math.abs(x.top-w.top)<=1);if(!l){l={top:w.top,words:[]};lines.push(l)}l.words.push(w)}
 lines.sort((a,b)=>a.top-b.top);lines.forEach(l=>l.words.sort((a,b)=>a.left-b.left));
 const text=el.textContent.trim().replace(/\s+/g,' ');
 if(lines.length>1&&lines.at(-1).words.length===1)failures.push({type:'orphan',text,last:lines.at(-1).words[0].word});
 if(comp&&comp!==el&&el.tagName!=='LI'){
  const r=comp.getBoundingClientRect(),s=getComputedStyle(comp);
  if(Math.abs(rect.left-r.left-parseFloat(s.paddingLeft))>1.5||Math.abs(rect.right-r.right+parseFloat(s.paddingRight))>1.5)failures.push({type:'width',text});
 }
 for(let i=0;i<lines.length-1;i++){
  const l=lines[i],next=lines[i+1].words[0],used=Math.max(...l.words.map(w=>w.right))-Math.min(...l.words.map(w=>w.left)),remain=rect.right-Math.max(...l.words.map(w=>w.right));
  const ctx=document.createElement('canvas').getContext('2d');ctx.font=getComputedStyle(el).font;const gap=ctx.measureText(' ').width; if(used<rect.width*.75&&next&&remain>=next.width+gap+.1)failures.push({type:'short-line',text,line:i,used:Math.round(used),width:Math.round(rect.width)});
 }
}
return {overflow:document.documentElement.scrollWidth>innerWidth,failures};
};
const checks = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const firm of ['soni', 'sakuraba']) {
    const raw = JSON.parse((await readFile(args[firm], 'utf8')).replace(/^\uFEFF/, ''));
    const saved = raw.result ?? raw;
    assert.equal(saved.pages.length, 25, 'Use the saved 25-page review result');
    assert.equal(saved.domain, firm === 'soni' ? 'sonilaw.ca' : 'sakurabalaw.ca');
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const events = { replayed: 0, blockedPosts: 0, firmRequests: 0 };
    const errors = [];
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if ([saved.domain, 'www.' + saved.domain].includes(url.hostname)) { events.firmRequests++; return route.abort(); }
      if (req.method() === 'POST') {
        if (url.origin === origin && url.pathname === '/api/tools/seo-check' && events.replayed === 0) {
          events.replayed++;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) });
        }
        events.blockedPosts++; return route.abort();
      }
      if (url.origin !== origin) return route.abort();
      const headers = { ...req.headers() };
      if (process.env.VERCEL_OIDC_TOKEN) headers['x-vercel-trusted-oidc-idp-token'] = process.env.VERCEL_OIDC_TOKEN;
      return route.continue({ headers });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(args.url, { waitUntil: 'networkidle', timeout: 120000 });
    assert(response?.ok(), 'App did not load');
    await page.getByRole('textbox', { name: 'Public website URL' }).fill(saved.domain);
    await page.getByRole('button', { name: 'Check my site', exact: true }).click();
    await page.getByRole('button', { name: 'Skip, show me the report', exact: true }).click();
    await page.locator('.cls-report-current').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.cls-basic-list li').count(), 5);
    assert.equal(await page.locator('.cls-reviewed-pages li').count(), 25);
    assert.equal(await page.locator('.cls-ai-search-table tbody tr').count(), 3);
    if (firm === 'soni') {
      assert.equal(await page.locator('.cls-decision-pages a').count(), 6);
      assert.match(await page.locator('[data-check-id="seo.indexability.indexable"]').innerText(), /19 of 25/);
    } else {
      assert.equal(await page.getByRole('heading', { name: 'The basic checks passed.', exact: true }).count(), 1);
      assert.equal(await page.getByRole('heading', { name: 'Priority findings', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Copy findings', exact: true }).count(), 0);
    }
    await page.getByRole('button', { name: 'Copy report summary', exact: true }).click();
    await page.getByRole('button', { name: 'Summary copied', exact: true }).waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied.includes('25-page sample limit reached'));
    assert(!copied.includes('98/100'));
    for (const width of [1440, 1024, 768, 640, 375, 320, 294]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      for (const state of ['default', 'ai-expanded']) {
        if (state === 'ai-expanded') await page.locator('.cls-ai-page-observations > summary').click();
        checks.push({ firm, width, state, ...await page.evaluate(gate, { selector: '.cls-report [data-ui-copy]' }) });
        if (state === 'ai-expanded') await page.locator('.cls-ai-page-observations > summary').click();
      }
      if ([1440, 375, 294].includes(width)) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: join(output, `${firm}-${width}.png`), fullPage: true });
      }
      await page.getByText('See the 25 pages reviewed', { exact: true }).click();
      await page.getByText('How this check works', { exact: true }).click();
      assert(await page.getByRole('heading', { name: 'Scan limits', exact: true }).isVisible());
      assert(await page.locator('.cls-reviewed-pages li').first().isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByText('How this check works', { exact: true }).click();
      await page.getByText('See the 25 pages reviewed', { exact: true }).click();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(events, { replayed: 1, blockedPosts: 0, firmRequests: 0 });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(join(output, 'rendered-checks.json'), JSON.stringify(checks, null, 2));
const failed = checks.filter(check => check.overflow || check.failures.length);
assert.deepEqual(failed, [], 'Rendered copy or overflow failure; inspect rendered-checks.json');
console.log(`Passed ${checks.length} rendered states, both saved-result flows, clipboard and disclosure checks. No audit or email was sent.`);
