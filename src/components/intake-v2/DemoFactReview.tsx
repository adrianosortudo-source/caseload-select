"use client";

import { useState } from "react";
import { demoCapturedFacts } from "@/lib/screen-demo-confirmation";
import type { EngineState } from "@/lib/screen-engine/types";
import styles from "./ScreenDemo.module.css";

export function DemoFactReview({ state, onConfirm, onEditDescription }: {
  state: EngineState; onConfirm: (corrections: Record<string, string>) => void; onEditDescription: () => void;
}) {
  const facts = demoCapturedFacts(state);
  const [editing, setEditing] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  return <section className={styles.factReview} data-ui-component-content="demo-fact-review">
    <h2 data-ui-copy="heading">Review the facts</h2>
    <p data-ui-copy="body">Confirm these details or correct them before continuing. We will ask only for what is still missing.</p>
    <details className={styles.description}><summary>Your description</summary><p>{state.input}</p></details>
    <dl className={styles.reviewFacts}>
      {facts.map((fact) => <div key={fact.id} data-ui-component-content="demo-review-fact">
        <dt>{fact.label}</dt>
        <dd data-ui-copy="supporting">{Object.hasOwn(corrections, fact.id) ? corrections[fact.id] || "Leave unanswered" : fact.value}</dd>
        <p className={styles.factSource}>{Object.hasOwn(corrections, fact.id) ? "Correction pending confirmation" : fact.source === "inferred" ? "Interpretation to confirm" : fact.source === "confirmed" ? "Previously confirmed" : "Captured from your description"}</p>
        {editing === fact.id ? <div className={styles.correction}>
          <label htmlFor={`review-${fact.id}`}>Correct {fact.label.toLowerCase()}</label>
          <select id={`review-${fact.id}`} value={corrections[fact.id] ?? fact.value} onChange={(event) => setCorrections((current) => ({ ...current, [fact.id]: event.target.value }))}>
            {fact.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            <option value="">Leave unanswered</option>
          </select>
          <button type="button" onClick={() => setEditing(null)}>Done editing</button>
        </div> : <button type="button" className={styles.editFact} aria-label={`Edit ${fact.label.toLowerCase()}`} onClick={() => setEditing(fact.id)}>Edit</button>}
      </div>)}
    </dl>
    <button type="button" className={styles.primary} onClick={() => onConfirm(corrections)}>Confirm details and continue</button>
    <button type="button" className={styles.secondary} onClick={onEditDescription}>Edit my description</button>
  </section>;
}
