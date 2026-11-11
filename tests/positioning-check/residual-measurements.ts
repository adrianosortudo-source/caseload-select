/** Diagnostic only: restores every temporary style before the acceptance capture. */
export function measureResidualCandidates(targets: string[]) {
 function inspect(el:HTMLElement){
  const rect=el.getBoundingClientRect();const rows:{top:number;left:number;right:number;words:{text:string;width:number}[]}[]=[];
  const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
  while((node=walk.nextNode()))for(const m of (node.textContent||"").matchAll(/\S+/g)){const range=document.createRange();range.setStart(node,m.index!);range.setEnd(node,m.index!+m[0].length);for(const b of range.getClientRects()){if(!b.width||!b.height)continue;let row=rows.find(r=>Math.abs(r.top-b.top)<2);if(!row){row={top:b.top,left:b.left,right:b.right,words:[]};rows.push(row);}row.right=b.right;row.words.push({text:m[0],width:b.width});}}
  const orphan=rows.length>1&&rows.at(-1)!.words.length===1;const short=rows.slice(0,-1).some((r,i)=>r.right-r.left<rect.width*.75&&rect.width-(r.right-r.left)>rows[i+1].words[0].width+5);const overflow=document.documentElement.scrollWidth>innerWidth;
  return{width:rect.width,fontSize:parseFloat(getComputedStyle(el).fontSize),wrap:getComputedStyle(el).textWrap,orphan,short,overflow,pass:!orphan&&!short&&!overflow,lines:rows.map(r=>({used:r.right-r.left,words:r.words}))};
 }
 const results=[];
 for(const el of document.querySelectorAll<HTMLElement>("[data-ui-copy]")){
  if(!targets.includes(el.textContent||"")||!el.getBoundingClientRect().width||el.closest("[hidden]")||el.closest("details:not([open])"))continue;
  const original=el.getAttribute("style"),baseline=inspect(el);if(baseline.pass)continue;
  const ancestors=[];for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(parseFloat(s.paddingLeft)||parseFloat(s.paddingRight))ancestors.push({tag:p.tagName,class:p.className,left:parseFloat(s.paddingLeft),right:parseFloat(s.paddingRight),width:p.getBoundingClientRect().width});}
  const fonts=[];for(const delta of [1,2])for(const wrap of ["wrap","pretty","balance"]){el.style.fontSize=`${baseline.fontSize+delta}px`;el.style.textWrap=wrap;const measured=inspect(el);fonts.push({delta,...measured,pass:measured.pass&&Math.abs(measured.width-baseline.width)<=1});}
  if(original===null)el.removeAttribute("style");else el.setAttribute("style",original);
  const padding=[];
  if(!fonts.some(f=>f.pass))for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){
   if(!(p.classList.contains("pc-statement")||p.classList.contains("pc-main")||p.classList.contains("pc-notice")||p.tagName==="UL"))continue;
   const s=getComputedStyle(p),left=parseFloat(s.paddingLeft),right=parseFloat(s.paddingRight),before=p.getAttribute("style");
   const proposedLeft=left?Math.max(8,Math.floor((left-1)/4)*4):0,proposedRight=right?Math.max(8,Math.floor((right-1)/4)*4):0;
   p.style.paddingLeft=`${proposedLeft}px`;p.style.paddingRight=`${proposedRight}px`;padding.push({ancestor:p.className||p.tagName,left,right,proposedLeft,proposedRight,...inspect(el)});
   if(before===null)p.removeAttribute("style");else p.setAttribute("style",before);
  }
  results.push({text:el.textContent,baseline,ancestors,fonts,padding});
 }
 return results;
}
