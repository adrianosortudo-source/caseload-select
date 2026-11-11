import type { CollectedSite } from "./collector";
export interface RenderedText { text:string; sourceUrl:string; originalChars:number; }
/** Replace thin primary text with the actual same-site rendered text, within the same packet budget. */
export function applyRenderedFallback(site:CollectedSite, rendered:RenderedText|null):void {
  const primary=site.pages[0];if(!primary || primary.retainedChars>=150 || !rendered || rendered.text.length<150)return;
  const remaining=Math.max(0,48000-site.pages.slice(1).reduce((n,p)=>n+p.retainedChars,0));
  const text=rendered.text.slice(0,Math.min(8000,remaining));if(text.length<150)return;
  const oldUrl=primary.url;site.evidence=site.evidence.filter(e=>e.kind!=="text"||e.sourceUrl!==oldUrl);
  const capturedAt=new Date().toISOString();const truncated=rendered.originalChars>text.length;
  primary.url=rendered.sourceUrl;primary.capturedAt=capturedAt;primary.retainedChars=text.length;primary.state=truncated?"truncated":"readable";
  for(let i=0;i<text.length;i+=1000)site.evidence.push({id:`rendered-text-${i/1000+1}`,kind:"text",sourceUrl:rendered.sourceUrl,title:primary.title,capturedAt,excerpt:text.slice(i,i+1000),truncated});
  site.limitations.push("The submitted page text was taken from a rendered snapshot; other page text may be incomplete.");
  if(truncated)site.limitations.push("The rendered page text was truncated.");
}
