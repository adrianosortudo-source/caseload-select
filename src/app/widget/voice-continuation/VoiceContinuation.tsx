"use client";
import { useEffect, useRef, useState } from "react";
import styles from "../../demo/voice-to-screen/journey.module.css";

type View = { revision: number; status: string; question: null | { id: string; text: string; options: Array<{ value: string; label: string }> } };
export function VoiceContinuation() {
  const token = useRef("");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(true);
  async function load() {
    const response = await fetch("/api/voice-screen/continue", { headers: { Authorization: `Bearer ${token.current}` }, cache: "no-store" });
    if (!response.ok) throw new Error("This link is unavailable right now. Please contact the firm if you need help.");
    setView(await response.json());
  }
  useEffect(() => {
    // Fragment bearer never reaches access logs. Remove it before any fetch and
    // keep it only in memory. Reopening the original SMS link resumes the inquiry.
    token.current ||= window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token.current)) { setError("Open the link in the text message from your firm to continue."); setBusy(false); return; }
    void load().catch(e => setError(e.message)).finally(() => setBusy(false));
  }, []);
  async function save(value: string, skip = false, finish = false) {
    if (!view || busy) return;
    setBusy(true); setError("");
    try {
      const payload = finish ? { revision: view.revision, finish: true } : { revision: view.revision, slotId: view.question?.id, value, skip };
      const response = await fetch("/api/voice-screen/continue", { method: "POST", headers: { Authorization: `Bearer ${token.current}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status === 409) { await load(); setAnswer(""); throw new Error("Your inquiry changed in another window. Please review the current question."); }
      if (!response.ok) throw new Error("Your answer could not be saved. Please try again or contact the firm.");
      setView(await response.json()); setAnswer("");
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}>
    <section className={styles.panel} data-ui-component-content="live-continuation">
      <p className={styles.eyebrow} data-ui-copy="supporting">Continue your inquiry</p>
      <h1 data-ui-copy="heading">Pick up where you left off.</h1>
      <p data-ui-copy="body">We have the essentials from your call. These optional questions help the team prepare. Please avoid confidential details or documents before the firm reviews your inquiry.</p>
      {error && <p role="alert" data-ui-copy="body">{error}</p>}
      {busy && !view && <p role="status" data-ui-copy="supporting">Opening your inquiry…</p>}
      {view?.status === "completed" ? <p role="status" data-ui-copy="body">Your answers are saved for the team. Your original callback request remains available to them.</p> : view && <>
        {view.question ? <form onSubmit={e => { e.preventDefault(); void save(answer); }}>
          <label className={styles.question} htmlFor="live-answer">{view.question.text}</label>
          <div className={styles.options}>{view.question.options.map(option => <button key={option.value} type="button" disabled={busy} onClick={() => void save(option.value)}>{option.label}</button>)}</div>
          {!view.question.options.length && <><textarea id="live-answer" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={1500} disabled={busy} placeholder="Answer in your own words" />
          <button className={styles.primary} disabled={busy || !answer.trim()}>Save and continue</button></>}
          <button className={styles.secondary} type="button" disabled={busy} onClick={() => void save("", true)}>Skip this question</button>
        </form> : <p data-ui-copy="body">That is enough for this initial review. Your answers are already saved.</p>}
        <button className={styles.textButton} disabled={busy} onClick={() => void save("", false, true)}>Finish with what I have shared</button>
      </>}
      <p data-ui-copy="supporting">You can stop at any time. Reopen the link in your text message to continue while it remains valid. This form does not provide legal advice.</p>
    </section>
  </main>;
}
