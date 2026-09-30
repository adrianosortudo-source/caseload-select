"use client";

import type { ReactNode } from "react";
import {
  AREA_ORDER, CAPACITY_LABELS, COLLECTED_FEE_LABELS, CONDITION_LABELS, FIT_SIGNAL_OPTIONS,
  LIMIT_LABELS, PAYMENT_LABELS, REASON_LABELS, TEAM_HOURS_LABELS, TIMING_LABELS,
  TRIGGER_EXAMPLES, TRIGGER_OPTIONS, getAreaLabel, getFeeEffortLabel, getReasonLabel,
  getRoleOptions, getWorkOptions,
} from "@/lib/desired-client/catalog";
import { COMMON_COPY, PRIVACY_FIELD_COPY } from "@/lib/desired-client/copy";
import { STAGE_DEFINITIONS, type StageId } from "@/lib/desired-client/screens";
import type { AreaId, DesiredClientAnswers, OpportunitySourceId, SuccessMeasureId, WriteInKey } from "@/lib/desired-client/types";
import { ChoiceGroup, type ChoiceGroupOption } from "./ChoiceGroup";

type Change = (edit: (answers: DesiredClientAnswers) => DesiredClientAnswers) => void;
const entries = (record: Record<string, string>): ChoiceGroupOption[] => Object.entries(record).map(([id, label]) => ({ id, label }));
const PRACTICE_DIRECTION_OPTIONS: ChoiceGroupOption[] = [
  { id: "grow_proven", label: "Grow work the firm already handles well" },
  { id: "narrow_specialty", label: "Focus on a narrower specialty" },
  { id: "explore_direction", label: "Explore a new direction" },
  { id: "improve_delivery", label: "Improve delivery" },
  { id: "other", label: "Another direction" },
  { id: "unknown", label: "Not sure yet" },
];
const OPPORTUNITY_OPTIONS: ChoiceGroupOption[] = [
  { id: "comparable_enquiries", label: "Comparable enquiries we have received" },
  { id: "retained_matters", label: "Comparable matters we have retained" },
  { id: "professional_referrals", label: "Professional referrals" },
  { id: "repeat_clients", label: "Repeat clients or related work" },
  { id: "website_search", label: "Enquiries from our website or search" },
  { id: "other_source", label: "Another source" },
  { id: "no_evidence", label: "No evidence yet" },
  { id: "unknown", label: "Not sure" },
];
const SUCCESS_OPTIONS: ChoiceGroupOption[] = [
  { id: "retained_matters", label: "More of these matters retained" },
  { id: "contribution_effort", label: "Better contribution for the effort involved" },
  { id: "predictable_delivery", label: "More predictable delivery" },
  { id: "practice_mix_reputation", label: "A practice mix or reputation the firm wants" },
  { id: "other", label: "Another firm-approved outcome" },
  { id: "unknown", label: "Not sure yet" },
];

