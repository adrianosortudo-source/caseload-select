"use client";
import { useState } from "react";
import { CLARIFICATION_BANK } from "@/lib/desired-client/clarifications";
import type { ClarificationCode } from "@/lib/desired-client/types";

export function ClarificationStep({code,onAnswer}:{code:ClarificationCode;onAnswer:(answer:string)=>void}) {
  const item=CLARIFICATION_BANK[code];
  const [freeText,setFreeText]=useState("");
  const options=item.options.filter(option=>option.id!=="open"&&option.id!=="skip");
  return <section className="dc-clarification" data-ui-component-content="desired-client-clarification">
    <p className="dc-eyebrow" data-ui-copy="supporting">One follow-up to make the profile more useful</p>
    <p data-ui-copy="supporting">{item.reason}</p>
    <h1 id="dc-clarification-question" data-ui-copy="heading">{item.question}</h1>
    <div className="dc-clarification__options" role="group" aria-labelledby="dc-clarification-question" data-ui-component-content="clarification-options">
      {options.map(option=><button key={option.id} type="button" className="dc-button dc-button--secondary" onClick={()=>onAnswer(option.id)}>{option.label}</button>)}
    </div>
    <form className="dc-clarification__write-in" onSubmit={event=>{event.preventDefault();if(freeText.trim())onAnswer(freeText);}}>
      <label className="dc-text-field" data-ui-component-content="clarification-free-text">
        <span data-ui-copy="supporting">Or answer in your own words (optional)</span>
        <textarea aria-label="Answer this follow-up in your own words" value={freeText} maxLength={220} onChange={event=>setFreeText(event.currentTarget.value)}/>
        <span className="dc-text-field__count" data-ui-copy="supporting">{freeText.length} of 220 characters</span>
        <span data-ui-copy="supporting">Keep it general. Do not include client names or confidential details.</span>
      </label>
      <button type="submit" className="dc-button dc-button--primary" disabled={!freeText.trim()}>Use my answer</button>
    </form>
    <button type="button" className="dc-button dc-button--secondary" onClick={()=>onAnswer("open")}>Create with this marked uncertain</button>
  </section>;
}
