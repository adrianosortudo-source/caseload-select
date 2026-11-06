import { chromium } from '@playwright/test';
import fs from 'node:fs';
const root='D:/00_Work/01_CaseLoad_Select/07_Prospects/LocalResearch/migration-20261106';
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const requests=[];
page.on('request',r=>{if(r.url().includes('/api/admin/prospect-enrichment/candidates'))requests.push(r.url());});
const results=[];
for(const width of [1440,1024,768,640,375,320]){
 await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:3157/dev/prospect-candidate-preview',{waitUntil:'domcontentloaded',timeout:180000});await page.evaluate(()=>document.fonts.ready);
 await page.getByRole('heading',{name:'Research is stored locally',exact:true}).waitFor();
 const result=await page.evaluate(()=>{
  const box=document.querySelector('[data-ui-component-content="local-research-notice"]');const b=box.getBoundingClientRect(),style=getComputedStyle(box),left=b.left+parseFloat(style.paddingLeft),right=b.right-parseFloat(style.paddingRight);
  return [...box.querySelectorAll('[data-ui-copy]')].map(el=>{const r=el.getBoundingClientRect(),words=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text;
   while(text=walker.nextNode()){for(const match of text.textContent.matchAll(/\S+/gu)){const range=document.createRange();range.setStart(text,match.index);range.setEnd(text,match.index+match[0].length);for(const rect of range.getClientRects())if(rect.width&&rect.height)words.push({top:Math.round(rect.top),left:rect.left,right:rect.right});}}
   const lines=[];for(const word of words){let line=lines.find(l=>Math.abs(l.top-word.top)<=1);if(!line){line={top:word.top,words:[]};lines.push(line);}line.words.push(word);}
   return {text:el.textContent,widthPass:Math.abs(r.left-left)<=1.1&&Math.abs(r.right-right)<=1.1,lines:lines.map(l=>l.words.length),orphan:lines.length>1&&lines.at(-1).words.length===1,ragged:lines.slice(0,-1).some((line,i)=>{const last=line.words.at(-1),next=lines[i+1].words[0];return last.right-line.words[0].left<0.75*(right-left)&&next.right-next.left+5<right-last.right;})};
  });
 });
 await page.screenshot({path:root+`/local-notice-${width}.png`,fullPage:true});results.push({width,copy:result});
}
await browser.close();fs.writeFileSync(root+'/rendered-verification.json',JSON.stringify({results,candidateRequests:requests.length},null,2));console.log(JSON.stringify({results,candidateRequests:requests.length}));
if(requests.length||results.some(r=>r.copy.some(c=>!c.widthPass||c.orphan||c.ragged)))process.exitCode=1;
