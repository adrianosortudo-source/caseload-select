"use client";
import { useEffect, useState } from "react";
import styles from "../../demo/voice-to-screen/journey.module.css";

type Row = { id: string; callerName: string; broadNeed: string; urgency: string; status: string; humanStatus: string; createdAt: string; invitation: Array<{ status: string }> };
type Brief = { id: string; call: { callId: string; callerName: string; callback: { number: string; verifiedOnCallId: string }; broadNeed: string; deadline: string }; answers: Array<{ question: string; answer: string }>; humanStatus: string; report: { matter_snapshot: string } };
export function VoiceScreenQueue() {
  const [rows, setRows] = useState<Row[]>([]); const [brief, setBrief] = useState<Brief | null>(null); const [error, setError] = useState("");
  async function refresh() { const r = await fetch("/api/admin/voice-screen", { cache: "no-store" }); if (!r.ok) throw new Error("The parallel inquiry queue is unavailable or disabled."); setRows((await r.json()).inquiries); }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  async function open(id: string) { try { const r = await fetch(`/api/admin/voice-screen/${id}`, { cache: "no-store" }); if (!r.ok) throw new Error("The brief could not be opened."); setBrief(await r.json()); setError(""); } catch (e) { setError((e as Error).message); } }
  async function takeOver(id: string) { try { const r = await fetch("/api/admin/voice-screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); if (!r.ok) throw new Error("Taking over failed. Please try again."); await refresh(); await open(id); } catch (e) { setError((e as Error).message); } }
  async function reconcile() { try { const r = await fetch("/api/admin/voice-screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcile_dispatch" }) }); if (!r.ok) throw new Error("Dispatch reconciliation failed."); await refresh(); } catch (e) { setError((e as Error).message); } }
  return <main className={styles.page} style={{ overflowWrap: "anywhere" }}>
    <button className={styles.secondary} onClick={() => void reconcile()}>Flag stalled invitations for manual review</button>
    {rows.filter(row => row.invitation?.some(item => ["unknown", "dispatching"].includes(item.status))).map(row => <p key={`dispatch-${row.id}`} role="status">{row.callerName || "Unnamed caller"}: invitation {row.invitation.map(item => item.status).join(", ")}. Check provider history before taking further action. Do not resend automatically.</p>)}
    {brief && <p role="status">Callback verification: {brief.call.callback.verifiedOnCallId === brief.call.callId ? "Caller stated this number on this call." : "Unconfirmed number. Verify it before relying on it."}</p>}
    <header className={styles.header}><p className={styles.eyebrow}>Parallel Voice to Screen</p><h1>Human follow-up queue</h1><p>Every accepted call appears here before any qualification is completed. Review urgent requests first.</p><button className={styles.secondary} onClick={() => void refresh().catch(e => setError(e.message))}>Refresh queue</button></header>
    {error && <p role="alert">{error}</p>}
    <div className={styles.split}>
      <section className={styles.panel}><h2>Callback requests</h2>{!rows.length && <p>No parallel inquiries are available.</p>}{rows.map(row => <article key={row.id}><h3>{row.callerName || "Name not confirmed"}</h3><p>{row.broadNeed}</p><p>{row.urgency} · {row.status} · Human follow-up: {row.humanStatus}</p><button className={styles.secondary} onClick={() => void open(row.id)}>Review combined brief</button></article>)}</section>
      <section className={styles.panel}><h2>Combined brief</h2>{!brief ? <p>Select an inquiry to review its call and Screen answers.</p> : <><h3>{brief.call.callerName || "Name not confirmed"}</h3><p>Callback: <a href={`tel:${brief.call.callback.number}`}>{brief.call.callback.number || "Not confirmed"}</a></p><h3>From the call</h3><p>{brief.call.broadNeed}</p><p>Deadline: {brief.call.deadline || "Not confirmed"}</p><h3>From the Screen</h3>{brief.answers.length ? brief.answers.map((a, i) => <div key={i}><h3>{a.question}</h3><p>{a.answer}</p></div>) : <p>No written answers yet. The callback request remains open.</p>}<h3>Engine assessment</h3><p>{brief.report.matter_snapshot}</p><p>Review the caller’s statements above before deciding the response.</p><button className={styles.primary} disabled={brief.humanStatus === "taken_over"} onClick={() => void takeOver(brief.id)}>Take over and stop automation</button><p>Taking over revokes the continuation link and cancels pending invitations. A message already in flight may still arrive with an inactive link.</p></>}</section>
    </div>
  </main>;
}
