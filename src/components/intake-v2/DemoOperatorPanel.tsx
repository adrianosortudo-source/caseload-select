"use client";

import { demoCapturedFacts } from "@/lib/screen-demo-confirmation";
import { useMemo } from "react";
import { WEB_EXPERIENCE_POLICY_VERSION } from "@/lib/screen-engine/control";
import { DEMO_BRIEF_PROJECTION_VERSION, renderBriefHtmlServer } from "@/lib/screen-brief-html";
import type { ScreenDemoView } from "./ScreenEnginePublicWidget";
import styles from "./ScreenDemo.module.css";

const STAGES: Record<ScreenDemoView["stage"], string> = {
  kickoff: "Waiting to begin", questions: "Draft brief", contact: "Ready for review", done: "Brief ready",
};
function percent(value: number) { return `${Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)))}%`; }
function label(value: string) { return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()); }

export function DemoOperatorPanel({ view, continuation }: { view: ScreenDemoView; contained?: boolean; continuation?: { contactUsed: boolean; replyOpen: boolean; onOpenReply: () => void; draft: string; onDraftChange: (value: string) => void; reply: string | null; onShowReply: () => void } }) {
  const { state, report } = view;
  const corrections = state ? demoCapturedFacts(state).filter((fact) => state.slot_meta[fact.id]?.evidence === "Client corrected this fact during demo review") : [];
  const reportHtml = useMemo(() => report && state ? renderBriefHtmlServer(report, "web", state.language, undefined, state.matter_type, state.practice_area, { presentation: "demo" }) : "", [report, state]);
  return (
    <div className={styles.operator} data-demo-report data-engine-policy={WEB_EXPERIENCE_POLICY_VERSION} data-report-projection={DEMO_BRIEF_PROJECTION_VERSION}>
      <header className={styles.paneHeader} data-ui-component-content="demo-operator-header">
        <h2 data-ui-copy="heading">Lawyer brief</h2>
        <p className={styles.label} role="status">{STAGES[view.stage]}</p>
      </header>
      <div className={styles.reportContent} data-demo-brief-content data-ui-component-content="demo-report-content">
        {state && view.extraction.status !== "reading" ? <>
          <dl className={styles.metrics} aria-label="Intake assessment">
            <div><dt>Matter type</dt><dd>{label(state.matter_type)}</dd></div>
            <div><dt>Fit band</dt><dd>{state.band ?? "Unassigned"}</dd></div>
            <div><dt>Core facts</dt><dd>{percent(state.coreCompleteness)}</dd></div>
            <div><dt>Confidence</dt><dd>{percent(state.confidence)}</dd></div>
          </dl>
          <p className={styles.calibration} data-ui-copy="supporting">Confidence uses the available facts.</p>
          {view.currentQuestion && <section className={styles.currentQuestion} data-ui-component-content="demo-current-question">
            <h3>Still to resolve</h3><p data-ui-copy="body">{view.currentQuestion.question}</p>
          </section>}
          {reportHtml ? <>
            <div className={styles.brief} dangerouslySetInnerHTML={{ __html: reportHtml }} />
            {corrections.length > 0 && <details className={styles.changes}><summary>Client corrections</summary><dl>{corrections.map((fact) => <div key={fact.id} data-ui-component-content="demo-corrected-fact"><dt>{fact.label}</dt><dd data-ui-copy="supporting">{fact.value}</dd></div>)}</dl><p>These values were corrected and confirmed during review.</p></details>}
            <details className={styles.changes}><summary>Original inquiry</summary><div data-ui-component-content="demo-original-inquiry"><p data-ui-copy="body">{state.input}</p></div></details>
          </> :
            <section className={styles.empty} data-ui-component-content="demo-empty-brief"><p data-ui-copy="body">Review the captured facts. Confirmed details and remaining gaps will appear in the brief.</p></section>}
        </> : <section className={styles.empty} data-ui-component-content="demo-empty-brief">
          <p data-ui-copy="body">Start a fictional inquiry to see the lawyer’s brief develop.</p>
          <p data-ui-copy="body">The brief shows reasons, open questions and preparation for the first call.</p>
        </section>}
      </div>
      {view.stage === "done" && continuation?.contactUsed && <section className={styles.continuation} data-ui-component-content="demo-continuation">
        <h3 data-ui-copy="heading">Sample contact</h3><p data-ui-copy="supporting">Fictional details</p>
        <dl><dt>Name</dt><dd>Alex Morgan</dd><dt>Email</dt><dd>alex.morgan@example.com</dd></dl>
        <p className={styles.humanBoundary} data-ui-copy="body">The Screen prioritizes attention. The lawyer decides.</p>
        {!continuation.replyOpen && <button type="button" className={styles.secondary} onClick={continuation.onOpenReply}>Preview a reply</button>}
        {continuation.replyOpen && <>
          <label htmlFor="demo-simulated-reply">Simulated lawyer reply</label>
          <textarea id="demo-simulated-reply" rows={5} maxLength={2000} value={continuation.draft} onChange={(event) => continuation.onDraftChange(event.target.value)} disabled={continuation.reply !== null} />
          <button type="button" className={styles.primary} disabled={!continuation.draft.trim() || continuation.reply !== null} onClick={continuation.onShowReply}>Show reply in demo</button>
          {continuation.reply !== null && <div role="status"><p>Shown in this demo</p><p className={styles.replyText}>{continuation.reply}</p></div>}
        </>}
      </section>}
      <footer className={styles.paneFooter} data-ui-component-content="demo-operator-footer"><p data-ui-copy="supporting">Demonstration only. No lead, external message or real follow-up is created.</p></footer>
    </div>
  );
}
