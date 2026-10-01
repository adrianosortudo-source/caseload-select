let browserTools;
try { browserTools = require('playwright'); } catch { browserTools = require(process.env.CODEX_PLAYWRIGHT_PATH || 'C:/Users/adria/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
const {chromium} = browserTools;
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const source = path.join(__dirname,'desired-client-blueprint-example.html');
const evidence = process.env.BLUEPRINT_QA_DIR || 'D:/00_Work/01_CaseLoad_Select/09_Internal/desired-client-brand-qa-20260930';
fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 const findings=[];
 for(const width of [1440,1024,768,640,375,320]){
  await page.setViewportSize({width,height:1000}); await page.goto(pathToFileURL(source).href); await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>{
   const violations=[];
   const sels='.head-title,.head-meta,.definition p,.pathway-head h2,.pathway-head p,.section-heading h2,.section-heading p,.data-value,.subnote,.client-path-step p,.interpretation-note,.evidence-row p,.open-item h3,.open-item p,.traceability h3,.traceability p';
   for(const el of document.querySelectorAll(sels)){
    el.dataset.uiCopy=el.tagName.startsWith('H')?'heading':'body';
    const content=el.parentElement; content.dataset.uiComponentContent=content.className||content.tagName;
    const box=content.getBoundingClientRect(), cs=getComputedStyle(content), rect=el.getBoundingClientRect();
    const left=box.left+parseFloat(cs.paddingLeft)+parseFloat(cs.borderLeftWidth),right=box.right-parseFloat(cs.paddingRight)-parseFloat(cs.borderRightWidth);
    if(Math.abs(rect.left-left)>1.1||Math.abs(rect.right-right)>1.1) violations.push({type:'width',text:el.textContent.slice(0,90),available:right-left,actual:rect.width});
    const words=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {const node=walker.currentNode;for(const match of node.textContent.matchAll(/\S+/g)){const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);const r=range.getBoundingClientRect();if(r.width&&r.height)words.push({text:match[0],x:r.x,right:r.right,y:Math.round(r.y),w:r.width});}}
    for(let i=1;i<words.length;i++){if(/^[,.;:!?]+$/.test(words[i].text)&&Math.abs(words[i].y-words[i-1].y)<3){words[i-1].right=words[i].right;words[i-1].w=words[i-1].right-words[i-1].x;words.splice(i,1);i--;}} const lines=[];for(const word of words){let l=lines.find(l=>Math.abs(l.y-word.y)<3);if(!l){l={y:word.y,words:[]};lines.push(l);}l.words.push(word);}
    lines.sort((a,b)=>a.y-b.y);
    if(lines.length>1&&lines.at(-1).words.length===1) violations.push({type:'orphan',text:el.textContent.slice(0,90),last:lines.at(-1).words[0].text});
    for(let i=0;i<lines.length-1;i++){const line=lines[i],last=line.words.at(-1),next=lines[i+1].words[0];if((last.right-rect.left)/rect.width<.75&&last.right+next.w+6<rect.right)violations.push({type:'short-line',text:el.textContent.slice(0,90)});}
   }
   return {overflow:document.documentElement.scrollWidth>innerWidth,violations,fonts:['Manrope','DM Sans','Oxanium'].map(f=>document.fonts.check('600 16px "'+f+'"')),logo:document.querySelector('.brand-logo--screen').naturalWidth,content:document.querySelector('main').innerText.length};
  });
  findings.push({width,...result});
  await page.screenshot({path:path.join(evidence,`after-${width}.png`),fullPage:true});
 }
 await page.emulateMedia({media:'print'}); await page.setViewportSize({width:816,height:1056}); await page.screenshot({path:path.join(evidence,'print-html.png'),fullPage:true});
 console.log(JSON.stringify(findings,null,2));fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(findings,null,2));
 await browser.close();
 if(findings.some(f=>f.overflow||f.violations.length||!f.logo||f.fonts.some(v=>!v)))process.exitCode=1;
})();
