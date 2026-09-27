import { AREA_CATALOG, EVIDENCE_LABELS, getAnswerLabel, getWorkLabel, resolveAnswerReference } from "./catalog";
import { getSourceDetails } from "./sources";
import { buildScreenProposal } from "./screening";
import type { AnswerReferencePath, DesiredClientAnswers, DesiredClientBrief, DesiredClientStatement, SavedBrief } from "./types";

export type BlueprintMetadata={mode:SavedBrief["mode"];generatedAt:string;wordingReviewed:boolean;openClarificationCode?:SavedBrief["openClarificationCode"]};
export type BlueprintViewModel={title:string;status:string;modeLabel:string;mode:SavedBrief["mode"];date:string;provisional:boolean;context:{client:string;startingPoint:string;work:string};brief:DesiredClientBrief;screens:ReturnType<typeof buildScreenProposal>;stillToConfirm:string[];allNotes:string[];evidence:string[];sourceDetails:Array<{slot:string;statement:DesiredClientStatement;answers:Array<{path:AnswerReferencePath;question:string;answer:string|null}>}>;allAnswers:Array<{question:string;answer:string}>};
const fmt=(d:string)=>new Date(d).toLocaleDateString("en-CA");
function notes(a:DesiredClientAnswers,b:DesiredClientBrief,meta:BlueprintMetadata){
 const n:Array<{id:string;text:string;sources:string[]}> = [];
 const add=(id:string,text:string,sources:string[])=>n.push({id,text,sources});
 if(a.delivery.capacity==="change"&&a.focus.route==="established"&&a.clarifications.CURRENT_CAPACITY_CONFLICT===null)add("capacity_conflict","Resolve the capacity conflict",["delivery.capacity","focus.route","direction.aim"]);
 if(a.value.fee_effort==="difficult"&&a.value.reasons.includes("fees")&&a.clarifications.FEE_EFFORT_CONFLICT===null)add("fee_conflict","Resolve the fee and effort conflict",["value.fee_effort","value.reasons"]);
 if(a.focus.route==="new"&&a.direction.aim==="more_current"&&a.clarifications.EXPERIENCE_DIRECTION_CONFLICT===null)add("direction_conflict","Confirm established work or future direction",["focus.route","direction.aim"]);
 if(!a.focus.work||(a.focus.work==="other"&&!a.focus.work_other.trim()))add("work_undefined","Define the work more specifically",["focus.work","focus.work_other"]);
 if(!a.situation.role||a.situation.role==="unknown"||(a.situation.role==="other"&&!a.situation.role_other.trim()))add("role_undefined","Confirm the client role",["situation.role","situation.role_other"]);
 if((!a.situation.trigger||a.situation.trigger==="unknown")&&!a.write_ins?.trigger?.trim())add("trigger_unknown","Confirm what prompts the inquiry",["situation.trigger"]);
 if((!a.value.fee_effort||a.value.fee_effort==="unknown")&&!a.write_ins?.fee_effort?.trim())add("fee_effort_unknown","Confirm whether the fee supports the effort",["value.fee_effort"]);
 if((!a.delivery.capacity||a.delivery.capacity==="unknown")&&!a.write_ins?.capacity?.trim())add("capacity_unknown","Confirm delivery capacity",["delivery.capacity"]);
 if((!a.delivery.fit_signals.length||a.delivery.fit_signals.includes("unknown"))&&!a.write_ins?.fit_signals?.trim())add("fit_signals_unknown","Define the early fit signals",["delivery.fit_signals"]);
 if(!a.focus.service_area.trim())add("service_area_missing","Confirm the service area",["focus.service_area"]);
 if(a.client.decision_needs.some(x=>x!=="unknown")||(a.focus.route!=="established"&&a.client.concerns.some(x=>x!=="unheard"))||a.write_ins?.concerns?.trim())add("client_evidence_missing","Validate client concerns and decision needs",["client.concerns","client.decision_needs","write_ins.concerns","write_ins.decision_needs"]);
 if(meta.openClarificationCode){const labels:Record<string,[string,string[]]>={CURRENT_CAPACITY_CONFLICT:["Resolve the capacity conflict",["clarifications.CURRENT_CAPACITY_CONFLICT"]],FEE_EFFORT_CONFLICT:["Resolve the fee and effort conflict",["clarifications.FEE_EFFORT_CONFLICT"]],EXPERIENCE_DIRECTION_CONFLICT:["Confirm established work or future direction",["clarifications.EXPERIENCE_DIRECTION_CONFLICT"]],FOCUS_UNCLEAR:["Define the work more specifically",["clarifications.FOCUS_UNCLEAR"]],CLIENT_GOAL_UNCLEAR:["Clarify the client's main goal",["clarifications.CLIENT_GOAL_UNCLEAR"]]};const [text,sources]=labels[meta.openClarificationCode];if(!n.some(x=>x.id===meta.openClarificationCode))n.unshift({id:meta.openClarificationCode,text,sources});}
 const normalize=(text:string)=>text.trim().replace(/\s+/g," ").toLowerCase();
 for(const item of b.open_questions){const key=normalize(item.text)+"|"+[...item.source_answer_ids].sort().join(",");if(!n.some(x=>normalize(x.text)+"|"+[...x.sources].sort().join(",")===key))add("model:"+key,item.text,item.source_answer_ids);}
 if(!a.direction.evidence.length||a.direction.evidence.includes("preference"))add("evidence","Test this direction against relevant client and delivery evidence",["direction.evidence"]);
 return n.map(x=>x.text);
}
export function buildBlueprintViewModel(brief:DesiredClientBrief,a:DesiredClientAnswers,meta:BlueprintMetadata):BlueprintViewModel{
 const role=a.situation.role==="other"?a.situation.role_other.trim():a.situation.role&&a.situation.role!=="unknown"&&a.focus.area?getAnswerLabel("situation.role",a):null;
 const work=a.focus.work==="other"?a.focus.work_other.trim():a.focus.area&&a.focus.work?getWorkLabel(a.focus.area,a.focus.work):null;
 const trig=a.write_ins?.trigger?.trim()||getAnswerLabel("situation.trigger",a);
 const conflict=(a.delivery.capacity==="change"&&a.focus.route==="established"&&(a.direction.aim==="more_current"||a.direction.aim==="narrower"))||(a.value.fee_effort==="difficult"&&a.value.reasons.includes("fees"))||(a.focus.route==="new"&&a.direction.aim==="more_current");
 const provisional=a.focus.route==="new"||a.focus.route==="exploring"||a.situation.role==="unknown"||!a.situation.role||a.situation.role==="other"&&!role||a.focus.work==="other"&&!work||(!a.situation.trigger||a.situation.trigger==="unknown")&&!a.write_ins?.trigger?.trim()||(!a.value.fee_effort||a.value.fee_effort==="unknown")&&!a.write_ins?.fee_effort?.trim()||(!a.delivery.capacity||a.delivery.capacity==="unknown")&&!a.write_ins?.capacity?.trim()||(!a.delivery.fit_signals.length||a.delivery.fit_signals.includes("unknown"))&&!a.write_ins?.fit_signals?.trim()||!a.client.goals.length||a.client.goals.includes("unknown")||!a.direction.aim||a.direction.aim==="unknown"||conflict||Boolean(meta.openClarificationCode);
 const allNotes=notes(a,brief,meta), details:Array<BlueprintViewModel["sourceDetails"][number]>=[];
 const slots:[string,DesiredClientStatement][]=[["Desired client portrait",brief.portrait],["Client need",brief.client_need],["Firm value",brief.firm_value],["Marketing message",brief.marketing.message],["Content idea",brief.marketing.content],["Next step",brief.marketing.next_step],...brief.open_questions.map((s,i)=>[`Open question ${i+1}`,s] as [string,DesiredClientStatement])];
 for(const [slot,s] of slots)details.push({slot,statement:s,answers:s.source_answer_ids.map(path=>({...getSourceDetails(path,a),path}))});
 const allPaths:AnswerReferencePath[]=["focus.area","focus.work","focus.work_other","focus.service_area","focus.route","situation.trigger","write_ins.trigger","situation.timing","write_ins.timing","situation.role","situation.role_other","situation.contact","client.goals","write_ins.goals","client.concerns","write_ins.concerns","client.decision_needs","write_ins.decision_needs","value.reasons","write_ins.reasons","value.fee_effort","write_ins.fee_effort","value.collected_fee","value.team_hours","value.payment","delivery.conditions","write_ins.conditions","delivery.capacity","write_ins.capacity","delivery.limit","write_ins.limit","delivery.fit_signals","write_ins.fit_signals","direction.aim","write_ins.aim","direction.evidence","write_ins.evidence","direction.less","direction.less_note"];
 const allAnswers=allPaths.flatMap(path=>{const resolved=resolveAnswerReference(path,a);if(!resolved.present||resolved.value===null)return[];const source=getSourceDetails(path,a);return[{question:source.question,answer:source.answer??"Not supplied"}];}).filter((x,i,arr)=>arr.findIndex(y=>y.question===x.question&&y.answer===x.answer)===i);
 const evidence=a.direction.evidence.map(x=>EVIDENCE_LABELS[x]);
 const service=a.focus.service_area.trim(),clientRole=role?role.length>90?"Firm-defined client role":role:"Client role to confirm";
 const contextClient=service?clientRole+" · "+(service.length>90?"Service area in supporting detail":service):clientRole;
 const contextWork=work?(work.length>90?(a.focus.area?AREA_CATALOG[a.focus.area].label+": selected work":"Firm-defined work"):work):"Work to confirm";
 const contextTrigger=trig?(trig.length>90?"Firm-defined situation":trig):"Starting situation to confirm";
 return {title:"Desired Client Blueprint",status:meta.wordingReviewed?"Wording reviewed by you":"Working draft",modeLabel:meta.mode==="ai"?"AI-assisted working draft":"Basic version",mode:meta.mode,date:fmt(meta.generatedAt),provisional,context:{client:contextClient,startingPoint:contextTrigger,work:contextWork},brief,screens:buildScreenProposal(a,{generatedAt:meta.generatedAt,wordingReviewed:meta.wordingReviewed}),stillToConfirm:allNotes.slice(0,2),allNotes,evidence,sourceDetails:details,allAnswers};
}
