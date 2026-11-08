"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { ScreenEnginePublicWidget, type ScreenDemoView } from "./ScreenEnginePublicWidget";
import { DemoOperatorPanel } from "./DemoOperatorPanel";
import { useEmbeddedWidgetResize } from "./useEmbeddedWidgetResize";
import styles from "./ScreenDemo.module.css";

export const SCREEN_DEMO_SCENARIOS = [
  { label: "Unpaid invoice", description: "Fictional scenario. I own a Toronto design studio. A business client owes us $18,450 for a completed branding project. The invoice was due on October 1, 2026. We have a signed contract, the invoice, and emails confirming they accepted the work. The client has ignored three payment reminders. I am the owner and can approve hiring a lawyer. I want advice about a demand letter and recovering the debt. There is no court deadline that I know of." },
  { label: "Commercial lease", description: "Fictional scenario. I run a small Toronto business and am about to sign a five-year commercial lease. I want a lawyer to review the personal guarantee, renewal terms and repair obligations before Friday. I have the draft lease and the landlord’s offer. No dispute has started." },
  { label: "Employment issue", description: "Fictional scenario. I was dismissed from a management role in Ontario after eight years. I received a severance offer yesterday and have been asked to sign it within one week. I have the offer and my employment agreement. I want to understand the terms before signing." },
] as const;
const EMPTY: ScreenDemoView = { stage: "kickoff", state: null, currentQuestion: null, report: null, extraction: { status: "not-requested" }, runtime: "demo-live-ai" };
export function demoExtractionLabel(view: ScreenDemoView): string {
  if (view.runtime === "demo") return "Guided sample. AI is not being called.";
  switch (view.extraction.status) {
    case "not-needed": return "AI extraction was not needed. The guided engine is handling this inquiry.";
    case "reading": return "AI is reading the fictional description.";
    case "live": return "Live AI read the description. Review and confirm the facts.";
    case "fallback": return "AI is unavailable. The demo is continuing with the guided engine.";
    default: return "Live AI selected. Start the inquiry to test the extraction.";
  }
}

export function ScreenDemoWorkspace({ firmId = "caseload-fictional-demo", firmName = "Fictional law firm", embedded = false, preserveFirmTheme = false }: {
  firmId?: string; firmName?: string; embedded?: boolean; preserveFirmTheme?: boolean;
}) {
  const [scenario, setScenario] = useState(0);
  const [runtime, setRuntime] = useState<"demo" | "demo-live-ai">("demo-live-ai");
  const [layout, setLayout] = useState<"split" | "intake" | "brief">("split");
  const [run, setRun] = useState(0);
  const [view, setView] = useState<ScreenDemoView>(EMPTY);
  const root = useRef<HTMLDivElement>(null);
  useEmbeddedWidgetResize(root);
  const receiveView = useCallback((next: ScreenDemoView) => setView(next), []);
  function restart(nextScenario = scenario, nextRuntime = runtime) {
    setScenario(nextScenario); setRuntime(nextRuntime); setRun((current) => current + 1);
    setView({ ...EMPTY, runtime: nextRuntime });
  }
  return <div ref={root} className={`${styles.surface} ${styles.workspace}`} data-screen-demo="current" data-demo-runtime={runtime} data-ui-component-content="screen-demo-workspace">
    <header className={styles.toolbar}>
      <div className={styles.toolbarInner} data-ui-component-content="demo-toolbar">
        {!embedded && <a href="https://caseloadselect.ca/" className={styles.brand}><Image src="/brand/logos/lockup-horizontal-dark-transparent.png" alt="CaseLoad Select" width={210} height={48} priority /></a>}
        <h1 data-ui-copy="heading">Try the SCREEN</h1>
        <p className={styles.intro} data-ui-copy="body">Follow a fictional inquiry from the first description to the lawyer’s brief.</p>
        <p className={styles.dataNotice} data-ui-copy="body">Live AI can send the fictional description to Google Gemini. Guided samples run in your browser. Do not enter client or confidential information.</p>
        <div className={styles.settings}>
          <label>Fictional scenario<select value={scenario} onChange={(event) => restart(Number(event.target.value))}>{SCREEN_DEMO_SCENARIOS.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}</select></label>
          <fieldset><legend>Demo mode</legend><div className={styles.modeControls}>
            <button type="button" aria-pressed={runtime === "demo-live-ai"} onClick={() => { if (runtime !== "demo-live-ai") restart(scenario, "demo-live-ai"); }}>Live AI</button>
            <button type="button" aria-pressed={runtime === "demo"} onClick={() => { if (runtime !== "demo") restart(scenario, "demo"); }}>Guided sample</button>
          </div></fieldset>
          <button type="button" className={styles.restart} onClick={() => restart()}>Restart demo</button>
        </div>
        <p className={styles.restartNote} data-ui-copy="supporting">Changing the scenario or mode restarts the demonstration. Use fictional details only.</p>
      </div>
    </header>
    <main className={styles.body} data-ui-component-content="demo-workspace-body">
      <div className={styles.workspaceControls} data-ui-component-content="demo-workspace-controls">
      <p className={styles.status} role="status" data-extraction-status={view.extraction.status} data-ui-copy="supporting">{demoExtractionLabel(view)}</p>
      <div className={styles.views}>
        <div className={styles.viewControls} aria-label="Presentation layout">{([ ["split", "Side by side"], ["intake", "Intake"], ["brief", "Lawyer brief"] ] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={layout === value} onClick={() => setLayout(value)}>{label}</button>)}</div>
        <nav className={styles.jumpLinks} aria-label="Demo panels"><a href="#screen-demo-intake" onClick={() => setLayout("split")}>Go to intake</a><a href="#screen-demo-brief" onClick={() => setLayout("split")}>Go to brief</a></nav>
      </div>
      </div>
      <div className={styles.panels} data-layout={layout}>
        <section id="screen-demo-intake" className={styles.pane} aria-label="Prospective client intake" hidden={layout === "brief"}>
          <header className={styles.paneHeader}><h2>Client intake</h2></header>
          <div className={preserveFirmTheme ? styles.geometry : styles.widget}>
            <ScreenEnginePublicWidget key={`${scenario}-${runtime}-${run}`} firmId={firmId} firmName={firmName} runtime={runtime} layout="contained" reportEmbeddedHeight={false} initialDescription={SCREEN_DEMO_SCENARIOS[scenario].description} onDemoStateChange={receiveView} consentCaptureEnabled={false} />
          </div>
        </section>
        <aside id="screen-demo-brief" className={styles.pane} aria-label="Lawyer review" hidden={layout === "intake"}><DemoOperatorPanel view={view} contained /></aside>
      </div>
    </main>
  </div>;
}
