import type { Evidence } from "./types";
const quoteParts=/(“[^”]*”|"[^"]*"|(?<![\p{L}\p{N}])[\x27‘](?:[^\x27‘’]|(?<=[\p{L}\p{N}])[\x27’](?=[\p{L}\p{N}]))+[\x27’](?![\p{L}\p{N}]))/gu;
function sourceQuote(part:string,evidence:Evidence[]):boolean {
  if(!(part.startsWith("“")&&part.endsWith("”")) && !(part.startsWith("\"")&&part.endsWith("\"")) && !((part.startsWith("'")||part.startsWith("‘"))&&(part.endsWith("'")||part.endsWith("’"))))return false;
  const inner=part.slice(1,-1);return evidence.some(e=>e.kind==="text"&&e.excerpt.includes(inner));
}
/** Normalize authored copy only; exact quotes present in collected text remain verbatim. */
export function normalizeAuthoredCopy(value:unknown,evidence:Evidence[]):unknown {
  if(typeof value==="string")return value.split(quoteParts).map(part=>sourceQuote(part,evidence)?part:part.replace(/\s*—\s*/g,", ")).join("");
  if(Array.isArray(value))return value.map(v=>normalizeAuthoredCopy(v,evidence));
  if(value && typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalizeAuthoredCopy(v,evidence)]));
  return value;
}
export function hasUnapprovedEmDash(value:unknown,evidence:Evidence[]):boolean {
  if(typeof value==="string")return value.split(quoteParts).some(part=>part.includes("—")&&!sourceQuote(part,evidence));
  if(Array.isArray(value))return value.some(v=>hasUnapprovedEmDash(v,evidence));
  if(value&&typeof value==="object")return Object.values(value).some(v=>hasUnapprovedEmDash(v,evidence));
  return false;
}
