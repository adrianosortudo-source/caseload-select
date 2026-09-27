"use client";
import { CLARIFICATION_BANK } from "@/lib/desired-client/clarifications";
import type { ClarificationCode } from "@/lib/desired-client/types";

export function ClarificationStep({ code, onAnswer }: { code: ClarificationCode; onAnswer: (id: string) => void }) {
  const item = CLARIFICATION_BANK[code];
  return <section className="dc-clarification" data-ui-component-content="desired-client-clarification">
    <p className="dc-eyebrow" data-ui-copy="supporting">{item.reason}</p>
    <h1 id="dc-clarification-question" data-ui-copy="heading">{item.question}</h1>
    <div className="dc-clarification__options" role="group" aria-labelledby="dc-clarification-question" data-ui-component-content="clarification-options">
      {item.options.map(option => <button key={option.id} type="button" className="dc-button dc-button--secondary" onClick={() => onAnswer(option.id)}>{option.label}</button>)}
    </div>
  </section>;
}