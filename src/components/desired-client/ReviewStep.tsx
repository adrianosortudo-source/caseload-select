"use client";
import { useState } from "react";
import { STAGE_SUMMARY_LABELS, REVIEW_COPY, COMMON_COPY, WELCOME_COPY } from "@/lib/desired-client/copy";
import { buildDraftPreview } from "@/lib/desired-client/brief";
import { getWorkLabel, getRoleLabel, GOAL_LABELS, REASON_LABELS, getReasonLabel, TIMING_LABELS, AIM_LABELS, EVIDENCE_LABELS, CAPACITY_LABELS } from "@/lib/desired-client/catalog";
import type { DesiredClientAnswers } from "@/lib/desired-client/types";
export function ReviewStep({ answers, mode, onCreate, onUseAi, onCreateStructured, onEdit, briefNeedsUpdate, loading }: { answers: DesiredClientAnswers; mode: "ai" | "structured"; onCreate: () => void; onUseAi: () => void; onCreateStructured:()=>void; onEdit: (stage: 1|2|3|4|5|6) => void; briefNeedsUpdate:boolean; loading:boolean }) {
  const [showConsent, setShowConsent] = useState(false);
  const preview = buildDraftPreview(answers);
  const work = answers.focus.work && answers.focus.area ? answers.focus.work === "other" ? answers.focus.work_other || "Another type of work" : getWorkLabel(answers.focus.area, answers.focus.work) : "Not selected";
  const role = answers.situation.role && answers.focus.area ? answers.situation.role === "other" ? answers.situation.role_other || "Another role" : getRoleLabel(answers.focus.area, answers.situation.role) : "Not selected";
  const goals = answers.client.goals.map(id => GOAL_LABELS[id]).join(", ");
  const summary: Array<[string,string,1|2|3|4|5|6]> = [
    ["Work",work,1], [STAGE_SUMMARY_LABELS[0],`${role} · ${answers.situation.timing?TIMING_LABELS[answers.situation.timing]:"Not selected"}`,2],
    [STAGE_SUMMARY_LABELS[1],goals,3], [STAGE_SUMMARY_LABELS[2],answers.value.reasons.map(id=>getReasonLabel(id,answers.focus.route)).join(", "),4],
    [STAGE_SUMMARY_LABELS[3],answers.delivery.capacity?CAPACITY_LABELS[answers.delivery.capacity]:"Not selected",5],
    [STAGE_SUMMARY_LABELS[4],`${answers.direction.aim?AIM_LABELS[answers.direction.aim]:"Not selected"} · ${answers.direction.evidence.map(id=>EVIDENCE_LABELS[id]).join(", ")}`,6],
  ];
  return <section className="dc-review" data-ui-component-content="desired-client-review">
    <h1 data-ui-copy="heading">{REVIEW_COPY.heading}</h1><p data-ui-copy="body">{REVIEW_COPY.note}</p>
    <div className="dc-preview-inline" data-ui-component-content="review-preview"><strong data-ui-component-content="review-preview-label" data-ui-copy="supporting">{preview.label}</strong><span data-ui-component-content="review-preview-badge" data-ui-copy="supporting">{preview.badge}</span>{preview.rows.map(row=><p key={row.label} data-ui-component-content="review-preview-row" data-ui-copy="supporting"><b>{row.label}:</b> {row.value}</p>)}</div>
    {briefNeedsUpdate&&<p className="dc-alert" data-ui-copy="body">{COMMON_COPY.briefChanged}</p>}
    <div className="dc-summary-list">{summary.map(([label,value,stage])=><div key={label} className="dc-summary-row" data-ui-component-content="review-summary-row"><div data-ui-component-content="review-summary-content"><h2 data-ui-copy="heading">{label}</h2><p data-ui-component-content="review-summary-value" data-ui-copy="body">{value}</p></div><button type="button" className="dc-button dc-button--secondary" onClick={()=>onEdit(stage)}>{COMMON_COPY.edit}</button></div>)}</div>
    <div className="dc-actions">{mode==="structured"?<button type="button" className="dc-button dc-button--primary" disabled={loading} onClick={onCreate}>{REVIEW_COPY.createStructured}</button>:<button type="button" className="dc-button dc-button--primary" disabled={loading} onClick={onCreate}>{loading?"Preparing your brief…":REVIEW_COPY.prepareAI}</button>}{mode==="ai"?<button type="button" className="dc-button dc-button--secondary" onClick={onCreateStructured}>{REVIEW_COPY.createWithoutAI}</button>:<button type="button" className="dc-button dc-button--secondary" onClick={()=>setShowConsent(v=>!v)}>{REVIEW_COPY.useAI}</button>}</div>
    {showConsent&&<div className="dc-consent" data-ui-component-content="desired-client-ai-consent"><p data-ui-copy="body">{WELCOME_COPY.aiDisclosure}</p><button type="button" className="dc-button dc-button--primary" disabled={loading} onClick={onUseAi}>{REVIEW_COPY.agreePrepare}</button></div>}
    <p className="dc-footnote" data-ui-copy="body">{REVIEW_COPY.draftFooter}</p>
  </section>;
}