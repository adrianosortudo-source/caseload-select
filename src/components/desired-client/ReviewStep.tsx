"use client";

import { REVIEW_COPY, COMMON_COPY, WELCOME_COPY } from "@/lib/desired-client/copy";
import { AREA_CATALOG, CAPACITY_LABELS, COLLECTED_FEE_LABELS, CONDITION_LABELS, DEVELOPMENT_NEED_LABELS, FIT_SIGNAL_LABELS, GOAL_LABELS, LESS_WORK_REASON_LABELS, LIMIT_LABELS, PAYMENT_LABELS, PRACTICE_EXPERIENCE_LABELS, PRACTICE_DIRECTION_LABELS, REASON_LABELS, TEAM_HOURS_LABELS, TIMING_LABELS, TRIGGER_LABELS, getFeeEffortLabel, getRoleLabel, getWorkLabel } from "@/lib/desired-client/catalog";
import { STAGE_DEFINITIONS, getMissingFieldsForStage } from "@/lib/desired-client/screens";
import { createAnswersDownload } from "@/lib/desired-client/export";
import type { DesiredClientAnswers } from "@/lib/desired-client/types";

type Stage = 1|2|3|4|5|6;
const OPPORTUNITY_SOURCE:Record<string,string>={comparable_enquiries:"Comparable enquiries",retained_matters:"Comparable matters retained",professional_referrals:"Professional referrals",repeat_clients:"Repeat clients or related work",website_search:"Website or search enquiries",other_source:"Another source",no_evidence:"No evidence yet",unknown:"Not sure"};
const SUCCESS_MEASURE:Record<string,string>={retained_matters:"More comparable matters retained",contribution_effort:"Better contribution relative to effort",predictable_delivery:"More predictable delivery",practice_mix_reputation:"Desired practice mix or reputation",other:"Another outcome",unknown:"Not sure yet"};
const filled=(...values:Array<string|null|undefined>)=>values.filter((value):value is string=>Boolean(value?.trim()));
const valueLabel=(value:string|null|undefined,labels:Record<string,string>)=>value?labels[value]??value:"";
export function ReviewStep({answers,onCreate,onRetry,onEdit,onCreateStructured,briefNeedsUpdate,loading,error,retryAllowed,legacyBriefReplaced=false}:{
  answers:DesiredClientAnswers; onCreate:()=>void; onRetry:()=>void; onEdit:(stage:Stage)=>void; onCreateStructured?:()=>void;
  briefNeedsUpdate:boolean; loading:boolean; error:""|"unavailable"|"invalid"|"changed"|"focusChanged";retryAllowed:boolean;legacyBriefReplaced?:boolean;
}) {
  const area=answers.focus.area;
  const work=answers.focus.work==="other"?answers.focus.work_other:area&&answers.focus.work?getWorkLabel(area,answers.focus.work):"";
  const role=answers.situation.role==="other"?answers.situation.role_other:area&&answers.situation.role?getRoleLabel(area,answers.situation.role):answers.situation.role==="unknown"?"Not sure yet":"";
  const trigger=answers.write_ins?.trigger?.trim()||(area&&answers.situation.trigger&&answers.situation.trigger!=="unknown"?TRIGGER_LABELS[area][answers.situation.trigger.split(".").at(-1)??""]:"")||valueLabel(answers.situation.trigger,{"unknown":"Not sure yet"});
  const reasons=answers.value.reasons.map(item=>REASON_LABELS[item]);
  const valueDetails=filled(
    answers.value.fee_effort?getFeeEffortLabel(answers.value.fee_effort,answers.focus.route):"",
    answers.value.collected_fee?COLLECTED_FEE_LABELS[answers.value.collected_fee]:"",
    answers.value.team_hours?TEAM_HOURS_LABELS[answers.value.team_hours]:"",
    answers.value.payment?PAYMENT_LABELS[answers.value.payment]:"",
    answers.value.fee_amount?(answers.value.currency?answers.value.currency+" ":"")+answers.value.fee_amount+" ("+valueLabel(answers.value.amount_basis,{"recorded":"recorded","estimated":"estimated","unknown":"basis unknown"})+")":"",
    answers.value.direct_cost_amount?"Direct cost: "+(answers.value.currency?answers.value.currency+" ":"")+answers.value.direct_cost_amount:"",
    valueLabel(answers.value.amount_scope,{per_matter:"Amounts are per matter",range:"Amounts are ranges across matters",other:"Amount basis described by the firm"}),
    ...reasons,
    answers.practice.enjoys
  );
  const rows:Array<{stage:Stage;label:string;items:string[]}>=[
    {stage:1,label:STAGE_DEFINITIONS[0].label.replace(/^\d+\s*/,""),items:filled("Work to grow: "+(work||"Not yet specified"),valueLabel(answers.practice.direction,PRACTICE_DIRECTION_LABELS),answers.practice.firm_type?("Current practice: "+answers.practice.firm_type):"Current practice: Not described",answers.practice.enjoys?("Work the team enjoys: "+answers.practice.enjoys):"",answers.direction.less&&answers.direction.less!=="none"?("Market less: "+valueLabel(answers.direction.less,{within:"Other work in this practice",outside:"Work outside this practice",model:"Work needing a different delivery model"})+(answers.direction.less_note?(" · "+answers.direction.less_note):"")+(answers.direction.less_reason?(" · Reason: "+LESS_WORK_REASON_LABELS[answers.direction.less_reason]):" · Reason: Not specified yet")):"Marketing emphasis to reduce: None identified yet")},
    {stage:2,label:STAGE_DEFINITIONS[1].label.replace(/^\d+\s*/,""),items:filled(area?AREA_CATALOG[area].label:"",work,role,trigger,valueLabel(answers.situation.timing,TIMING_LABELS),"Firm experience: "+valueLabel(answers.practice.experience,PRACTICE_EXPERIENCE_LABELS),answers.practice.capability?("Experience supporting this direction: "+answers.practice.capability):"",answers.practice.development_needs.length?("Development needs: "+answers.practice.development_needs.map(id=>DEVELOPMENT_NEED_LABELS[id]).join(", ")):"",answers.client_context.geography,answers.client_context.relevant_circumstances,answers.client_context.community_focus,answers.client_context.language_service_needs,answers.client_context.repeat_matter_pattern,answers.client.goals.map(id=>GOAL_LABELS[id]).join(", "))},
    {stage:3,label:STAGE_DEFINITIONS[2].label.replace(/^\d+\s*/,""),items:valueDetails},
    {stage:4,label:STAGE_DEFINITIONS[3].label.replace(/^\d+\s*/,""),items:filled(...answers.delivery.fit_signals.map(id=>FIT_SIGNAL_LABELS[id]),...answers.delivery.conditions.map(id=>CONDITION_LABELS[id]),valueLabel(answers.delivery.limit,LIMIT_LABELS))},
    {stage:5,label:STAGE_DEFINITIONS[4].label.replace(/^\d+\s*/,""),items:filled(...answers.opportunity.sources.map(id=>OPPORTUNITY_SOURCE[id]),answers.opportunity.source_detail,answers.opportunity.period,answers.opportunity.enquiry_count?"Enquiries: "+answers.opportunity.enquiry_count:"",answers.opportunity.retained_count?"Retained: "+answers.opportunity.retained_count:"",answers.opportunity.conversion?"Conversion: "+answers.opportunity.conversion:"",answers.opportunity.acquisition_cost?"Acquisition cost: "+answers.opportunity.acquisition_cost:"",valueLabel(answers.opportunity.data_basis,{recorded:"Figures from firm records",estimated:"Figures are estimates",unknown:"Figure basis not known"}),answers.opportunity.uncertainty)},
    {stage:6,label:STAGE_DEFINITIONS[5].label.replace(/^\d+\s*/,""),items:filled(valueLabel(answers.delivery.capacity,CAPACITY_LABELS),valueLabel(answers.repeatability.success_measure,SUCCESS_MEASURE),answers.repeatability.success_measure==="other"?answers.repeatability.success_other:"",answers.repeatability.target,answers.repeatability.review_period,answers.repeatability.additional_matters,answers.repeatability.staffing_constraint)}
  ];
  const openItems:Array<{stage:Stage;label:string}>=[];
  if(answers.practice.experience==="unknown"||!answers.practice.experience) openItems.push({stage:2,label:"Experience supporting this direction is not established"});
  if((answers.practice.experience==="adjacent"||answers.practice.experience==="new")&&!answers.practice.development_needs.length) openItems.push({stage:2,label:"Development needs have not been identified"});
  if((answers.practice.experience==="regular"||answers.practice.experience==="occasional"||answers.practice.experience==="adjacent")&&!answers.practice.capability.trim()) openItems.push({stage:2,label:"Experience detail could strengthen this profile"});
  if(!answers.value.fee_effort||answers.value.fee_effort==="unknown") openItems.push({stage:3,label:"Value relative to delivery effort needs confirmation"});
  if(!answers.delivery.fit_signals.length&&!answers.delivery.conditions.length) openItems.push({stage:4,label:"Observable enquiry signals are not yet defined"});
  if(answers.opportunity.sources.includes("unknown")||answers.opportunity.sources.includes("no_evidence")) openItems.push({stage:5,label:"Demand and acquisition evidence remains unestablished"});
  if(!answers.repeatability.success_measure||answers.repeatability.success_measure==="unknown") openItems.push({stage:6,label:"A measure of progress still needs to be agreed"});
  if(!answers.delivery.capacity||answers.delivery.capacity==="unknown") openItems.push({stage:6,label:"Capacity for additional work remains unknown"});
  function downloadAnswers(){
    const file=createAnswersDownload(answers),url=URL.createObjectURL(new Blob([file.content],{type:file.mimeType})),link=document.createElement("a");
    link.href=url;link.download=file.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="dc-review" data-ui-component-content="desired-client-review" aria-busy={loading}>
    <h1 data-ui-copy="heading">{REVIEW_COPY.heading}</h1>
    <p data-ui-copy="body">{REVIEW_COPY.note}</p>
    {briefNeedsUpdate&&<p className="dc-alert" data-ui-copy="body">{COMMON_COPY.briefChanged}</p>}
    {legacyBriefReplaced&&<p className="dc-alert" data-ui-copy="body">{WELCOME_COPY.legacyBriefReplaced}</p>}
    {error==="unavailable"&&<p className="dc-alert" role="alert" data-ui-copy="body">{COMMON_COPY.aiUnavailable}</p>}
    {error==="invalid"&&<p className="dc-alert" role="alert" data-ui-copy="body">{COMMON_COPY.aiInvalid}</p>}
    <section className="dc-review__definition-check" aria-label="Practice direction confirmation summary">
      <h2 data-ui-copy="heading">Check the practice direction before creating a draft</h2>
      <p data-ui-copy="body">Current practice: {answers.practice.firm_type.trim()||"Not described yet"}</p>
      <p data-ui-copy="body">Work to grow: {work||"Not specified yet"}</p>
      <p data-ui-copy="body">Experience: {valueLabel(answers.practice.experience,PRACTICE_EXPERIENCE_LABELS)||"Not answered yet"}</p>
      <p data-ui-copy="body">Experience supporting this direction: {answers.practice.capability.trim()||"Not supplied"}</p>
      <p data-ui-copy="body">What needs development or confirmation: {answers.practice.development_needs.length?answers.practice.development_needs.map(id=>DEVELOPMENT_NEED_LABELS[id]).join(", "):"Not identified"}</p>
      <p data-ui-copy="body">Marketing emphasis to reduce: {answers.direction.less&&answers.direction.less!=="none"?(answers.direction.less_note.trim()||"Work to name")+(answers.direction.less_reason?"; "+LESS_WORK_REASON_LABELS[answers.direction.less_reason]:"; reason not specified yet"):"None identified yet"}</p>
    </section>
    {loading&&<><p role="status" data-ui-copy="supporting"><strong>{REVIEW_COPY.creatingAI}</strong></p><p data-ui-copy="supporting">{REVIEW_COPY.loadingNote}</p></>}
    <div className="dc-summary-list">{rows.map(({label,items,stage})=><div key={label} className="dc-summary-row" data-ui-component-content="review-summary-row">
      <div data-ui-component-content="review-summary-content"><h2 data-ui-copy="heading">{label}</h2>
        {items.length?<ul>{items.map((item,index)=><li key={stage+"-"+index} data-ui-copy="body">{item}</li>)}</ul>:<p data-ui-copy="supporting">No detail added yet.</p>}
        {getMissingFieldsForStage(stage,answers).length>0&&<p data-ui-copy="supporting">One or more required choices in this section still need an answer.</p>}
      </div><button type="button" className="dc-button dc-button--secondary" disabled={loading} onClick={()=>onEdit(stage)}>{COMMON_COPY.edit}</button>
    </div>)}</div>
    <section className="dc-summary-row dc-summary-row--open" aria-label="Still open">
      <div><h2 data-ui-copy="heading">Still open</h2>{openItems.length?<ul>{openItems.map(({label},index)=><li key={index} data-ui-copy="body">{label}</li>)}</ul>:<p data-ui-copy="supporting">No material gaps identified from these answers.</p>}</div>
      {openItems.length>0&&<div className="dc-actions">{[...new Set(openItems.map(item=>item.stage))].map(stage=><button key={stage} type="button" className="dc-button dc-button--secondary" disabled={loading} onClick={()=>onEdit(stage)}>Edit {STAGE_DEFINITIONS[stage-1].label.replace(/^\d+\s*/,"")}</button>)}</div>}
    </section>
    <section className="dc-review__generate" data-ui-component-content="desired-client-ai-consent">
      <h2 data-ui-copy="heading">{REVIEW_COPY.prepareAI}</h2>
      <p data-ui-copy="body">AI will connect your choices into a Desired Client Blueprint: the client situation and matter, why the work fits the firm, the signs of a relevant enquiry, what the firm has seen so far, and what would make the work worth repeating. It will keep reported experience, estimates, preferences and unknowns distinct. You can review and correct the draft.</p>
      <p data-ui-copy="supporting">The blueprint is a working marketing definition. It does not verify the firm&apos;s experience or economics, approve a target, decide whether to accept a client, or activate a lead score. The firm makes those judgments.</p>
      <p data-ui-copy="supporting">{WELCOME_COPY.aiDisclosure}</p>
      <p data-ui-copy="supporting">Selecting “{REVIEW_COPY.prepareAI}” sends your answers to Google Gemini for this draft. Describe patterns of work only. Do not enter confidential or identifying client information.</p>
      <div className="dc-actions">
        {error?(retryAllowed&&<button type="button" className="dc-button dc-button--primary" disabled={loading} onClick={onRetry}>{REVIEW_COPY.tryAgain}</button>):<button type="button" className="dc-button dc-button--primary" disabled={loading} onClick={onCreate}>{loading?REVIEW_COPY.creatingAI:REVIEW_COPY.prepareAI}</button>}
        {error&&onCreateStructured&&<button type="button" className="dc-button dc-button--secondary" disabled={loading} onClick={onCreateStructured}>Continue with a structured draft</button>}
        <button type="button" className="dc-button dc-button--secondary" disabled={loading} onClick={downloadAnswers}>{error?REVIEW_COPY.answerDownloadAgain:REVIEW_COPY.answerDownload}</button>
      </div>
    </section>
    <p className="dc-footnote" data-ui-copy="body">{REVIEW_COPY.draftFooter}</p>
  </section>;
}
