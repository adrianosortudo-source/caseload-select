import { getAnswerLabel, resolveAnswerReference } from "./catalog";
import type { AnswerReferencePath, DesiredClientAnswers, ProposedScreenProfile, ScreenProposalQuestion, ScreenProposalRow } from "./types";

type Meta={generatedAt:string;wordingReviewed:boolean};
function question(id:string,questionText:string,path:AnswerReferencePath|undefined,a:DesiredClientAnswers,use:ScreenProposalQuestion["use"],forceNeeds=false,omitCondition=false):ScreenProposalQuestion {
  const raw=path?getAnswerLabel(path,a):null;
  const normalized=Array.isArray(raw)?raw.join("; "):raw;
  const defined=Boolean(normalized)&&!resolveAnswerReference(path!,a).unknown&&!forceNeeds;
  return {id,question:questionText,desired_condition:defined&&!omitCondition?normalized:null,target_status:defined?"firm_preference":"needs_definition",source_answer_ids:path&&getAnswerLabel(path,a)!==null?[path]:[],use,missing_action:"clarify"};
}
export function buildScreenProposal(a:DesiredClientAnswers,meta:Meta):ProposedScreenProfile {
  const qWork=question("requested_work","What would you like the lawyer to help you with?",a.focus.work==="other"?"focus.work_other":"focus.work",a,"scope_review",a.focus.work==="other"&&!substantive(a.focus.work_other));
  const qRole=question("client_role","What is your involvement in this matter?",a.situation.role==="other"?"situation.role_other":"situation.role",a,"scope_review",a.situation.role==="other"&&!substantive(a.situation.role_other));
  const loc=question("service_location","Where is the matter based?","focus.service_area",a,"scope_review");
  const trig=question("triggering_event","What happened that led you to seek help?",substantive(a.write_ins?.trigger)?"write_ins.trigger":"situation.trigger",a,"scope_review");
  const stagePath:AnswerReferencePath=substantive(a.write_ins?.timing)?"write_ins.timing":"situation.timing";
  const stage=question("matter_stage","What has happened so far, and what stage has the matter reached?",stagePath,a,"scope_review",a.situation.timing==="varies"||a.situation.timing==="unknown");
  const service=question("service_scope","What help are you seeking, and are you open to agreeing the scope before work starts?",a.delivery.fit_signals.includes("scope")?"delivery.fit_signals":a.focus.work==="other"?"focus.work_other":"focus.work",a,"service_review",!a.delivery.fit_signals.includes("scope"));
  const information=question("information","What information or documents can you share for an initial conversation?",a.delivery.fit_signals.includes("information")?"delivery.fit_signals":a.delivery.conditions.includes("information")?"delivery.conditions":undefined,a,"service_review");
  const fees=question("fees","Would you like to discuss the proposed service and its fees before deciding whether to proceed?",a.delivery.fit_signals.includes("fees")?"delivery.fit_signals":a.client.decision_needs.includes("scope_cost")?"client.decision_needs":undefined,a,"service_review",!a.delivery.fit_signals.includes("fees"),!a.delivery.fit_signals.includes("fees"));
  const dates=question("dates","Is there a date you have been asked to respond by, and when would you like help?","situation.timing",a,"time_review",true);
  const progress=question("desired_progress","What would you like to be able to decide or do next?",a.client.goals.length?"client.goals":undefined,a,"next_step");
  const participants=question("participants","Who needs to take part in decisions, and can they participate when needed?",a.delivery.fit_signals.includes("decision")?"delivery.fit_signals":a.delivery.conditions.includes("decision")?"delivery.conditions":undefined,a,"next_step");
  const questions=[qWork,qRole,loc,trig,...(a.delivery.fit_signals.includes("stage")?[stage]:[])];
  const extras=[...(a.delivery.fit_signals.includes("information")||a.delivery.conditions.includes("information")?[information]:[]),...(a.delivery.fit_signals.includes("fees")||a.client.decision_needs.includes("scope_cost")?[fees]:[])];
  const valueQuestions=[service,...extras];
  if(substantive(a.write_ins?.fit_signals)) valueQuestions.push({id:"custom_fit",question:"What additional information should the firm clarify about this inquiry?",desired_condition:a.write_ins!.fit_signals!.trim(),target_status:"needs_definition",source_answer_ids:["write_ins.fit_signals"],use:"service_review",missing_action:"clarify"});
  const rows:ScreenProposalRow[]=[
    {id:"matter_fit",label:"Matter fit",questions,ask_summary:a.delivery.fit_signals.includes("stage")?"Requested work; client role; location; event and stage":"Requested work; client role; location; triggering event",use_summary:"Compare with the profile's focus; confirm scope."},
    {id:"value_delivery",label:"Value and delivery",questions:valueQuestions,ask_summary:(()=>{const hasInfo=extras.some(x=>x.id==="information"),hasFees=extras.some(x=>x.id==="fees"),hasCustom=valueQuestions.some(x=>x.id==="custom_fit");if(hasInfo&&hasFees&&hasCustom)return"Initial scope; information and fees; firm-specific signal";const parts=["Initial scope",...(hasInfo?["available information"]:[]),...(hasFees?["service and fees"]:[]),...(hasCustom?["firm-specific signal to clarify"]:[])];return parts.join("; ");})(),use_summary:"Review service fit; clarify missing conditions."},
    {id:"timing",label:"Timing",questions:[dates],ask_summary:"Stated response date; desired start; firm's availability",use_summary:"Flag time sensitivity for human review."},
    {id:"readiness",label:"Readiness",questions:[progress,...(a.delivery.fit_signals.includes("decision")||a.delivery.conditions.includes("decision")?[participants]:[])],ask_summary:a.delivery.fit_signals.includes("decision")||a.delivery.conditions.includes("decision")?"Client's goal; decision participants; next step":"Client's goal; next step",use_summary:"Identify a workable next step."},
  ];
  return {schema_version:"dcm-screen-proposal-v1",answer_revision:a.revision,generated_at:meta.generatedAt,status:"proposal",activation:"not_activated",wording_reviewed:meta.wordingReviewed,rows:rows as ProposedScreenProfile["rows"]};
}
function substantive(v:string|undefined){return Boolean(v?.trim());}