export function GuidedQuestionStage({stage,answers,onEdit,onBack,onNext,onCompare,error,notice,preview}:{
  stage:StageId; answers:DesiredClientAnswers; onEdit:Change; onBack:()=>void; onNext:()=>void;
  onCompare:()=>void; error:boolean; notice?:string; preview?:ReactNode;
}) {
  const area=answers.focus.area;
  const route=answers.focus.route;
  const text=(label:string,value:string,set:(a:DesiredClientAnswers,v:string)=>void,help:string,max=180,multiline=false)=>(
    <label className={"dc-text-field"+(multiline?" dc-text-field--multiline":"")} data-ui-component-content="desired-client-text-answer">
      <span data-ui-copy="supporting">{label}</span>
      {multiline?<textarea aria-label={label} value={value} maxLength={max} onChange={e=>onEdit(a=>{const next=structuredClone(a);set(next,e.currentTarget.value);return next;})}/>:<input aria-label={label} value={value} maxLength={max} onChange={e=>onEdit(a=>{const next=structuredClone(a);set(next,e.currentTarget.value);return next;})}/>}
      <span className="dc-text-field__count" data-ui-copy="supporting">{value.length} of {max} characters</span>
      <span data-ui-copy="body">{PRIVACY_FIELD_COPY}</span><span data-ui-copy="body">{help}</span>
    </label>
  );
  const radio=(id:string,legend:string,options:ChoiceGroupOption[],value:string|null,onChange:(a:DesiredClientAnswers,v:string)=>void,help?:string,required=true)=>(
    <div className="dc-question-block" data-ui-component-content="desired-client-question">
      <ChoiceGroup idPrefix={id} name={id} legend={legend} options={options} type="radio" value={value} required={required}
        hideLegend={legend===STAGE_DEFINITIONS[stage-1].heading} help={help}
        error={error&&required&&value===null?COMMON_COPY.requiredSingle:undefined}
        onChange={v=>onEdit(a=>{const next=structuredClone(a);onChange(next,String(v));return next;})}/>
    </div>
  );
  const multi=(id:string,legend:string,options:ChoiceGroupOption[],value:string[],onChange:(a:DesiredClientAnswers,v:string[])=>void,maximum:number,exclusive:string[]=[],help?:string,required=true)=>(
    <div className="dc-question-block" data-ui-component-content="desired-client-question">
      <ChoiceGroup idPrefix={id} name={id} legend={legend} options={options} type="checkbox" value={value} maximum={maximum}
        exclusiveOptions={exclusive} required={required} hideLegend={legend===STAGE_DEFINITIONS[stage-1].heading} help={help}
        error={error&&required&&value.length===0?COMMON_COPY.requiredMulti:undefined}
        onChange={v=>onEdit(a=>{const next=structuredClone(a);onChange(next,v as string[]);return next;})}/>
    </div>
  );
  const areaOptions=AREA_ORDER.map(id=>({id,label:getAreaLabel(id)}));
  const currentWorkOptions=area?getWorkOptions(area):[];
  const triggerOptions=area?[...TRIGGER_OPTIONS[area],{id:"unknown",label:"Not sure yet"}]:[];
  const clearWriteIn=(a:DesiredClientAnswers,key:WriteInKey)=>{if(a.write_ins) a.write_ins[key]="";};

  return <section className="dc-stage" data-ui-component-content={"desired-client-stage-"+stage}>
    <div className="dc-stage__intro" data-ui-component-content={"desired-client-stage-intro-"+stage}>
      <h1 tabIndex={-1} data-ui-copy="heading">{STAGE_DEFINITIONS[stage-1].heading}</h1>
      <p data-ui-copy="body">{STAGE_DEFINITIONS[stage-1].explanation}</p>
    </div>
    {notice&&<p className="dc-alert" role="status" data-ui-copy="supporting">{notice}</p>}
    <div className="dc-stage__layout"><div className="dc-stage__questions">
      {stage===1&&<>
        {radio("dc-practice-direction","What do you want this profile to help your firm do?",PRACTICE_DIRECTION_OPTIONS,answers.practice.direction,(a,v)=>{
          a.practice.direction=v as typeof a.practice.direction;
          if(v==="other"&&!a.write_ins?.aim) a.write_ins={...a.write_ins,aim:""};
        },"Choose the direction that best fits now. “Not sure yet” is a valid starting point.")}
        {answers.practice.direction==="other"&&text("Describe the direction in a few words",answers.write_ins?.aim??"",(a,v)=>{a.write_ins={...a.write_ins,aim:v};}, "Describe the practice direction, not an individual client.",180)}
        {error&&answers.practice.direction==="other"&&!answers.write_ins?.aim?.trim()&&<p className="dc-option__error" role="alert">Describe the direction to continue.</p>}
        <section className="dc-optional"><h2>Practice context (optional)</h2>
          {text("Firm or practice type",answers.practice.firm_type,(a,v)=>{a.practice.firm_type=v;},"For example, a small employment practice or regional business firm.")}
          {text("Relevant firm strengths",answers.practice.capability,(a,v)=>{a.practice.capability=v;},"Name experience, skills or support the team can bring.")}
          {text("What work does the team enjoy?",answers.practice.enjoys,(a,v)=>{a.practice.enjoys=v;},"Describe the kind of work the team would welcome again.")}
          {radio("dc-less","Is there work the firm wants to promote less?",[{id:"within",label:"Other work within this practice area"},{id:"outside",label:"Work outside this practice"},{id:"model",label:"Work needing a delivery model we do not offer"},{id:"none",label:"Nothing identified yet"}],answers.direction.less,(a,v)=>{a.direction.less=v as typeof a.direction.less;if(v==="none")a.direction.less_note="";},undefined,false)}
          {answers.direction.less&&answers.direction.less!=="none"&&text("Name the work to promote less",answers.direction.less_note,(a,v)=>{a.direction.less_note=v;},"Use a general description.")}
        </section>
      </>}
      {stage===2&&<>
        <label className="dc-text-field" data-ui-component-content="desired-client-practice-area-control">
          <span data-ui-copy="supporting">Practice area for the work list</span>
          <select aria-label="Practice area for the work list" value={area??""} onChange={event=>onEdit(current=>({...current,focus:{...current.focus,area:event.currentTarget.value as AreaId,work:null,work_other:""}}))}>
            <option value="">Choose an area</option>{areaOptions.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <span data-ui-copy="body">Choose “Another practice area” if the listed areas do not fit.</span>
        </label>
        {area&&radio("dc-work","Which type of legal work should we focus on?",[...currentWorkOptions,{id:"not_sure",label:"Not sure yet"}],answers.focus.work==="other"&&answers.focus.work_other==="Not sure yet"?"not_sure":answers.focus.work,(a,v)=>{
          if(v==="not_sure"){a.focus.work="other";a.focus.work_other="Not sure yet";}else {a.focus.work=v as typeof a.focus.work;a.focus.work_other=v==="other"?a.focus.work_other:"";}
          clearWriteIn(a,"trigger");
        },"Pick one type of matter for this profile. You can create another profile for a different type of work.")}
        {answers.focus.work==="other"&&answers.focus.work_other!=="Not sure yet"&&text("Describe the work in a few words",answers.focus.work_other,(a,v)=>{a.focus.work_other=v;},"Use a pattern of work, not a client name.")}
        {error&&answers.focus.work==="other"&&!answers.focus.work_other.trim()&&<p className="dc-option__error" role="alert">Describe the type of work, or choose “Not sure yet.”</p>}
        {area&&<button type="button" className="dc-button dc-button--secondary" onClick={onCompare}>Deciding between two types of work? Compare them</button>}
        {area&&radio("dc-role","Who is the client in this situation?",getRoleOptions(area),answers.situation.role,(a,v)=>{
          a.situation.role=v as typeof a.situation.role;a.situation.role_other=v==="other"?a.situation.role_other:"";
        },"Think about the person or organization receiving legal help.")}
        {answers.situation.role==="other"&&text("Describe the client role",answers.situation.role_other,(a,v)=>{a.situation.role_other=v;},"Use a broad role description; avoid personal details.")}
        {error&&answers.situation.role==="other"&&!answers.situation.role_other.trim()&&<p className="dc-option__error" role="alert">Describe the client role to continue.</p>}
        {area&&radio("dc-trigger","What event or situation creates the need for legal help?",triggerOptions,answers.situation.trigger,(a,v)=>{a.situation.trigger=v as typeof a.situation.trigger;clearWriteIn(a,"trigger");},"Choose what usually prompts a client to seek help.")}
        {text("Another situation (optional)",answers.write_ins?.trigger??"",(a,v)=>{a.write_ins={...a.write_ins,trigger:v};if(v.trim())a.situation.trigger=null;},"Use this if none of the choices describe the event that creates the need.",180)}
        {area&&<p className="dc-question-example" data-ui-copy="supporting"><strong>Example, not a suggested answer:</strong> {TRIGGER_EXAMPLES[area]}</p>}
        {radio("dc-timing","At what stage does the client usually contact a lawyer?",entries(TIMING_LABELS),answers.situation.timing,(a,v)=>{a.situation.timing=v as typeof a.situation.timing;clearWriteIn(a,"timing");},"For example, before a decision, once a problem appears, or close to a deadline.")}
        <section className="dc-optional"><h2>Client and service context (optional)</h2>
          {text("Where should the firm be able to serve this client?",answers.client_context.geography,(a,v)=>{a.client_context.geography=v;},"Add relevant cities, regions, provinces or jurisdictions.")}
          {text("What financial or business circumstances are relevant?",answers.client_context.relevant_circumstances,(a,v)=>{a.client_context.relevant_circumstances=v;},"Include only circumstances that matter for this service. Do not guess at income, assets or business size.")}
          {text("Is there a community the firm specifically serves?",answers.client_context.community_focus,(a,v)=>{a.client_context.community_focus=v;},"Describe a genuine service or community focus. Do not infer an individual client's needs from background.")}
          {text("Are language or culturally informed service needs relevant?",answers.client_context.language_service_needs,(a,v)=>{a.client_context.language_service_needs=v;},"Name languages or service practices the firm can actually support.")}
          {text("Describe a matter pattern you would welcome again",answers.client_context.repeat_matter_pattern,(a,v)=>{a.client_context.repeat_matter_pattern=v;},"Describe the type of situation, not an individual matter or client.",600,true)}
          {radio("dc-goal","What outcome is the client seeking?",[{id:"understand",label:"Understand options and decide what to do"},{id:"complete",label:"Complete a planned transaction or process"},{id:"resolve",label:"Resolve a disagreement"},{id:"protect",label:"Protect something important"},{id:"prepare",label:"Prepare for a future change"},{id:"respond",label:"Meet an obligation or respond to a process"},{id:"unknown",label:"Not sure yet"}],answers.client.goals.includes("unknown")?"unknown":answers.client.goals[0]??null,(a,v)=>{a.client.goals=[v as typeof a.client.goals[number]];},"Optional. Choose the main outcome if you know it.",false)}
        </section>
      </>}
      {stage===3&&<>
        {multi("dc-reasons","Why would the firm choose this work again?",entries(REASON_LABELS).map(o=>({...o,label:getReasonLabel(o.id as keyof typeof REASON_LABELS,route)})),answers.value.reasons,(a,v)=>{
          a.value.reasons=v as typeof a.value.reasons;if(v.includes("undecided"))clearWriteIn(a,"reasons");
        },3,["undecided"],"Choose up to three. An unknown reason is a useful finding, too.",!answers.write_ins?.reasons?.trim())}
        {text("Another reason (optional)",answers.write_ins?.reasons??"",(a,v)=>{a.write_ins={...a.write_ins,reasons:v};if(v.trim())a.value.reasons=a.value.reasons.filter(reason=>reason!=="undecided");}, "Add a reason not listed above.",180)}
        {radio("dc-fee-effort","How does the fee compare with the effort?",entries({worthwhile:getFeeEffortLabel("worthwhile",route),scoped:getFeeEffortLabel("scoped",route),difficult:getFeeEffortLabel("difficult",route),unknown:getFeeEffortLabel("unknown",route)}),answers.value.fee_effort,(a,v)=>{a.value.fee_effort=v as typeof a.value.fee_effort;},"Consider total team effort and what the firm keeps. A larger fee alone does not establish better value.",false)}
        <section className="dc-optional"><h2>Economic detail (optional)</h2>
          {radio("dc-fee-range","Typical collected fee or range",entries(COLLECTED_FEE_LABELS),answers.value.collected_fee,(a,v)=>{a.value.collected_fee=v as typeof a.value.collected_fee;},"Use the firm's experience where available. Exclude disbursements.",false)}
          {radio("dc-hours","Total team time",entries(TEAM_HOURS_LABELS),answers.value.team_hours,(a,v)=>{a.value.team_hours=v as typeof a.value.team_hours;},"Include the people involved, not only lawyer time.",false)}
          {radio("dc-payment","How predictable is payment?",entries(PAYMENT_LABELS),answers.value.payment,(a,v)=>{a.value.payment=v as typeof a.value.payment;},undefined,false)}
          <div className="dc-field-grid">
            {text("Collected fee amount (optional)",answers.value.fee_amount,(a,v)=>{a.value.fee_amount=v;},"Enter a typical amount or describe a range.",80)}
            {text("Direct delivery cost (optional)",answers.value.direct_cost_amount,(a,v)=>{a.value.direct_cost_amount=v;},"Include direct delivery costs only if known.",80)}
            {text("Currency",answers.value.currency,(a,v)=>{a.value.currency=v;},"For example, CAD or USD.",12)}
          </div>
          {radio("dc-amount-basis","How certain are those amounts?",[{id:"recorded",label:"Recorded in firm records"},{id:"estimated",label:"Estimated"},{id:"unknown",label:"Not known"}],answers.value.amount_basis,(a,v)=>{a.value.amount_basis=v as typeof a.value.amount_basis;},undefined,false)}
          {radio("dc-amount-scope","What do the amounts describe?",[{id:"per_matter",label:"Per matter"},{id:"range",label:"A range across matters"},{id:"other",label:"Another basis"}],answers.value.amount_scope,(a,v)=>{a.value.amount_scope=v as typeof a.value.amount_scope;},undefined,false)}
        </section>
      </>}
      {stage===4&&<>
        {multi("dc-fit-signals","Which early signs would make this matter worth a closer look?",FIT_SIGNAL_OPTIONS,answers.delivery.fit_signals,(a,v)=>{a.delivery.fit_signals=v as typeof a.delivery.fit_signals;clearWriteIn(a,"fit_signals");},3,["unknown"],"Choose up to three observable facts to establish. If you do not know yet, choose “Not sure yet.”",!answers.write_ins?.fit_signals?.trim())}
        {text("Another fit signal (optional)",answers.write_ins?.fit_signals??"",(a,v)=>{a.write_ins={...a.write_ins,fit_signals:v};if(v.trim())a.delivery.fit_signals=a.delivery.fit_signals.filter(signal=>signal!=="unknown");},"Describe an observable fact to ask about. Do not use this as an automatic rejection rule.",180)}
        <section className="dc-optional"><h2>Delivery conditions and limits (optional)</h2>
          {multi("dc-conditions","What helps the team deliver this work well?",entries(CONDITION_LABELS),answers.delivery.conditions,(a,v)=>{a.delivery.conditions=v as typeof a.delivery.conditions;},3,["unknown"],"These are service conditions, not client worthiness criteria.",false)}
          {radio("dc-limit","What can make this work difficult to support?",entries(LIMIT_LABELS),answers.delivery.limit,(a,v)=>{a.delivery.limit=v as typeof a.delivery.limit;},undefined,false)}
        </section>
        <p data-ui-copy="supporting">These signals help a lawyer ask useful follow-up questions. They do not score or accept a matter automatically.</p>
      </>}
      {stage===5&&<>
        {multi("dc-opportunity","What evidence has the firm seen for this type of work?",OPPORTUNITY_OPTIONS,answers.opportunity.sources,(a,v)=>{a.opportunity.sources=v as OpportunitySourceId[];},6,["no_evidence","unknown"],"Select any sources the firm has actually seen. “No evidence yet” and “Not sure” each count as an answer.")}
        <section className="dc-optional"><h2>What do you know about those results? (optional)</h2>
          {text("Source or example",answers.opportunity.source_detail,(a,v)=>{a.opportunity.source_detail=v;},"For example, a referral relationship or a period of website enquiries.")}
          {text("Period observed",answers.opportunity.period,(a,v)=>{a.opportunity.period=v;},"Add dates or a general period.",80)}
          {text("Comparable enquiries received",answers.opportunity.enquiry_count,(a,v)=>{a.opportunity.enquiry_count=v;},"Use an approximate count if records are incomplete.",80)}
          {text("Comparable matters retained",answers.opportunity.retained_count,(a,v)=>{a.opportunity.retained_count=v;},"Keep this separate from enquiries.",80)}
          {text("Known conversion rate",answers.opportunity.conversion,(a,v)=>{a.opportunity.conversion=v;},"Optional. State the period and whether recorded or estimated.",80)}
          {text("Known acquisition cost",answers.opportunity.acquisition_cost,(a,v)=>{a.opportunity.acquisition_cost=v;},"Optional. Include the currency and whether recorded or estimated.",80)}
          {radio("dc-opportunity-basis","How certain are any figures above?",[{id:"recorded",label:"Recorded in firm records"},{id:"estimated",label:"Estimated"},{id:"unknown",label:"Not known"}],answers.opportunity.data_basis,(a,v)=>{a.opportunity.data_basis=v as typeof a.opportunity.data_basis;},"This basis applies to the enquiry, retained-matter, conversion and acquisition-cost figures.",false)}
          {text("What remains uncertain about demand or reach?",answers.opportunity.uncertainty,(a,v)=>{a.opportunity.uncertainty=v;},"A proposed channel is a hypothesis, not evidence of demand.")}
        </section>
      </>}
      {stage===6&&<>
        {radio("dc-capacity","Could the firm take on more of this work now?",entries(CAPACITY_LABELS),answers.delivery.capacity,(a,v)=>{a.delivery.capacity=v as typeof a.delivery.capacity;},"Consider the team's current workload and support.",true)}
        {radio("dc-success","Which result would show that more of this work is worthwhile?",SUCCESS_OPTIONS,answers.repeatability.success_measure,(a,v)=>{a.repeatability.success_measure=v as SuccessMeasureId;if(v!=="other")a.repeatability.success_other="";},"Choose the outcome the firm wants to review. “Not sure yet” is allowed.",true)}
        {answers.repeatability.success_measure==="other"&&text("Name the firm-approved outcome",answers.repeatability.success_other,(a,v)=>{a.repeatability.success_other=v;},"Keep it observable and within firm control.")}
        {error&&answers.repeatability.success_measure==="other"&&!answers.repeatability.success_other.trim()&&<p className="dc-option__error" role="alert">Name the outcome to continue.</p>}
        <section className="dc-optional"><h2>How will you review progress? (optional)</h2>
          {text("Target or threshold",answers.repeatability.target,(a,v)=>{a.repeatability.target=v;},"A desired target, not a result already achieved.")}
          {text("Review period",answers.repeatability.review_period,(a,v)=>{a.repeatability.review_period=v;},"For example, review after six months or a set number of matters.",80)}
          {text("Additional matters the team could support",answers.repeatability.additional_matters,(a,v)=>{a.repeatability.additional_matters=v;},"A rough monthly capacity is fine; leave blank if unknown.",80)}
          {text("Staffing or process change needed",answers.repeatability.staffing_constraint,(a,v)=>{a.repeatability.staffing_constraint=v;},"Describe what would need to change before growing this work.")}
        </section>
      </>}
    </div>{preview&&<div className="dc-stage__preview">{preview}</div>}</div>
    <div className="dc-actions"><button type="button" className="dc-button dc-button--secondary" onClick={onBack}>Back</button><button type="button" className="dc-button dc-button--primary" onClick={onNext}>Continue</button></div>
  </section>;
}
