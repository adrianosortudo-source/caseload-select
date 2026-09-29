"use client";

import { REVIEW_COPY, COMMON_COPY, WELCOME_COPY } from "@/lib/desired-client/copy";
import { AREA_CATALOG, CAPACITY_LABELS, COLLECTED_FEE_LABELS, CONDITION_LABELS, FIT_SIGNAL_LABELS, GOAL_LABELS, LIMIT_LABELS, PAYMENT_LABELS, REASON_LABELS, TEAM_HOURS_LABELS, TIMING_LABELS, TRIGGER_LABELS, getFeeEffortLabel, getRoleLabel, getWorkLabel } from "@/lib/desired-client/catalog";
import { STAGE_DEFINITIONS, getMissingFieldsForStage } from "@/lib/desired-client/screens";
import { createAnswersDownload } from "@/lib/desired-client/export";
import type { DesiredClientAnswers } from "@/lib/desired-client/types";

type Stage = 1|2|3|4|5|6;
const PRACTICE_DIRECTION:Record<string,string>={grow_proven:"Grow proven work",narrow_specialty:"Concentrate on a narrower specialty",explore_direction:"Explore a new direction",improve_delivery:"Make existing work easier to deliver",other:"Another direction",unknown:"Not sure yet"};
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
    answers.practice.capability,answers.practice.enjoys
  );
  const rows:Array<{stage:Stage;label:string;items:string[]}>=[
    {stage:1,label:STAGE_DEFINITIONS[0].label.replace(/^\d+\s*/,""),items:filled(valueLabel(answers.practice.direction,PRACTICE_DIRECTION),answers.practice.firm_type,answers.practice.capability,answers.practice.enjoys,answers.direction.less?("Promote less: "+valueLabel(answers.direction.less,{within:"Other work in this practice",outside:"Work outside this practice",model:"Work needing a different delivery model",none:"Nothing identified yet"})):"")},
    {stage:2,label:STAGE_DEFINITIONS[1].label.replace(/^\d+\s*/,""),items:filled(area?AREA_CATALOG[area].label:"",work,role,trigger,valueLabel(answers.situation.timing,TIMING_LABELS),answers.client_context.geography,answers.client_context.relevant_circumstances,answers.client_context.community_focus,answers.client_context.language_service_needs,answers.client_context.repeat_matter_pattern,answers.client.goals.map(id=>GOAL_LABELS[id]).join(", "))},
    {stage:3,label:STAGE_DEFINITIONS[2].label.replace(/^\d+\s*/,""),items:valueDetails},
    {stage:4,label:STAGE_DEFINITIONS[3].label.replace(/^\d+\s*/,""),items:filled(...answers.delivery.fit_signals.map(id=>FIT_SIGNAL_LABELS[id]),...answers.delivery.conditions.map(id=>CONDITION_LABELS[id]),valueLabel(answers.delivery.limit,LIMIT_LABELS))},
    {stage:5,label:STAGE_DEFINITIONS[4].label.replace(/^\d+\s*/,""),items:filled(...answers.opportunity.sources.map(id=>OPPORTUNITY_SOURCE[id]),answers.opportunity.source_detail,answers.opportunity.period,answers.opportunity.enquiry_count?"Enquiries: "+answers.opportunity.enquiry_count:"",answers.opportunity.retained_count?"Retained: "+answers.opportunity.retained_count:"",answers.opportunity.conversion?"Conversion: "+answers.opportunity.conversion:"",answers.opportunity.acquisition_cost?"Acquisition cost: "+answers.opportunity.acquisition_cost:"",valueLabel(answers.opportunity.data_basis,{recorded:"Figures from firm records",estimated:"Figures are estimates",unknown:"Figure basis not known"}),answers.opportunity.uncertainty)},
    {stage:6,label:STAGE_DEFINITIONS[5].label.replace(/^\d+\s*/,""),items:filled(valueLabel(answers.delivery.capacity,CAPACITY_LABELS),valueLabel(answers.repeatability.success_measure,SUCCESS_MEASURE),answers.repeatability.success_measure==="other"?answers.repeatability.success_other:"",answers.repeatability.target,answers.repeatability.review_period,answers.repeatability.additional_matters,answers.repeatability.staffing_constraint)}
  ];
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
    {loading&&<><p role="status" data-ui-copy="supporting"><strong>{REVIEW_COPY.creatingAI}</strong></p><p data-ui-copy="supporting">{REVIEW_COPY.loadingNote}</p></>}
    <div className="dc-summary-list">{rows.map(({label,items,stage})=><div key={label} className="dc-summary-row" data-ui-component-content="review-summary-row">
      <div data-ui-component-content="review-summary-content"><h2 data-ui-copy="heading">{label}</h2>
        {items.length?<ul>{items.map((item,index)=><li key={stage+"-"+index} data-ui-copy="body">{item}</li>)}</ul>:<p data-ui-copy="supporting">No detail added yet.</p>}
        {getMissingFieldsForStage(stage,answers).length>0&&<p data-ui-copy="supporting">One or more required choices in this section still need an answer.</p>}
      </div><button type="button" className="dc-button dc-button--secondary" disabled={loading} onClick={()=>onEdit(stage)}>{COMMON_COPY.edit}</button>
    </div>)}</div>
    <section className="dc-review__generate" data-ui-component-content="desired-client-ai-consent">
      <h2 data-ui-copy="heading">{REVIEW_COPY.prepareAI}</h2>
      <p data-ui-copy="body">AI will connect your choices into a Desired Client Blueprint: the client situation and matter, why the work fits the firm, the signs of a relevant enquiry, what the firm has seen so far, and what would make the work worth repeating. It will keep reported experience, estimates, preferences and unknowns distinct. You can review and correct the draft.</p>
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
