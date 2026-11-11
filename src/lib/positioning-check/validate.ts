import { decodeHtmlEntities } from "@/app/api/tools/seo-check/engine-core";
import { hasUnapprovedEmDash } from "./normalize";
import { ELEMENT_KEYS, type Evidence, type PositioningResult } from "./types";

const PROHIBITED_STATEMENT = /\b(?:guarantee(?:s|d)?|ensur(?:e|es|ed|ing)|unparalleled|best\s+(?:firm|lawyer|attorney|practice|service)|most experienced|cutting[- ]edge|risk[- ]free|no\s+risk|zero\s+risk)\b/i;
const PROHIBITED_EXPECTATION = /\b(?:guarantee(?:s|d)?|ensur(?:e|es|ed|ing))\b/i;
const words = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().split(/\s+/u).length <= max;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasIds = (ids: unknown, known: Map<string, Evidence>, allowEmpty = false): ids is string[] => Array.isArray(ids) && (allowEmpty || ids.length > 0) && ids.every(id => typeof id === "string" && known.has(id));

/** Quotation marks denote exact source words, not paraphrases. Matching permits typography and whitespace differences only. */
function quoteTextMatches(value:unknown,ids:unknown,known:Map<string,Evidence>):boolean {
  if(typeof value!=="string")return true;
  const quotes=[...value.matchAll(/“([^”]+)”|"([^"]+)"|(?<![\p{L}\p{N}])[\x27‘]((?:[^\x27‘’]|(?<=[\p{L}\p{N}])[\x27’](?=[\p{L}\p{N}]))+)[\x27’](?![\p{L}\p{N}])/gu)].map(m=>m[1]??m[2]??m[3]);
  if(!quotes.length)return true;
  const normalize=(s:string)=>decodeHtmlEntities(s).normalize("NFKC").toLocaleLowerCase("en-US").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,"-").replace(/\s+/g," ").trim();
  const sources=(Array.isArray(ids)?ids:[]).map(id=>known.get(id)).filter((e):e is Extract<Evidence,{kind:"text"}>=>e?.kind==="text").map(e=>normalize(e.excerpt));
  return quotes.every(q=>sources.some(source=>source.includes(normalize(q))));
}
/** Validate model output against collector-owned evidence. Traceability is not proof of semantic support. */
export function validateAnalysis(raw: unknown, evidence: Evidence[], substantivePages?: number): string[] {
  const errors: string[] = [];
  if(hasUnapprovedEmDash(raw,evidence)) errors.push("em_dash");
  if (!isRecord(raw)) return ["analysis_not_object"];
  const known = new Map(evidence.map(item => [item.id, item]));
  if (known.size !== evidence.length) errors.push("duplicate_evidence");
  const p1 = raw.part1, p2 = raw.part2;
  if (!isRecord(p1) || !isRecord(p2)) return [...errors, "missing_parts"];
  if (!words(p1.statement, 55) || !words(p1.rationale, 45)) errors.push("positioning_copy");
  const summaryIds=Array.isArray(p1.elements)?p1.elements.flatMap(e=>isRecord(e)&&Array.isArray(e.evidenceIds)?e.evidenceIds:[]):[];
  if(!quoteTextMatches(p1.statement,summaryIds,known)||!quoteTextMatches(p1.rationale,summaryIds,known))errors.push("quote_not_in_cited_evidence");
  if (!Array.isArray(p1.elements) || p1.elements.length !== 8) errors.push("element_count");
  else {
    const keys = new Set<string>();
    for (const e of p1.elements) {
      if (!isRecord(e)) { errors.push("element_shape"); continue; }
      if (typeof e.key !== "string" || !ELEMENT_KEYS.includes(e.key as typeof ELEMENT_KEYS[number]) || keys.has(e.key)) errors.push("element_key");
      else keys.add(e.key);
      if (!["observed", "inferred", "unclear", "not_observed", "not_assessable"].includes(String(e.status))) errors.push("element_status");
      if (e.clarity !== null && ![0, 1, 2, 3].includes(e.clarity as number)) errors.push("element_clarity");
      if (e.confidence !== null && !["high", "moderate", "low"].includes(String(e.confidence))) errors.push("element_confidence");
      if (e.key === "consistency" && substantivePages !== undefined && substantivePages < 3 && e.status !== "not_assessable") errors.push("consistency_coverage");
      if (e.key === "consistency" && substantivePages !== undefined && substantivePages >= 3 && [e.finding,e.reason,e.uncertainty].some(v=>typeof v === "string" && /\b(?:fewer|less) than (?:three|3)\b/i.test(v))) errors.push("false_coverage_count");
      if (e.status === "not_assessable" && (e.clarity !== null || e.confidence !== null)) errors.push("unassessable_scored");
      if (!words(e.finding, 45) || !words(e.reason, 45) || !words(e.uncertainty, 30) || typeof e.conflict !== "boolean") errors.push("element_copy");
      if (!hasIds(e.evidenceIds, known, e.status === "not_assessable" || e.status === "not_observed")) errors.push("element_evidence");
      if([e.finding,e.reason,e.uncertainty].some(v=>!quoteTextMatches(v,e.evidenceIds,known)))errors.push("quote_not_in_cited_evidence");
      if (e.conflict === true && e.confidence === "high") errors.push("conflict_confidence");
      if (e.conflict === true && (!Array.isArray(e.evidenceIds) || new Set(e.evidenceIds).size < 2)) errors.push("conflict_evidence");
    }
  }
  if (!Array.isArray(p1.visualFindings) || p1.visualFindings.length > 3) errors.push("visual_count");
  else for (const v of p1.visualFindings) {
    if (isRecord(v) && !quoteTextMatches(v.finding,v.evidenceIds,known)) errors.push("quote_not_in_cited_evidence");
    if (!isRecord(v) || !words(v.finding, 45) || !hasIds(v.evidenceIds, known) || !v.evidenceIds.every(id => known.get(id)?.kind === "screenshot")) errors.push("visual_evidence");
  }
  if (!Array.isArray(p2.directions) || p2.directions.length > 3) errors.push("direction_count");
  else if (!Array.isArray(p2.limitations) || !p2.limitations.every(x => words(x, 30))) errors.push("direction_limitations");
  else {
    const ids = new Set<string>();
    for (const d of p2.directions) {
      if (!isRecord(d)) { errors.push("direction_shape"); continue; }
      if (typeof d.id !== "string" || !d.id.trim() || ids.has(d.id)) errors.push("direction_id"); else ids.add(d.id);
      for (const k of ["label", "audienceSituation", "communicationImplication", "clientExpectation", "tradeoff"]) if (!words(d[k], 30)) errors.push("direction_copy");
      if (!words(d.possibleStatement, 35) || !hasIds(d.evidenceIds, known)) errors.push("direction_basis");
      if([d.label,d.audienceSituation,d.possibleStatement,d.communicationImplication,d.clientExpectation,d.tradeoff,...(Array.isArray(d.validationQuestions)?d.validationQuestions:[])].some(v=>!quoteTextMatches(v,d.evidenceIds,known)))errors.push("quote_not_in_cited_evidence");
      if (typeof d.label === "string" && PROHIBITED_STATEMENT.test(d.label)) errors.push("direction_label_guarantee_or_superlative");
      if (typeof d.possibleStatement === "string" && PROHIBITED_STATEMENT.test(d.possibleStatement)) errors.push("direction_guarantee_or_superlative");
      if (typeof d.clientExpectation === "string" && PROHIBITED_EXPECTATION.test(d.clientExpectation)) errors.push("expectation_guarantee");
      if (!Array.isArray(d.validationQuestions) || d.validationQuestions.length !== 3 || !d.validationQuestions.every(q => words(q, 30))) errors.push("direction_questions");
    }
  }
  if(Array.isArray(p2.limitations)&&p2.limitations.some(v=>!quoteTextMatches(v,[],known)))errors.push("quote_not_in_cited_evidence");
  return [...new Set(errors)];
}
export type AnalysisParts = Pick<PositioningResult, "part1" | "part2">;







