"use client";

import { useId, useState } from "react";
import { useAutosizeTextarea } from "@/components/intake-v2/useAutosizeTextarea";
import type { ContinuationView } from "@/lib/voice-screen-continuation";

const primary = "min-h-[52px] w-full sm:w-auto rounded-full bg-[var(--cls-accent,#1E2F58)] px-6 py-3 text-[15px] font-semibold text-[var(--cls-accent-text,#FFFFFF)] disabled:opacity-50";
const secondary = "min-h-[44px] rounded-full px-3 py-2 text-[15px] font-medium underline underline-offset-4 disabled:opacity-50";

export function ContinuationSummary({ view, busy, final, onContinue, onCorrect }: {
  view: ContinuationView;
  busy: boolean;
  final: boolean;
  onContinue: () => void;
  onCorrect: (fieldId: string, value: string) => Promise<boolean>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [editing, setEditing] = useState<{ id: string; label: string; value: string } | null>(null);
  const inputId = useId();
  const textareaRef = useAutosizeTextarea(true, editing?.value ?? "", !!editing);
  const phone = editing?.id === "client_phone";

  async function submitCorrection() {
    if (!editing) return;
    if (await onCorrect(editing.id, editing.value)) setEditing(null);
  }

  return (
    <section aria-label={final ? "Your inquiry summary" : "Summary of your call"} className="flex min-w-0 flex-col gap-6 rounded-2xl border border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_15%,transparent)] bg-[var(--cls-surface,#FFFFFF)] p-6 max-[480px]:p-4 max-[360px]:p-3 text-[var(--cls-text,#1E2F58)]" style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}>
      <div data-ui-component-content="continuation-summary-heading" className="flex flex-col gap-3">
        <h2 data-ui-copy="heading" className="text-[24px] leading-tight font-extrabold [text-wrap:pretty]" style={{ fontFamily: "var(--cls-font-display, Manrope, sans-serif)" }}>
          {final ? "Your inquiry summary" : "Here is what we understood from your call."}
        </h2>
        <p data-ui-copy="body" className="text-[16px] leading-relaxed opacity-75" style={{ textWrap: "wrap" }}>
          {final ? "This brings together the information from your call and the answers you added here." : "Review these details and correct anything we missed."}
        </p>
      </div>

      <dl className="m-0 flex min-w-0 flex-col divide-y divide-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_12%,transparent)]">
        {view.summary.fields.map(field => (
          <div key={field.id} className="flex min-w-0 flex-col gap-2 py-4 first:pt-0" data-ui-component-content={`continuation-summary-${field.id}`}>
            <dt data-ui-copy="supporting" className="text-[14px] font-semibold">{field.label}</dt>
            <dd data-ui-copy="body" className="m-0 whitespace-pre-wrap break-words text-[16px] leading-relaxed">{field.value || "Not captured on the call"}</dd>
            {field.uncertain && <dd data-ui-copy="supporting" className="m-0 text-[14px] leading-relaxed opacity-70">Please confirm this detail.</dd>}
            {correcting && field.editable && !editing && (
              <button type="button" disabled={busy} className={`${secondary} self-start px-0`} onClick={() => setEditing({ id: field.id, label: field.label, value: field.id === "client_phone" || field.value === "Not captured" ? "" : field.value })} aria-label={`Edit ${field.label.toLowerCase()}`}>
                Edit
              </button>
            )}
          </div>
        ))}
      </dl>

      {editing && (
        <form onSubmit={event => { event.preventDefault(); void submitCorrection(); }} className="flex min-w-0 flex-col gap-3 rounded-xl bg-[var(--cls-bg,#F4F3EF)] p-4" aria-label="Correct a captured detail">
          <label htmlFor={inputId} className="text-[15px] font-semibold">{editing.label}</label>
          {phone ? (
            <input id={inputId} autoFocus type="tel" autoComplete="tel" value={editing.value} onChange={event => setEditing({ ...editing, value: event.target.value })} maxLength={40} disabled={busy} className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-[16px]" placeholder="Your preferred callback number" />
          ) : (
            <textarea id={inputId} ref={textareaRef} autoFocus rows={editing.id === "situation" ? 4 : 2} value={editing.value} onChange={event => setEditing({ ...editing, value: event.target.value })} maxLength={editing.id === "client_name" ? 120 : editing.id === "deadline" ? 300 : 1500} disabled={busy} className="min-w-0 w-full resize-none overflow-hidden rounded-lg border border-slate-300 bg-white px-3 py-3 text-[16px] leading-relaxed" />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !editing.value.trim()} className={primary}>Save correction</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)} className={secondary}>Cancel</button>
          </div>
        </form>
      )}

      {view.summary.answers.length > 0 && (
        <section aria-label="Additional answers" className="flex min-w-0 flex-col gap-4">
          <h3 className="m-0 text-[18px] font-bold">What you added here</h3>
          {view.summary.answers.map((answer, index) => (
            <div key={`${index}-${answer.question}`} className="flex min-w-0 flex-col gap-2 border-t border-slate-200 pt-4" data-ui-component-content={`continuation-summary-answer-${index}`}>
              <p data-ui-copy="supporting" className="text-[14px] font-semibold leading-relaxed">{answer.question}</p>
              <p data-ui-copy="body" className="whitespace-pre-wrap break-words text-[16px] leading-relaxed">{answer.answer}</p>
            </div>
          ))}
        </section>
      )}

      {!final && !editing && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={onContinue} className={primary}>{view.reviewConfirmed ? "Continue your inquiry" : "That's right, continue"}</button>
          <button type="button" disabled={busy} onClick={() => setCorrecting(!correcting)} className={secondary}>{correcting ? "Done correcting" : "Correct something"}</button>
        </div>
      )}
    </section>
  );
}
