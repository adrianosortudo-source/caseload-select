"use client";

import { useState } from "react";
import { answerDemoState, buildDemoReport } from "@/lib/screen-demo";
import { canContinueDemo, FICTIONAL_CALL, nextContinuationStep, seedCallState, type InquiryPermission } from "@/lib/voice-screen-demo";
import type { EngineState } from "@/lib/screen-engine/types";
import styles from "./journey.module.css";

export function VoiceScreenDemo() {
  const [phase, setPhase] = useState<"call" | "message" | "screen" | "done">("call");
  const [permission, setPermission] = useState<InquiryPermission>("unknown");
  const [callerType, setCallerType] = useState("new");
  const [safeToText, setSafeToText] = useState(false);
  const [state, setState] = useState<EngineState | null>(null);
  const [answer, setAnswer] = useState("");
  const [answers, setAnswers] = useState<{ question: string; value: string }[]>([]);
  const next = state ? nextContinuationStep(state) : null;
  const report = state ? buildDemoReport(state) : null;

  function endCall() {
    setState(seedCallState());
    setPhase(canContinueDemo(permission, callerType, safeToText) ? "message" : "done");
  }
  function respond(value: string, label = value) {
    if (!state || !next?.slot || !value.trim()) return;
    setAnswers([...answers, { question: next.slot.question, value: label }]);
    setState(answerDemoState(state, next.slot.id, value.trim()));
    setAnswer("");
  }
  function reset() {
    setPhase("call"); setPermission("unknown"); setCallerType("new");
    setState(null); setAnswers([]); setAnswer(""); setSafeToText(false);
  }

  return <main className={styles.page}>
    <header className={styles.header} data-ui-component-content="journey-header">
      <p className={styles.eyebrow} data-ui-copy="supporting">CaseLoad Select · Parallel journey demo</p>
      <h1 data-ui-copy="heading">One inquiry. A continuous conversation.</h1>
      <p data-ui-copy="body">A short reception call becomes a focused Screen, with one brief for the lawyer.</p>
      <button className={styles.secondary} onClick={reset}>Restart demonstration</button>
    </header>
    <p className={styles.notice}>Fictional demonstration. The call and SMS are simulated. Answers stay in this page and disappear on refresh. No call, message or CRM update is sent.</p>
    <ol className={styles.steps} aria-label="Journey progress">
      {["Reception", "Text invitation", "Screen", "Lawyer review"].map((label, index) => <li key={label} aria-current={index === ["call", "message", "screen", "done"].indexOf(phase) ? "step" : undefined}><span>0{index + 1}</span>{label}</li>)}
    </ol>
    <div className={styles.split}>
      <section className={styles.panel} data-ui-component-content="caller-panel">
        <p className={styles.eyebrow} data-ui-copy="supporting">Caller experience</p>
        {phase === "call" && <>
          <h2 data-ui-copy="heading">Keep the first call simple.</h2>
          <p data-ui-copy="body">Alex Morgan is a fictional caller with an unpaid invoice. Reception captures the essentials before offering a text link.</p>
          <dl className={styles.facts}><dt>Name and callback</dt><dd>{FICTIONAL_CALL.name} · {FICTIONAL_CALL.phone}</dd><dt>Reason for calling</dt><dd>{FICTIONAL_CALL.situation}</dd><dt>Deadline</dt><dd>{FICTIONAL_CALL.deadline}</dd></dl>
          <label className={styles.label}>Caller type<select value={callerType} onChange={event => setCallerType(event.target.value)}><option value="new">New inquiry</option><option value="existing">Existing client</option><option value="urgent">Urgent human follow-up</option></select></label>
          <fieldset><legend>“May I text you a link with a few short questions to help the team prepare?”</legend>{([['granted', 'Yes, send the link'], ['declined', 'No, just call me back'], ['unknown', 'No clear answer']] as const).map(([value, label]) => <label className={styles.radio} key={value}><input type="radio" name="permission" checked={permission === value} onChange={() => setPermission(value)} />{label}</label>)}</fieldset>
          <label className={styles.radio}><input type="checkbox" checked={safeToText} onChange={event => setSafeToText(event.target.checked)} />Caller confirms this number is correct and safe to text</label>
          <button className={styles.primary} onClick={endCall}>End simulated call</button>
        </>}
        {phase === "message" && <>
          <h2 data-ui-copy="heading">The invitation arrives.</h2>
          <p data-ui-copy="body">Permission was captured on the call. This is a preview of the follow-up text.</p>
          <div className={styles.message}><span>Sample law firm · Simulated SMS</span><p>Thanks for calling our firm. Here’s the link we discussed to help our team prepare. You can skip questions. Please avoid confidential details or documents.</p><button onClick={() => setPhase("screen")}>Open your Screen</button></div>
          <p data-ui-copy="supporting">This button opens the demo in place. A live journey needs a private, expiring link delivered through the configured phone service.</p>
        </>}
        {phase === "screen" && <>
          <h2 data-ui-copy="heading">Pick up where you left off.</h2>
          <p data-ui-copy="body">We have your name, callback number and reason for calling. Please answer only what you’re comfortable sharing.</p>
          {next?.slot ? <form onSubmit={event => { event.preventDefault(); respond(answer); }}>
            <label className={styles.question} htmlFor="continuation-answer">{next.slot.question}</label>
            <div className={styles.options}>{next.slot.options?.map(option => <button type="button" key={option.value} onClick={() => respond(option.value, option.label)}>{option.label}</button>)}</div>
            <textarea id="continuation-answer" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Or answer in your own words" maxLength={1500} />
            <button className={styles.primary} disabled={!answer.trim()} type="submit">Continue</button>
            <button className={styles.secondary} type="button" onClick={() => respond("not_sure", "Skipped by caller")}>Skip this question</button>
          </form> : <><p data-ui-copy="body">That is enough for this initial review. The brief brings your call and written answers together.</p><button className={styles.primary} onClick={() => setPhase("done")}>Finish Screen</button></>}
          <button className={styles.textButton} onClick={() => setPhase("done")}>Finish with what I have shared</button>
        </>}
        {phase === "done" && <>
          <h2 data-ui-copy="heading">The callback request comes first.</h2>
          <p data-ui-copy="body">{canContinueDemo(permission, callerType, safeToText) ? "The combined brief is ready to preview. Unanswered questions remain open for the team." : "No text invitation was created. This inquiry follows the human callback path."}</p>
          <p data-ui-copy="supporting">In this demonstration, nothing is delivered to a lawyer. In the live journey, partial answers must never block human follow-up.</p>
          <button className={styles.primary} onClick={reset}>Try another path</button>
        </>}
      </section>
      <aside className={`${styles.panel} ${styles.brief}`} aria-label="Live lawyer brief" aria-live="polite" data-ui-component-content="brief-panel">
        <p className={styles.eyebrow} data-ui-copy="supporting">Lawyer view · updates as you go</p>
        <h2 data-ui-copy="heading">One combined brief</h2>
        {!state ? <p data-ui-copy="body">End the simulated call to see the caller’s information arrive here.</p> : <>
          <div className={styles.status}>{phase === "done" ? "Ready for demonstration review" : "Inquiry in progress"}</div>
          <h3>Captured during the call</h3>
          <dl className={styles.facts}><dt>Caller</dt><dd>{FICTIONAL_CALL.name}</dd><dt>Callback</dt><dd>{FICTIONAL_CALL.phone}</dd><dt>Reason for calling</dt><dd>{FICTIONAL_CALL.situation}</dd><dt>Deadline</dt><dd>{FICTIONAL_CALL.deadline}</dd><dt>Permission for inquiry text</dt><dd>{permission === "granted" ? "Granted in simulated call" : permission === "declined" ? "Declined" : "Not established"}</dd></dl>
          <h3>Added in the Screen</h3>
          <p data-ui-copy="supporting">{safeToText ? "The caller confirmed the callback number is correct and safe to text." : "Safe-to-text confirmation was not established. No invitation is sent."}</p>
          {answers.length ? <dl className={styles.facts}>{answers.map((entry, index) => <div key={index}><dt>{entry.question}</dt><dd>{entry.value}</dd></div>)}</dl> : <p data-ui-copy="body">No written answers yet.</p>}
          <h3>Engine assessment</h3>
          <p data-ui-copy="body">{report?.matter_snapshot}</p>
          <p data-ui-copy="supporting">This assessment is inferred by the existing Screen demo engine. The caller’s original statements remain above for review.</p>
          <h3>Human follow-up</h3>
          <p data-ui-copy="body">{callerType === "urgent" ? "Urgent human follow-up selected. Do not wait for qualification." : callerType === "existing" ? "Existing client: route to their team." : "Callback request remains open, including if the Screen is incomplete."}</p>
        </>}
      </aside>
    </div>
  </main>;
}