/** Repair feedback stays server-side and is sent only to the single permitted repair. */
export function repairFeedback(raw:unknown,evidence:Evidence[]=[]):{path:string;phrase:string;wordCount?:number;maxWords?:number}[] {
  if(!isRecord(raw) || !isRecord(raw.part2) || !Array.isArray(raw.part2.directions))return [];
  const result:{path:string;phrase:string;wordCount?:number;maxWords?:number}[]=[];
  const checkLength=(value:unknown,path:string,maxWords:number)=>{if(typeof value!=="string")return;const wordCount=value.trim()?value.trim().split(/\s+/u).length:0;if(wordCount===0||wordCount>maxWords)result.push({path,phrase:value.slice(0,500),wordCount,maxWords});};
  const findEmDash=(value:unknown,path:string):void=>{if(typeof value==="string" && value.includes("—"))result.push({path,phrase:value.slice(0,500)});else if(Array.isArray(value))value.forEach((item,index)=>findEmDash(item,`${path}[${index}]`));else if(isRecord(value))Object.entries(value).forEach(([key,item])=>findEmDash(item,path?`${path}.${key}`:key));};
  findEmDash(raw,"");
  const known=new Map(evidence.map(item=>[item.id,item]));
  const quote=(value:unknown,ids:unknown,path:string)=>{if(typeof value==="string"&&!quoteTextMatches(value,ids,known))result.push({path,phrase:value.slice(0,500)});};
  const p1=isRecord(raw.part1)?raw.part1:{};const elements=Array.isArray(p1.elements)?p1.elements:[];const allIds=elements.flatMap(e=>isRecord(e)&&Array.isArray(e.evidenceIds)?e.evidenceIds:[]);
  for(const key of ["statement","rationale"] as const){quote(p1[key],allIds,`part1.${key}`);checkLength(p1[key],`part1.${key}`,key==="statement"?55:45);}
  elements.forEach((e,i)=>{if(isRecord(e))for(const key of ["finding","reason","uncertainty"] as const){quote(e[key],e.evidenceIds,`part1.elements[${i}].${key}`);checkLength(e[key],`part1.elements[${i}].${key}`,key==="uncertainty"?30:45);}});
  if(Array.isArray(p1.visualFindings))p1.visualFindings.forEach((v,i)=>{if(isRecord(v))quote(v.finding,v.evidenceIds,`part1.visualFindings[${i}].finding`);});
  if(Array.isArray(raw.part2.limitations))raw.part2.limitations.forEach((v,i)=>quote(v,[],`part2.limitations[${i}]`));
  raw.part2.directions.forEach((d,index)=>{if(!isRecord(d))return;for(const key of ["label","audienceSituation","possibleStatement","communicationImplication","clientExpectation","tradeoff"] as const){quote(d[key],d.evidenceIds,`part2.directions[${index}].${key}`);checkLength(d[key],`part2.directions[${index}].${key}`,key==="possibleStatement"?35:30);}if(Array.isArray(d.validationQuestions))d.validationQuestions.forEach((q,i)=>quote(q,d.evidenceIds,`part2.directions[${index}].validationQuestions[${i}]`));for(const [field,pattern] of [["label",PROHIBITED_STATEMENT],["possibleStatement",PROHIBITED_STATEMENT],["clientExpectation",PROHIBITED_EXPECTATION]] as const){const value=d[field];if(typeof value==="string"&&pattern.test(value))result.push({path:`part2.directions[${index}].${field}`,phrase:value.slice(0,500)});}});
  return result;
}







