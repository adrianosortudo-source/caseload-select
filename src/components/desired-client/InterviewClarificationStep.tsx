"use client";

import { useState } from "react";
import type { InterviewClarificationPrompt } from "@/lib/desired-client/types";
import { INTERVIEW_CLARIFICATION_LIMITS } from "@/lib/desired-client/interview-clarification-contract";
import { isBoundedMultilineText } from "@/lib/desired-client/validation";

export function InterviewClarificationStep({prompt,onAnswer,onSkip}:{prompt:Extract<InterviewClarificationPrompt,{outcome:"ask"}>;onAnswer:(answer:string,choiceId?:string)=>void;onSkip:()=>void}) {
 const [selected,setSelected]=useState("");
 const [custom,setCustom]=useState("");
 const answer=custom.trim()||prompt.choices.find(choice=>choice.id===selected)?.label||"";
 const customAnswerValid=!custom.trim()||isBoundedMultilineText(custom,INTERVIEW_CLARIFICATION_LIMITS.answerCharacters);
 const hasTooManyLines=!!custom.trim()&&!customAnswerValid;
 return <section className="dc-stage dc-interview-clarification" aria-labelledby="dc-interview-followup-heading">
  <div className="dc-stage__intro"><p className="dc-eyebrow" data-ui-copy="supporting">A quick clarification</p><h1 id="dc-interview-followup-heading" tabIndex={-1} data-ui-copy="heading">{prompt.question}</h1>
   <p data-ui-copy="body">Choose the closest answer, write your own, or leave this point open. This answer is kept separate from your original responses.</p></div>
  {prompt.reflection&&<aside className="dc-alert" aria-label="Possible interpretation"><strong>One possible reading</strong><p data-ui-copy="supporting">{prompt.reflection}</p><p data-ui-copy="supporting">This is an AI interpretation, not a fact. You can disagree or skip it.</p></aside>}
  <fieldset className="dc-question"><legend className="dc-question__legend" data-ui-copy="heading">Which comes closest?</legend><div className="dc-option-list">
   {prompt.choices.map(choice=><label className="dc-option" key={choice.id}><input className="dc-option__input" type="radio" name="dc-interview-followup" value={choice.id} checked={selected===choice.id&&!custom} onChange={()=>{setSelected(choice.id);setCustom("");}}/><span className="dc-option__label" data-ui-copy="body">{choice.label}</span></label>)}
  </div></fieldset>
  <label className="dc-text-field dc-text-field--multiline"><span data-ui-copy="supporting">Or write your own answer</span><textarea maxLength={INTERVIEW_CLARIFICATION_LIMITS.answerCharacters} value={custom} onChange={event=>{setCustom(event.currentTarget.value);setSelected("");}}/><span className="dc-text-field__count" data-ui-copy="supporting">{custom.length} of {INTERVIEW_CLARIFICATION_LIMITS.answerCharacters} characters</span>{hasTooManyLines&&<span role="alert" data-ui-copy="supporting">Use {INTERVIEW_CLARIFICATION_LIMITS.answerLines} lines or fewer, or shorten the answer.</span>}</label>
  <div className="dc-actions"><button type="button" className="dc-button dc-button--secondary" onClick={onSkip}>Skip and leave this open</button><button type="button" className="dc-button dc-button--primary" disabled={!answer||!customAnswerValid} onClick={()=>onAnswer(answer,selected||undefined)}>Use this answer</button></div>
 </section>;
}
