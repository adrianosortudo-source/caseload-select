"use client";
import { useState } from "react";
import { STAGE_SUMMARY_LABELS, REVIEW_COPY, COMMON_COPY, WELCOME_COPY } from "@/lib/desired-client/copy";
import { GOAL_LABELS } from "@/lib/desired-client/catalog";
import { getSourceDetails } from "@/lib/desired-client/sources";
import type { AnswerReferencePath, DesiredClientAnswers } from "@/lib/desired-client/types";
export function ReviewStep({ answers, mode, onCreate, onUseAi, onCreateStructured, onEdit, briefNeedsUpdate, loading }: { answers: DesiredClientAnswers; mode: "ai" | "structured"; onCreate: () => void; onUseAi: () => void; onCreateStructured:()=>void; onEdit: (stage: 1|2|3|4|5|6) => void; briefNeedsUpdate:boolean; loading:boolean }) {
  const [showConsent, setShowConsent] = useState(false);
  const answer = (path: AnswerReferencePath) => getSourceDetails(path, answers).answer;
  const item = (label: string, value: string | null) => value ? { label, values: [value] } : null;
  const itemValues = (label: string, values: string[]) => values.length ? { label, values } : null;
  const values = (parts: Array<{ label: string; values: string[] } | null>) => parts.filter((part): part is { label: string; values: string[] } => Boolean(part));
  const workPath: AnswerReferencePath = answers.focus.work === "other" && answers.focus.work_other.trim() ? "focus.work_other" : "focus.work";
  const rolePath: AnswerReferencePath = answers.situation.role === "other" && answers.situation.role_other.trim() ? "situation.role_other" : "situation.role";
  const summary: Array<[string,Array<{label:string;values:string[]}>,1|2|3|4|5|6]> = [
    ["Work", values([
      item("Type of work", answer(workPath)), item("Practice direction", answer("focus.route")),
      answers.focus.service_area.trim() ? item("Service area", answers.focus.service_area.trim()) : null,
      answers.focus.certainty === "provisional" ? item("Status", "Provisional") : null,
    ]), 1],
    [STAGE_SUMMARY_LABELS[0], values([item("Role", answer(rolePath)), item("Timing", answer("situation.timing")), item("Other timing", answers.write_ins?.timing?.trim() ?? null), item("First contact", answer("situation.contact")), item("Other first contact", answers.write_ins?.contact?.trim() ?? null)]), 2],
    [STAGE_SUMMARY_LABELS[1], values([itemValues("Goals", answers.client.goals.map((goal) => GOAL_LABELS[goal])), item("Other goal", answers.write_ins?.goals?.trim() ?? null), item("Concerns", answer("client.concerns")), item("Other concern", answers.write_ins?.concerns?.trim() ?? null)]), 3],
    [STAGE_SUMMARY_LABELS[2], values([
      item("Reasons", answer("value.reasons")), item("Other reason", answers.write_ins?.reasons?.trim() ?? null), item("Fee compared with effort", answer("value.fee_effort")), item("Other fee assessment", answers.write_ins?.fee_effort?.trim() ?? null),
      item("Fee range", answer("value.collected_fee")), item("Team time", answer("value.team_hours")), item("Payment", answer("value.payment")),
    ]), 4],
    [STAGE_SUMMARY_LABELS[3], values([
      item("Delivery conditions", answer("delivery.conditions")), item("Other delivery condition", answers.write_ins?.conditions?.trim() ?? null), item("Capacity", answer("delivery.capacity")), item("Other capacity answer", answers.write_ins?.capacity?.trim() ?? null), item("Limit", answer("delivery.limit")), item("Other limit", answers.write_ins?.limit?.trim() ?? null),
    ]), 5],
    [STAGE_SUMMARY_LABELS[4], values([
      item("Aim", answer("direction.aim")), item("Other aim", answers.write_ins?.aim?.trim() ?? null), item("Evidence", answer("direction.evidence")), item("Other evidence", answers.write_ins?.evidence?.trim() ?? null),
      item("Promote less", answer("direction.less")), answers.direction.less_note.trim() ? item("Note", answers.direction.less_note.trim()) : null,
    ]), 6],
  ];
  return <section className="dc-review" data-ui-component-content="desired-client-review" aria-busy={loading}>
    <h1 data-ui-copy="heading">{REVIEW_COPY.heading}</h1><p data-ui-copy="body">{REVIEW_COPY.note}</p>
    {briefNeedsUpdate&&<p className="dc-alert" data-ui-copy="body">{COMMON_COPY.briefChanged}</p>}
    {loading&&<p role="status" data-ui-copy="supporting">Preparing your brief. You can use the structured version while you wait.</p>}
    <div className="dc-summary-list">{summary.map(([label,value,stage])=><div key={label} className="dc-summary-row" data-ui-component-content="review-summary-row"><div data-ui-component-content="review-summary-content"><h2 data-ui-copy="heading">{label}</h2><div data-ui-component-content="review-summary-value">{value.map(({label:fieldLabel,values:fieldValues},index)=><dl key={`${stage}-${index}`} className="dc-fact-row" data-ui-component-content="review-answer-field"><dt data-ui-copy="supporting">{fieldLabel}</dt>{fieldValues.map((fieldValue,valueIndex)=><dd key={`${stage}-${index}-${valueIndex}`} data-ui-copy="body" data-ui-copy-exception={fieldLabel.startsWith("Other ") ? "Verbatim user answer with variable line breaks" : undefined}>{fieldValue}</dd>)}</dl>)}</div></div><button type="button" className="dc-button dc-button--secondary" onClick={()=>onEdit(stage)}>{COMMON_COPY.edit}</button></div>)}</div>
    <div className="dc-actions">{mode==="structured"?<button type="button" className="dc-button dc-button--primary" disabled={loading} onClick={onCreate}>{REVIEW_COPY.createStructured}</button>:<button type="button" className="dc-button dc-button--primary" disabled={loading} onClick={onCreate}>{loading?"Preparing your brief…":REVIEW_COPY.prepareAI}</button>}{mode==="ai"?<button type="button" className="dc-button dc-button--secondary" onClick={onCreateStructured}>{REVIEW_COPY.createWithoutAI}</button>:<button type="button" className="dc-button dc-button--secondary" onClick={()=>setShowConsent(v=>!v)}>{REVIEW_COPY.useAI}</button>}</div>
    {showConsent&&<div className="dc-consent" data-ui-component-content="desired-client-ai-consent"><p data-ui-copy="body">{WELCOME_COPY.aiDisclosure}</p><button type="button" className="dc-button dc-button--primary" disabled={loading} onClick={onUseAi}>{REVIEW_COPY.agreePrepare}</button></div>}
    <p className="dc-footnote" data-ui-copy="body">{REVIEW_COPY.draftFooter}</p>
  </section>;
}
