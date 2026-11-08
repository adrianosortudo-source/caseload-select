import { NextRequest, NextResponse } from "next/server";
import { ipFromRequest } from "@/lib/rate-limit";
import { validateOutboundUrl } from "@/lib/ssrf";
import { isSiteCapture } from "@/lib/positioning-check/capture";
import { applyRenderedFallback, type RenderedText } from "@/lib/positioning-check/fallback";
import { collectSite } from "@/lib/positioning-check/collector";
import { generateAnalysis, MODEL, PROMPT_VERSION, RUBRIC_VERSION, type ImageInput } from "@/lib/positioning-check/gemini";
import { releaseWithinDeadline, reserveAnalysis } from "@/lib/positioning-check/quota";
import type { Evidence, PositioningErrorCode, ScreenshotCoverage } from "@/lib/positioning-check/types";

export const runtime="nodejs";
export const maxDuration=120;
const failure=(code:PositioningErrorCode,message:string,status:number,retryable:boolean)=>NextResponse.json({status:"error",code,message,retryable},{status});
function normalized(raw:string):URL { const url=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`); if(url.protocol!=="https:"||url.username||url.password||!validateOutboundUrl(url,{allowedSchemes:["https:"]}).ok)throw new Error("invalid_url"); url.hash=""; return url; }
async function render(url:URL,deadline:number):Promise<{images:ImageInput[];screenshots:ScreenshotCoverage[];evidence:Evidence[];renderedText:RenderedText|null}> {
  const service=process.env.RENDER_SERVICE_URL,token=process.env.RENDER_SERVICE_TOKEN; if(!service||!token)throw new Error("renderer_unavailable");
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-Date.now()));
  try {
    const response=await fetch(`${service.replace(/\/$/,"")}/api/render`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({url:url.href}),signal:controller.signal});
    if(!response.ok || !response.body){console.warn("[positioning-render]",JSON.stringify({runtime:process.version,httpStatus:response.status}));throw new Error("renderer_unavailable");}
    const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const part=await reader.read(); if(part.done)break;size+=part.value.byteLength;if(size>12*1024*1024)throw new Error("renderer_too_large");chunks.push(part.value);}} finally{void reader.cancel().catch(()=>{});}
    const data=JSON.parse(Buffer.concat(chunks).toString("utf8")) as {captures?:{viewport:string;finalUrl:string;screenshotPng:string;screenshotClippedFromPx:number|null;domSnapshot?:{authority?:{firmVoicedText?:string}}}[]};
    const images:ImageInput[]=[],screenshots:ScreenshotCoverage[]=[],evidence:Evidence[]=[]; let renderedText:RenderedText|null=null;
    for(const viewport of ["desktop","mobile"] as const){const id=`screenshot-${viewport}`; const capture=data.captures?.find(c=>c.viewport===viewport);if(!capture||!isSiteCapture(url,capture.finalUrl)||typeof capture.screenshotPng!=="string"){screenshots.push({id,viewport,state:"unavailable",analyzed:false,clippedFromPx:null});continue;}if(viewport==="desktop" && typeof capture.domSnapshot?.authority?.firmVoicedText==="string"){const text=capture.domSnapshot.authority.firmVoicedText.replace(/\s+/g," ").trim();renderedText={text:text.slice(0,8000),originalChars:text.length,sourceUrl:capture.finalUrl};}const png=Buffer.from(capture.screenshotPng,"base64");if(png.length>4*1024*1024||png.length<24||png.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"||png.readUInt32BE(16)>1440||png.readUInt32BE(20)>7800){screenshots.push({id,viewport,state:"unavailable",analyzed:false,clippedFromPx:null});continue;}const clipped=typeof capture.screenshotClippedFromPx==="number"?capture.screenshotClippedFromPx:null;images.push({id,png}); screenshots.push({id,viewport,state:clipped!==null?"clipped":"captured",analyzed:true,clippedFromPx:clipped});evidence.push({id,kind:"screenshot",sourceUrl:capture.finalUrl,title:`${viewport} screenshot`,capturedAt:new Date().toISOString(),screenshotId:id,visibleRegion:clipped!==null?"Visible top portion of page":"Captured page"});}
    return {images,screenshots,evidence,renderedText};
  }finally{clearTimeout(timer);}
}
async function readRequest(req:Request, deadline:number):Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? "0") > 4096 || !req.body) throw new Error("invalid");
  const reader=req.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try {for(;;){const left=Math.min(5000,deadline-Date.now());if(left<=0)throw new Error("invalid");let timer:ReturnType<typeof setTimeout>|undefined;const part=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("invalid")),left);})]).finally(()=>{if(timer)clearTimeout(timer);});if(part.done)break;size+=part.value.length;if(size>4096)throw new Error("invalid");chunks.push(part.value);}}
  finally {void reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function POST(req:NextRequest){
  const start=Date.now(), deadline=start+105000;
  if(process.env.POSITIONING_CHECK_ENABLED!=="true")return failure("feature_disabled","This tool is temporarily unavailable.",503,true);
  let url:URL;try{const body=await readRequest(req,deadline) as {url?:unknown};if(typeof body.url!=="string"||body.url.length>2048)throw new Error();url=normalized(body.url.trim());}catch{return failure("invalid_url","Enter a valid public HTTPS website address.",400,false);}
  const reservation=await reserveAnalysis(ipFromRequest(req));if(reservation.status==="unavailable")return failure("provider_unavailable","The tool is temporarily unavailable. Please try again later.",503,true);if(reservation.status!=="ok")return failure("rate_limited",reservation.reason==="daily"?"The daily review capacity has been reached. Please try again later.":reservation.reason==="active"?"A review is already in progress from this network. Please try again shortly.":"This network has reached its hourly review limit. Shared offices may share a limit. Please try again later.",429,true);
  try {
    const [site,visual]=await Promise.all([collectSite(url.href,start+40000),render(url,start+40000).catch((err:unknown)=>{const e=(err && typeof err==="object"?err:{}) as {name?:unknown;cause?:{code?:unknown}};const code=typeof e.cause?.code==="string" && /^[A-Z0-9_]{1,32}$/.test(e.cause.code)?e.cause.code:"none";console.warn("[positioning-render]",JSON.stringify({runtime:process.version,errorClass:e.name==="TypeError"||e.name==="AbortError"?e.name:"Error",code}));return null;})]);
    applyRenderedFallback(site,visual?.renderedText??null); const primary=site.pages[0]; if(!primary||primary.retainedChars<150)return failure("blocked_or_unreadable","We could not read enough of the submitted page to assess it. Please check the address and try again.",422,true);
    const screenshots=visual?.screenshots??(["desktop","mobile"] as const).map(viewport=>({id:`screenshot-${viewport}`,viewport,state:"unavailable" as const,analyzed:false,clippedFromPx:null}));
    if(!visual||screenshots.some(s=>!s.analyzed))site.limitations.push("Some or all homepage images could not be assessed.");
    if(screenshots.some(s=>s.state==="clipped"))site.limitations.push("At least one screenshot covers only the top portion of the page.");
    const evidence=[...site.evidence,...(visual?.evidence??[])]; const result=await generateAnalysis(evidence,visual?.images??[],{pages:site.pages,screenshots,limitations:site.limitations},deadline);
    const partial=site.limitations.length>0||site.pages.some(p=>p.state!=="readable");
    console.info("[positioning-check]",JSON.stringify({model:MODEL,durationMs:Date.now()-start,inputTokens:result.inputTokens,outputTokens:result.outputTokens,calls:result.calls,status:partial?"partial":"success"}));
    return NextResponse.json({status:partial?"partial":"success",metadata:{schemaVersion:"1",rubricVersion:RUBRIC_VERSION,promptVersion:PROMPT_VERSION,model:MODEL,generatedAt:new Date().toISOString(),requestedUrl:url.href,resolvedOrigin:site.resolvedOrigin,aiGenerated:true},coverage:{pages:site.pages,screenshots,limitations:site.limitations},evidence,part1:result.analysis.part1,part2:result.analysis.part2},{headers:{"Cache-Control":"no-store"}});
  }catch(e){const code=e instanceof Error?e.message:"provider_unavailable";console.warn("[positioning-check]",JSON.stringify({errorCode:code==="timeout"||code==="invalid_analysis"||code==="review_limit"?code:"provider_unavailable",durationMs:Date.now()-start}));if(code==="review_limit")return failure("blocked_or_unreadable","This website exceeds the review size limit. Please try a more focused page.",422,true);if(code==="timeout")return failure("timeout","The review timed out. Please try again.",504,true);if(code==="invalid_analysis")return failure("invalid_analysis","We could not produce a reliable report. Please try again.",502,true);return failure("provider_unavailable","The review is temporarily unavailable. Please try again later.",503,true);}finally{await releaseWithinDeadline(reservation.release,deadline);}
}




















