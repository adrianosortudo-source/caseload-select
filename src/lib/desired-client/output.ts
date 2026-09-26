import { resolveAnswerReference, WRITE_IN_KEYS } from "./catalog";
import type { AnalysisResult, AnswerReferencePath, ClarificationCode, DesiredClientAnswers, DesiredClientBrief, DesiredClientStatement } from "./types";

const SOURCE_PATHS = new Set<string>([
  "focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.certainty", "focus.route",
  "situation.trigger", "situation.timing", "situation.role", "situation.role_other", "situation.contact",
  "client.goals", "client.concerns", "client.decision_needs", "value.reasons", "value.fee_effort", "value.collected_fee", "value.team_hours", "value.payment",
  "delivery.conditions", "delivery.capacity", "delivery.limit", "delivery.fit_signals", "direction.aim", "direction.evidence", "direction.less", "direction.less_note",
  ...WRITE_IN_KEYS.map(key => `write_ins.${key}`),
  "clarifications.FOCUS_UNCLEAR", "clarifications.CLIENT_GOAL_UNCLEAR", "clarifications.CURRENT_CAPACITY_CONFLICT", "clarifications.FEE_EFFORT_CONFLICT", "clarifications.EXPERIENCE_DIRECTION_CONFLICT",
  ...(["a", "b"] as const).flatMap(side => ["work", "fee_effort", "team_fit", "capacity", "evidence"].map(field => `focus.comparison.${side}.${field}`)),
]);
const KIND = ["experience", "preference", "hypothesis", "unknown", "suggestion"] as const;
const FIELDS = { portrait: [60,420], client_need: [35,250], firm_value: [45,320], message: [14,100], content: [16,115], next_step: [14,100], open: [18,130] } as const;
const UNKNOWN_BANNED = /\u2014|<\/?[a-z][^>]*>|https?:\/\/|\bwww\.|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\[[^\]]+\]\([^)]+\)|%|\bpercent(?:age)?\b/i;
const numericTokens = (s:string) => [...s.matchAll(/(?:[$€£]\s*)?\d+(?:[\s,]\d{3})*(?:\.\d+)?/gu)].map(m=>m[0].replace(/[^\d.]/g,""));
const record = (v:unknown):v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v:unknown, keys:string[]):v is Record<string,unknown> => record(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
function validStatement(v:unknown,a:DesiredClientAnswers,budget:readonly [number,number],slot:string):v is DesiredClientStatement {
  if(!exact(v,["text","kind","source_answer_ids"]) || typeof v.text!=="string" || typeof v.kind!=="string" || !KIND.includes(v.kind as typeof KIND[number]) || !Array.isArray(v.source_answer_ids)) return false;
  const text=v.text.trim().replace(/\s+/g," "), words=text.split(" ").filter(Boolean).length;
  if(!text || text.length>budget[1] || words>budget[0] || UNKNOWN_BANNED.test(text) || (numericTokens(text).length>0 && /\b(?:profit|ROI|return on investment|net margin|hourly rate|per hour)\b/i.test(text))) return false;
  const paths=v.source_answer_ids as unknown[];
  if(paths.length<1||paths.length>8||paths.some(p=>typeof p!=="string"||!SOURCE_PATHS.has(p))||new Set(paths).size!==paths.length) return false;
  const unknownPaths:string[]=[]; const resolvedValues:string[]=[];
  for(const path of paths as AnswerReferencePath[]) {
    const resolved=resolveAnswerReference(path,a);
    if(!resolved.present||resolved.value===null) return false;
    if(resolved.unknown) unknownPaths.push(path); else resolvedValues.push(resolved.value);
  }
  if(unknownPaths.length && !(slot==="open" && v.kind==="suggestion")) return false;
  if(slot==="portrait" && v.kind==="experience" && (a.focus.route!=="established" || paths.every(p=>String(p).startsWith("focus.")))) return false;
  if(["message","content","next_step"].includes(slot) && v.kind!=="suggestion") return false;
  if(numericTokens(text).some(n=>!numericTokens(resolvedValues.join(" ")).includes(n))) return false;
  return true;
}
function validArray(v:unknown,a:DesiredClientAnswers,budget:readonly [number,number],min:number,max:number,slot:string):v is DesiredClientStatement[] {
  return Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(item=>validStatement(item,a,budget,slot));
}
export function validateAnalysisResult(value:unknown,answers:DesiredClientAnswers,eligibleCodes:readonly ClarificationCode[]):AnalysisResult|null {
  if(!exact(value,["brief","clarification_code"])) return null;
  if(value.clarification_code!==null && (typeof value.clarification_code!=="string"||value.clarification_code!==eligibleCodes[0])) return null;
  const b=value.brief;
  if(!exact(b,["report_version","portrait","client_need","firm_value","marketing","open_questions"])||b.report_version!=="dcm-blueprint-v1") return null;
  if(!validStatement(b.portrait,answers,FIELDS.portrait,"portrait")||!validStatement(b.client_need,answers,FIELDS.client_need,"client_need")||!validStatement(b.firm_value,answers,FIELDS.firm_value,"firm_value")) return null;
  if(!exact(b.marketing,["message","content","next_step"])||!validStatement(b.marketing.message,answers,FIELDS.message,"message")||!validStatement(b.marketing.content,answers,FIELDS.content,"content")||!validStatement(b.marketing.next_step,answers,FIELDS.next_step,"next_step")) return null;
  if(!validArray(b.open_questions,answers,FIELDS.open,0,2,"open")) return null;
  return value as unknown as AnalysisResult;
}
const STATEMENT_SCHEMA={type:"object",properties:{text:{type:"string"},kind:{type:"string",enum:["experience","preference","hypothesis","unknown","suggestion"]},source_answer_ids:{type:"array",minItems:1,maxItems:8,items:{type:"string"}}},required:["text","kind","source_answer_ids"]} as const;
export const BLUEPRINT_RESPONSE_SCHEMA = {
  type:"object", properties:{
    clarification_code:{type:"string",nullable:true,enum:["FOCUS_UNCLEAR","CLIENT_GOAL_UNCLEAR","CURRENT_CAPACITY_CONFLICT","FEE_EFFORT_CONFLICT","EXPERIENCE_DIRECTION_CONFLICT"]},
    brief:{type:"object",properties:{report_version:{type:"string",enum:["dcm-blueprint-v1"]},portrait:STATEMENT_SCHEMA,client_need:STATEMENT_SCHEMA,firm_value:STATEMENT_SCHEMA,marketing:{type:"object",properties:{message:STATEMENT_SCHEMA,content:STATEMENT_SCHEMA,next_step:STATEMENT_SCHEMA},required:["message","content","next_step"]},open_questions:{type:"array",maxItems:2,items:STATEMENT_SCHEMA}},required:["report_version","portrait","client_need","firm_value","marketing","open_questions"]}
  },required:["clarification_code","brief"]
} as const;
