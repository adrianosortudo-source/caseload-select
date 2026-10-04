"use client";

import type { ReactNode } from "react";
import {
  AREA_ORDER, CAPACITY_LABELS, COLLECTED_FEE_LABELS, CONDITION_LABELS, CONTACT_LABELS, FIT_SIGNAL_OPTIONS,
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
const CLIENT_CHOICE_OPTIONS: ChoiceGroupOption[] = [
  { id: "relevant_experience", label: "Experience with this kind of matter" },
  { id: "clear_options", label: "Clear options and practical advice" },
  { id: "clear_fees", label: "Clear scope and fees" },
  { id: "communication", label: "Responsive, understandable communication" },
  { id: "availability", label: "Availability at the stage they need help" },
  { id: "approach", label: "An approach that fits their situation" },
  { id: "language", label: "Service in a language they prefer" },
  { id: "community", label: "A firm that understands their community" },
  { id: "other", label: "Another reason" },
  { id: "unknown", label: "Not sure yet" },
];
const FIRM_STRENGTH_OPTIONS: ChoiceGroupOption[] = [
  { id: "matter_experience", label: "Relevant experience with this matter" },
  { id: "specialist_knowledge", label: "Specific knowledge the matter calls for" },
  { id: "clear_advice", label: "Clear explanation of options and consequences" },
  { id: "practical_approach", label: "A practical approach to the client's goal" },
  { id: "responsive_service", label: "A service approach that fits the client's needs" },
  { id: "language_or_community", label: "Language or community-informed service" },
  { id: "other", label: "Another strength" },
  { id: "unknown", label: "Not established yet" },
];
const MULTI_CHOICE_WRITE_INS: Partial<Record<string, WriteInKey>> = {
  "dc-decision-needs": "decision_needs",
  "dc-reasons": "reasons",
  "dc-fit-signals": "fit_signals",
};

export function GuidedQuestionStage({stage,answers,onEdit,onBack,onNext,onCompare,error,notice,aiAvailable,preview}:{
  stage:StageId; answers:DesiredClientAnswers; onEdit:Change; onBack:()=>void; onNext:()=>void;
  onCompare:()=>void; error:boolean; notice?:string; aiAvailable?:boolean|null; preview?:ReactNode;
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
  const multi=(id:string,legend:string,options:ChoiceGroupOption[],value:string[],onChange:(a:DesiredClientAnswers,v:string[])=>void,maximum:number,exclusive:string[]=[],help?:string,required=true)=>{
    const writeInKey=MULTI_CHOICE_WRITE_INS[id];
    const additionalSelectionCount=writeInKey&&answers.write_ins?.[writeInKey]?.trim()?1:0;
    const exceedsMaximum=value.length+additionalSelectionCount>maximum;
    return <div className="dc-question-block" data-ui-component-content="desired-client-question">
      <ChoiceGroup idPrefix={id} name={id} legend={legend} options={options} type="checkbox" value={value} maximum={maximum}
        additionalSelectionCount={additionalSelectionCount} exclusiveOptions={exclusive} required={required}
        hideLegend={legend===STAGE_DEFINITIONS[stage-1].heading} help={help}
        error={error&&required&&value.length===0?COMMON_COPY.requiredMulti:undefined}
        onChange={v=>onEdit(a=>{const next=structuredClone(a);onChange(next,v as string[]);return next;})}/>
      {exceedsMaximum&&<p className="dc-option__error" role="alert" data-ui-copy="supporting">
        Your written answer counts as one of {maximum} choices. Keep {maximum-1} or fewer listed choices, or clear your written answer to continue.
      </p>}
    </div>;
  };
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
    <div className="dc-stage__layout"><div className="dc-stage__questions" data-ui-component-content={`desired-client-stage-questions-${stage}`}>
      {stage===1&&<>
        {radio("dc-practice-direction","What do you want this profile to help your firm do?",PRACTICE_DIRECTION_OPTIONS,answers.practice.direction,(a,v)=>{
          a.practice.direction=v as typeof a.practice.direction;
          if(v==="other"&&!a.write_ins?.aim) a.write_ins={...a.write_ins,aim:""};
        },"Choose the direction that best fits now. “Not sure yet” is a valid starting point.")}
        {answers.practice.direction==="other"&&text("Describe the direction in a few words",answers.write_ins?.aim??"",(a,v)=>{a.write_ins={...a.write_ins,aim:v};}, "Describe the practice direction, not an individual client.",180)}
        {error&&answers.practice.direction==="other"&&!answers.write_ins?.aim?.trim()&&<p className="dc-option__error" role="alert">Describe the direction to continue.</p>}
        <section className="dc-optional"><h2>Practice context (optional)</h2>
          {text("Describe your current practice",answers.practice.firm_type,(a,v)=>{a.practice.firm_type=v;},"Name the client groups you actually serve and the work you handle. Add your location only if it affects the work or clients you can serve. A broad label alone is not a specialization: for example, “business law for companies” does not say which companies, situations or matters are a focus.")}
          {text("What work does the team enjoy?",answers.practice.enjoys,(a,v)=>{a.practice.enjoys=v;},"Describe the kind of work the team would welcome again.")}
          {radio("dc-less","Is there work the firm wants to market less?",[{id:"within",label:"Other work within this practice area"},{id:"outside",label:"Work outside this practice"},{id:"model",label:"Work needing a delivery model we do not offer"},{id:"none",label:"Nothing identified yet"}],answers.direction.less,(a,v)=>{a.direction.less=v as typeof a.direction.less;if(v==="none"){a.direction.less_note="";a.direction.less_reason=null;}},undefined,false)}
          {answers.direction.less&&answers.direction.less!=="none"&&<>
            {text("Name the work to market less",answers.direction.less_note,(a,v)=>{a.direction.less_note=v;},"Use a general description.")}
            {radio("dc-less-reason","Why should it receive less marketing attention?",[{id:"preference",label:"The firm prefers other work"},{id:"capacity",label:"Capacity is limited"},{id:"effort",label:"The effort is hard to support"},{id:"financial",label:"The financial return does not justify the effort"},{id:"model",label:"It does not fit the firm's service model"},{id:"unknown",label:"Not sure yet"}],answers.direction.less_reason,(a,v)=>{a.direction.less_reason=v as typeof a.direction.less_reason;},undefined,false)}
          </>}
        </section>
        <section className="dc-optional" data-ui-component-content="desired-client-ai-follow-up"><h2>AI follow-up (optional)</h2>{aiAvailable===false?<p className="dc-alert" role="status" data-ui-copy="supporting">AI follow-up questions are unavailable right now. Your answers remain in this browser, and you can continue without them.</p>:<><label className="dc-option"><input className="dc-option__input" type="checkbox" checked={answers.interview.ai_clarification_consent} onChange={event=>onEdit(a=>({...a,interview:{...a.interview,ai_clarification_consent:event.currentTarget.checked}}))}/><span className="dc-option__label" data-ui-copy="body">Allow up to three short AI follow-up questions during this interview. Your original answers stay intact, and you can skip any follow-up.</span></label><p data-ui-copy="supporting">AI follow-ups are optional. Skip them to keep going.</p></>}</section>
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
        {radio("dc-practice-experience","How much experience does the firm have with this type of work?",[{id:"regular",label:"We handle this work regularly"},{id:"occasional",label:"We have handled it occasionally"},{id:"adjacent",label:"We handle related work"},{id:"new",label:"This would be new work for the firm"},{id:"unknown",label:"Not sure yet"}],answers.practice.experience,(a,v)=>{
          a.practice.experience=v as typeof a.practice.experience;
          a.focus.route=v==="regular"||v==="occasional"?"established":v==="adjacent"||v==="unknown"?"exploring":"new";
          if(v!=="adjacent"&&v!=="new")a.practice.development_needs=[];
        },"Choose the firm's experience with the work selected above.")}
        {(answers.practice.experience==="regular"||answers.practice.experience==="occasional"||answers.practice.experience==="adjacent")&&text(answers.practice.experience==="adjacent"?"Which related work or transferable skills support this direction?":"Which experience supports this direction?",answers.practice.capability,(a,v)=>{a.practice.capability=v;},answers.practice.experience==="adjacent"?"Name adjacent matters or skills that may transfer to the selected work.":"Name relevant matters or skills that support the selected work.",180,true)}
        {(answers.practice.experience==="adjacent"||answers.practice.experience==="new")&&multi("dc-development-needs","What would help the firm build or support this work?",[{id:"expertise",label:"Develop expertise"},{id:"support",label:"Add specialist or team support"},{id:"process",label:"Build a process"},{id:"capacity",label:"Create capacity"},{id:"unknown",label:"Not sure yet"}],answers.practice.development_needs,(a,v)=>{a.practice.development_needs=v as typeof a.practice.development_needs;},2,["unknown"],"Optional. Choose up to two. Select Not sure if development needs are not clear yet.",false)}
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
        {radio("dc-contact","Who usually makes the first contact?",entries(CONTACT_LABELS),answers.situation.contact,(a,v)=>{a.situation.contact=v as typeof a.situation.contact;},"Optional client-pathway detail. Roles only, not names.",false)}
        <section className="dc-stage__group"><h2>Specific matter and client context</h2>
          {text("Where should the firm be able to serve this client?",answers.client_context.geography,(a,v)=>{a.client_context.geography=v;},"Add relevant cities, regions, provinces or jurisdictions.")}
          {text("What client or matter circumstances would help distinguish a good-fit enquiry?",answers.client_context.relevant_circumstances,(a,v)=>{a.client_context.relevant_circumstances=v;},"Include circumstances that matter for this service. Do not assume wealth, income, assets or business size.")}
          {text("Is there a community the firm specifically serves?",answers.client_context.community_focus,(a,v)=>{a.client_context.community_focus=v;},"Describe a genuine service or community focus. Do not infer an individual client's needs from background.")}
          {text("Are language or culturally informed service needs relevant?",answers.client_context.language_service_needs,(a,v)=>{a.client_context.language_service_needs=v;},"Name languages or service practices the firm can actually support.")}
          {text("Which specific matter and legal work would the firm welcome again?",answers.client_context.repeat_matter_pattern,(a,v)=>{a.client_context.repeat_matter_pattern=v;},answers.focus.area==="business"&&answers.focus.work==="business_acquisitions"?"Required. Name the buyer or seller, transaction type, document and legal work, and when the lawyer is involved. For example: a buyer of an established operating business who needs an asset purchase agreement drafted or reviewed before final terms are agreed. Use a typical pattern, not client details. If not known yet, say so.":"Required. Name the client's situation, specific matter or document, legal work and the stage when the lawyer is involved. Use a typical pattern, not client details. If not known yet, say so.",600,true)}
          {radio("dc-goal","What progress does this client want?",[{id:"understand",label:"Understand options and decide what to do"},{id:"complete",label:"Complete a planned transaction or process"},{id:"resolve",label:"Resolve a disagreement"},{id:"protect",label:"Protect something important"},{id:"prepare",label:"Prepare for a future change"},{id:"respond",label:"Meet an obligation or respond to a process"},{id:"unknown",label:"Not sure yet"}],answers.client.goals.includes("unknown")?"unknown":answers.client.goals[0]??null,(a,v)=>{a.client.goals=[v as typeof a.client.goals[number]];},"Choose the broad goal. A follow-up may help you make it concrete.")}
          {text("What practical result can this legal work help the client achieve?",answers.client.goal_detail,(a,v)=>{a.client.goal_detail=v;},"Required unless you selected “Not sure yet” above. Describe the decision, transaction or problem the legal work helps the client move forward. Keep it general and confidential details out.",240,true)}
          {text("Who is involved in deciding or paying for the legal help? (optional)",answers.client.decision_context,(a,v)=>{a.client.decision_context=v;},"Describe roles only, such as an owner deciding with a co-owner or adviser. Do not assume a single decision maker.",240)}
          <section className="dc-optional"><h3>What matters to the client when choosing a lawyer? (optional)</h3>{multi("dc-decision-needs","Which needs or concerns have you heard or would expect them to raise?",[{id:"scope_cost",label:"Scope and cost"},{id:"options",label:"Understanding the options"},{id:"relevant_experience",label:"Relevant experience"},{id:"process",label:"What happens next"},{id:"response",label:"A timely response"},{id:"heard",label:"Being heard and understood"},{id:"unknown",label:"Not sure yet"}],answers.client.decision_needs,(a,v)=>{a.client.decision_needs=v as typeof a.client.decision_needs;if(v.includes("unknown"))clearWriteIn(a,"decision_needs");},2,["unknown"],"Choose what is known or reasonably expected; the report will keep observation separate from hypothesis.",false)}</section>
          {radio("dc-pathway-basis","What is the basis for your view of this client pathway?",[{id:"client_feedback",label:"Clients have told us"},{id:"firm_observation",label:"We have observed this"},{id:"firm_hypothesis",label:"This is our current hypothesis"},{id:"unknown",label:"Not established"}],answers.client.pathway_basis,(a,v)=>{a.client.pathway_basis=v as typeof a.client.pathway_basis;},"This applies to your description of how the client reaches a decision. Leave it open if the basis varies.",false)}
        </section>
      </>}
      {stage===3&&<>
        {multi("dc-reasons","Why would the firm choose this work again?",entries(REASON_LABELS).map(o=>({...o,label:getReasonLabel(o.id as keyof typeof REASON_LABELS,route)})),answers.value.reasons,(a,v)=>{
          a.value.reasons=v as typeof a.value.reasons;if(v.includes("undecided"))clearWriteIn(a,"reasons");
        },3,["undecided"],"Choose up to three. An unknown reason is a useful finding, too.",!answers.write_ins?.reasons?.trim())}
        {text("Another reason (optional)",answers.write_ins?.reasons??"",(a,v)=>{a.write_ins={...a.write_ins,reasons:v};if(v.trim())a.value.reasons=a.value.reasons.filter(reason=>reason!=="undecided");}, "Add a reason not listed above.",180)}
        {radio("dc-fee-effort","How does the fee compare with the effort?",entries({worthwhile:getFeeEffortLabel("worthwhile",route),scoped:getFeeEffortLabel("scoped",route),difficult:getFeeEffortLabel("difficult",route),unknown:getFeeEffortLabel("unknown",route)}),answers.value.fee_effort,(a,v)=>{a.value.fee_effort=v as typeof a.value.fee_effort;},"Consider total team effort and what the firm keeps. A larger fee alone does not establish better value.")}
        <section className="dc-optional"><h2>Economic detail (optional)</h2>
          {radio("dc-fee-range","Typical collected fee or range",entries(COLLECTED_FEE_LABELS),answers.value.collected_fee,(a,v)=>{a.value.collected_fee=v as typeof a.value.collected_fee;},"Use the firm's experience where available. Exclude disbursements.",false)}
          {radio("dc-hours","Total team time",entries(TEAM_HOURS_LABELS),answers.value.team_hours,(a,v)=>{a.value.team_hours=v as typeof a.value.team_hours;},"Include the people involved, not only lawyer time.",false)}
          {radio("dc-payment","How predictable is payment?",entries(PAYMENT_LABELS),answers.value.payment,(a,v)=>{a.value.payment=v as typeof a.value.payment;},undefined,false)}
          <div className="dc-field-grid">
            {text("Collected fee amount (optional)",answers.value.fee_amount,(a,v)=>{a.value.fee_amount=v;},"For a calculation, enter one amount collected for the same matter or typical matter as the cost below. Ranges can be recorded but are not calculated.",80)}
            {text("Direct delivery cost (optional)",answers.value.direct_cost_amount,(a,v)=>{a.value.direct_cost_amount=v;},"Use the same matter, currency and recorded or estimated basis as the fee. Exclude overhead and acquisition costs. Do not deduct write-offs again from a fee already reported as collected.",80)}
            {text("Currency for both amounts",answers.value.currency,(a,v)=>{a.value.currency=v;},"Use one three-letter currency code, such as CAD or USD. Leave blank if the amounts use different currencies.",12)}
          </div>
          {radio("dc-amount-basis","What is the shared basis for both amounts?",[{id:"recorded",label:"Both recorded in firm records"},{id:"estimated",label:"Both estimates"},{id:"unknown",label:"Different bases or not known"}],answers.value.amount_basis,(a,v)=>{a.value.amount_basis=v as typeof a.value.amount_basis;},undefined,false)}
          {radio("dc-amount-scope","Do both amounts describe the same scope?",[{id:"per_matter",label:"The same matter or comparable typical matter"},{id:"range",label:"A range across matters"},{id:"other",label:"Different scopes or another basis"}],answers.value.amount_scope,(a,v)=>{a.value.amount_scope=v as typeof a.value.amount_scope;},undefined,false)}
          {radio("dc-capacity","Could the firm support more of this work now?",entries(CAPACITY_LABELS),answers.delivery.capacity,(a,v)=>{a.delivery.capacity=v as typeof a.delivery.capacity;},"Optional. Consider the team's current workload and support.",false)}
        </section>
      </>}
      {stage===4&&<>
        {multi("dc-client-choice","What is most likely to matter to this client when choosing a firm?",CLIENT_CHOICE_OPTIONS,answers.client.choice_priorities,(a,v)=>{a.client.choice_priorities=v as typeof a.client.choice_priorities; if(!v.includes("other"))a.client.choice_detail="";},2,["unknown"],"Select up to two. Use what clients have told you; choose Not sure if the reasons are not established.")}
        {answers.client.choice_priorities.includes("other")&&text("What else may matter?",answers.client.choice_detail,(a,v)=>{a.client.choice_detail=v;},"Describe a client priority, not a marketing claim.",180)}
        {radio("dc-choice-basis","What is the basis for your view of these choice factors?",[{id:"client_feedback",label:"Clients have told us"},{id:"firm_observation",label:"We have observed this"},{id:"firm_hypothesis",label:"This is our current hypothesis"},{id:"unknown",label:"Not established"}],answers.client.choice_basis,(a,v)=>{a.client.choice_basis=v as typeof a.client.choice_basis;},"This keeps client feedback, firm observation and assumptions distinct.",false)}
        {radio("dc-firm-strength","Which strength can your firm bring to this matter?",FIRM_STRENGTH_OPTIONS,answers.practice.client_strength,(a,v)=>{a.practice.client_strength=v as typeof a.practice.client_strength;if(v==="unknown"){a.practice.client_strength_effect="";a.practice.client_strength_support="";}},"Choose a relevant strength, not a claim that your firm is better than others.")}
        {answers.practice.client_strength&&answers.practice.client_strength!=="unknown"&&<>
          {text("How would this strength help with this client's situation?",answers.practice.client_strength_effect,(a,v)=>{a.practice.client_strength_effect=v;},"Explain the practical effect in this matter. Avoid promising a legal result.",240,true)}
          {text("What experience or evidence supports this strength? (optional)",answers.practice.client_strength_support,(a,v)=>{a.practice.client_strength_support=v;},"For example, relevant work handled, a process, training or client feedback. Distinguish experience from a formal credential.",240,true)}
        </>}
      </>}
      {stage===5&&<>
        {multi("dc-fit-signals","Which early signs would make this matter worth a closer look?",FIT_SIGNAL_OPTIONS,answers.delivery.fit_signals,(a,v)=>{a.delivery.fit_signals=v as typeof a.delivery.fit_signals;if(v.includes("unknown"))clearWriteIn(a,"fit_signals");},3,["unknown"],"Choose up to three observable facts to establish. If you do not know yet, choose “Not sure yet.”",!answers.write_ins?.fit_signals?.trim())}
        {text("Another fit signal (optional)",answers.write_ins?.fit_signals??"",(a,v)=>{a.write_ins={...a.write_ins,fit_signals:v};if(v.trim())a.delivery.fit_signals=a.delivery.fit_signals.filter(signal=>signal!=="unknown");},"Describe an observable fact to ask about. Do not use this as an automatic rejection rule.",180)}
        <section className="dc-optional"><h2>Delivery conditions and limits (optional)</h2>
          {multi("dc-conditions","What helps the team deliver this work well?",entries(CONDITION_LABELS),answers.delivery.conditions,(a,v)=>{a.delivery.conditions=v as typeof a.delivery.conditions;},3,["unknown"],"These are service conditions, not client worthiness criteria.",false)}
          {radio("dc-limit","What can make this work difficult to support?",entries(LIMIT_LABELS),answers.delivery.limit,(a,v)=>{a.delivery.limit=v as typeof a.delivery.limit;},undefined,false)}
        </section>
        <p data-ui-copy="supporting">These signals help a lawyer ask useful follow-up questions. They do not score or accept a matter automatically.</p>
      </>}
      {stage===6&&<>
        {text("How do clients find or approach the firm for this work? (optional)",answers.client_context.discovery_behaviour,(a,v)=>{a.client_context.discovery_behaviour=v;},"What do they search for, who do they ask, or what information do they look for before contacting you? Separate known patterns from assumptions.",360,true)}
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
        {radio("dc-success","What would the firm want to review over time? (optional)",SUCCESS_OPTIONS,answers.repeatability.success_measure,(a,v)=>{a.repeatability.success_measure=v as SuccessMeasureId;if(v!=="other")a.repeatability.success_other="";},"An outcome can be proposed here. It remains subject to firm approval.",false)}
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
