import "server-only";
import sanitizeHtml from "sanitize-html";
import { ssrfSafeFetchOneHop } from "@/lib/ssrf-fetch";
import type { Evidence, PageCoverage } from "./types";

const MAX_BODY = 1_000_000, MAX_PAGE = 8000, MAX_TOTAL = 48000, MAX_PAGES = 8;
export interface CollectedSite { requestedUrl: string; resolvedOrigin: string; pages: PageCoverage[]; evidence: Evidence[]; limitations: string[] }
function sameSite(a: URL, b: URL): boolean { return a.protocol === "https:" && b.protocol === "https:" && a.port === b.port && a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, ""); }
function score(url: URL): number { const p = url.pathname.toLowerCase(); if (/about|firm|our-team|lawyer|attorney|people/.test(p)) return 1; if (/practice|services|family|litigation|areas/.test(p)) return 2; if (/process|consult|contact|testimonial|review/.test(p)) return 3; return 10; }
async function readBody(res: Response, deadline: number): Promise<{text:string; truncated:boolean}> {
  if (!res.body) return { text:"", truncated:false };
  const reader = res.body.getReader(); let size = 0; let truncated = false; const chunks: Uint8Array[] = [];
  try { for (;;) {
    const ms = deadline - Date.now(); if (ms <= 0) throw new Error("collection_timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const item = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("collection_timeout")), ms); })]).finally(() => { if (timer) clearTimeout(timer); });
    if (item.done) break;
    size += item.value.byteLength; if (size > MAX_BODY) { truncated = true; break; }
    chunks.push(item.value);
  } } finally { await reader.cancel().catch(() => {}); }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}
async function fetchPage(url: URL, anchor: URL, deadline: number): Promise<{res:Response; url:URL}> {
  let current = url;
  for (let hop=0; hop<=4; hop++) {
    if (!sameSite(anchor, current)) throw new Error("external_redirect");
    const remaining = deadline-Date.now(); if (remaining<=0) throw new Error("collection_timeout");
    const res = await ssrfSafeFetchOneHop(current.href, { timeoutMs:Math.min(8000,remaining), allowedSchemes:["https:"] });
    if (res.status >= 300 && res.status < 400) { const location=res.headers.get("location"); await res.body?.cancel().catch(()=>{}); if (!location || hop===4) throw new Error("redirect_failed"); current=new URL(location,current); continue; }
    return { res, url: current };
  }
  throw new Error("redirect_failed");
}
/** Bounded same-site crawl. Substantive claims are represented by collector-owned text chunks. */
export async function collectSite(requestedUrl: string, deadline: number): Promise<CollectedSite> {
  const start = new URL(requestedUrl); if (start.protocol !== "https:" || start.username || start.password) throw new Error("invalid_url");
  const queue: {url:URL;depth:number}[] = [{url:start,depth:0}]; const seen = new Set<string>(); const finalSeen = new Set<string>(); const queued = new Set<string>([start.href]); const pages:PageCoverage[]=[]; const evidence:Evidence[]=[]; const limitations:string[]=[]; let total=0; let origin=start.origin;
  while(queue.length && pages.length<MAX_PAGES && Date.now()<deadline && total<MAX_TOTAL) {
    const item=queue.shift()!; item.url.hash=""; if(seen.has(item.url.href)) continue; seen.add(item.url.href);
    try {
      const {res,url} = await fetchPage(item.url,start,deadline); if (!res.ok || !/text\/html|application\/xhtml\+xml/i.test(res.headers.get("content-type") ?? "")) { await res.body?.cancel().catch(()=>{}); throw new Error("unreadable"); }
      if(finalSeen.has(url.href)){await res.body?.cancel().catch(()=>{});continue;} finalSeen.add(url.href);
      if (pages.length===0) origin=url.origin;
      const body=await readBody(res,deadline); const links:URL[]=[]; const linkSet=new Set<string>(); let title="";
      sanitizeHtml(body.text,{allowedTags:["a"],allowedAttributes:{a:["href"]},transformTags:{a:(tag,attrs)=>{try{if(!attrs.href || !attrs.href.trim())return {tagName:tag,attribs:{}};const link=new URL(attrs.href,url);link.hash="";if(sameSite(start,link)&&!linkSet.has(link.href)&&links.length<100&&!/\.(?:pdf|jpg|png|zip|docx?)(?:$|\?)/i.test(link.pathname)){linkSet.add(link.href);links.push(link);}}catch{}return {tagName:tag,attribs:{}};}}});
      const cleaned=sanitizeHtml(body.text,{allowedTags:["h1","h2","h3","h4","p","li","title","br"],allowedAttributes:{},nonTextTags:["script","style","textarea","option","noscript","nav","footer","svg","iframe"]});
      const match=cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i); title=(match?.[1]??url.hostname).replace(/<[^>]*>/g,"").trim().slice(0,200);
      const text=sanitizeHtml(cleaned.replace(/<\/(?:h[1-4]|p|li|title)>|<br\s*\/?\s*>/gi," "),{allowedTags:[],allowedAttributes:{}}).replace(/\s+/g," ").trim(); if(text.length<2000 && /verify (?:you are|you're) human|checking your browser|enable javascript and cookies|just a moment\.\.\.|access denied/i.test(text))throw new Error("challenge"); const usable=text.slice(0,Math.min(MAX_PAGE,MAX_TOTAL-total)); total+=usable.length; const truncated=body.truncated || usable.length<text.length; const capturedAt=new Date().toISOString();
      pages.push({url:url.href,title,capturedAt,state:truncated?"truncated":"readable",retainedChars:usable.length});
      for(let offset=0;offset<usable.length;offset+=1000){const excerpt=usable.slice(offset,offset+1000); evidence.push({id:`text-${evidence.length+1}`,kind:"text",sourceUrl:url.href,title,capturedAt,excerpt,truncated});}
      if(item.depth<2){links.sort((a,b)=>score(a)-score(b)||a.href.localeCompare(b.href)); for(const link of links)if(score(link)<10&&!seen.has(link.href)&&!queued.has(link.href)&&queue.length<80){queued.add(link.href);queue.push({url:link,depth:item.depth+1});}}
    } catch { pages.push({url:item.url.href,title:item.url.hostname,capturedAt:new Date().toISOString(),state:"unreadable",retainedChars:0}); }
  }
  if (Date.now()>=deadline) limitations.push("The collection time limit was reached, so some pages were not reviewed.");
  if (queue.length) limitations.push("The site was sampled within page and time limits; not every page was reviewed.");
  if (pages.filter(p=>p.retainedChars>=150).length<3) limitations.push("Fewer than three substantial pages were readable; site-wide consistency cannot be assessed confidently.");
  if (pages.some(p=>p.state==="truncated")) limitations.push("Some page text was truncated.");
  return {requestedUrl,resolvedOrigin:origin,pages,evidence,limitations};
}




