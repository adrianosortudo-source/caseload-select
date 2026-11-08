"use client";

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

export function DemoOperatorPanel({ view }: { view: ScreenDemoView; contained?: boolean }) {
  const { state, report } = view;
  const reportHtml = useMemo(() => report && state ? renderBriefHtmlServer(report, "web", state.language, undefined, state.matter_type, state.practice_area, { presentation: "demo" }) : "", [report, state]);
  return (
    <div className={styles.operator} data-demo-report data-engine-policy={WEB_EXPERIENCE_POLICY_VERSION} data-report-projection={DEMO_BRIEF_PROJECTION_VERSION}>
      <header className={styles.paneHeader} data-ui-component-content="demo-operator-header">
        <h2 data-ui-copy="heading">Lawyer brief</h2>
        <p className={styles.label} role="status">{STAGES[view.stage]}</p>
      </header>
      <div className={styles.reportContent} data-demo-brief-content>
        {state ? <>
          <dl className={styles.metrics} aria-label="Intake assessment">
            <div><dt>Matter type</dt><dd>{label(state.matter_type)}</dd></div>
            <div><dt>Fit band</dt><dd>{state.band ?? "Unassigned"}</dd></div>
            <div><dt>Core facts</dt><dd>{percent(state.coreCompleteness)}</dd></div>
            <div><dt>Confidence</dt><dd>{percent(state.confidence)}</dd></div>
          </dl>
          {view.currentQuestion && <section className={styles.currentQuestion} data-ui-component-content="demo-current-question">
            <h3>Still to resolve</h3><p data-ui-copy="body">{view.currentQuestion.question}</p>
          </section>}
          {reportHtml ? <div className={styles.brief} dangerouslySetInnerHTML={{ __html: reportHtml }} /> :
            <section className={styles.empty} data-ui-component-content="demo-empty-brief"><p data-ui-copy="body">Review the captured facts. Confirmed details and remaining gaps will appear in the brief.</p></section>}
        </> : <section className={styles.empty} data-ui-component-content="demo-empty-brief">
          <p data-ui-copy="body">Start a fictional inquiry to see the lawyer’s brief develop.</p>
          <p data-ui-copy="body">The brief shows reasons, open questions and preparation for the first call.</p>
        </section>}
      </div>
      <footer className={styles.paneFooter} data-ui-component-content="demo-operator-footer"><p data-ui-copy="supporting">Demonstration only. No lead, message or follow-up is created.</p></footer>
    </div>
  );
}
