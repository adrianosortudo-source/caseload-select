/** Renderer may navigate publicly; reject any capture whose final URL is not the submitted site. */
export function isSiteCapture(submitted:URL, finalUrl:string):boolean {
  try { const result=new URL(finalUrl); return submitted.protocol==="https:" && result.protocol==="https:" && submitted.port===result.port && submitted.hostname.replace(/^www\./,"")===result.hostname.replace(/^www\./,""); }
  catch {return false;}
}
