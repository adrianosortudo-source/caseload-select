"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyProspectDataChanged } from "./prospect-data-events";

type Summary = { received: number; eligibleForApply: number; new: number; update: number; duplicate: number; reviewRequired: number; invalid: number };
type Draft = {
  draftId: string; sourceName: string; submittedBy: string; payloadSha256: string; recordCount: number;
  review: { summary: Summary; records: { sourceRecordKey: string; disposition: string; reason: string }[] };
  state: "ready_for_operator" | "review_required" | "applied"; createdAt: string; appliedAt: string | null;
};

function dateTime(value: string | null): string {
  if (!value) return "Not applied";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function stateLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.draftId === "string" && typeof draft.sourceName === "string" && typeof draft.submittedBy === "string"
    && typeof draft.payloadSha256 === "string" && typeof draft.recordCount === "number" && typeof draft.state === "string"
    && typeof draft.createdAt === "string" && (draft.appliedAt === null || typeof draft.appliedAt === "string")
    && Boolean(draft.review) && typeof draft.review === "object";
}

export default function AiDraftInbox() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/admin/prospects/agent-drafts", { signal, headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({})) as { drafts?: unknown; error?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The AI draft inbox could not be loaded.");
      setDrafts(Array.isArray(payload.drafts) ? payload.drafts.filter(isDraft) : []);
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setDrafts(null); setError(cause instanceof Error ? cause.message : "The AI draft inbox could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const counts = useMemo(() => {
    const rows = drafts ?? [];
    return { staged: rows.filter((draft) => draft.state !== "applied").length, ready: rows.filter((draft) => draft.state === "ready_for_operator").length, review: rows.filter((draft) => draft.state === "review_required").length, applied: rows.filter((draft) => draft.state === "applied").length };
  }, [drafts]);

  async function apply(draftId: string) {
    if (!reviewed[draftId] || busy) return;
    setBusy(draftId); setError(null);
    try {
      const response = await fetch("/admin/prospects/agent-drafts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId }) });
      const payload = await response.json().catch(() => ({})) as { error?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The staged package could not be imported.");
      setReviewed((current) => ({ ...current, [draftId]: false }));
      await load();
      notifyProspectDataChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The staged package could not be imported."); }
    finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="ai-draft-inbox-heading" className="rounded-lg border border-border-brand bg-white p-4 sm:p-5 [&_[data-ui-copy]]:text-pretty" data-ui-component-content="ai-draft-inbox">
      <div className="min-w-0">
        <p className="w-full text-xs font-semibold uppercase tracking-wider text-gold-on-light" data-ui-copy="supporting">Protected enrichment staging</p>
        <h2 id="ai-draft-inbox-heading" className="mt-1 w-full text-xl font-bold text-navy" data-ui-copy="heading">AI draft inbox</h2>
        <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">A scoped agent credential can submit validated public-evidence packages here. It cannot import a prospect, create a CRM record, submit a form, start a chat, or send outreach. You retain the final review and import action.</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="AI draft inbox counts">
        {[["Staged", counts.staged], ["Ready", counts.ready], ["Needs review", counts.review], ["Applied", counts.applied]].map(([label, count]) => <div key={String(label)} className="rounded border border-border-brand bg-parchment/40 p-3"><span className="block text-xs font-semibold uppercase tracking-wide text-field-label">{label}</span><strong className="mt-1 block text-xl text-navy">{count}</strong></div>)}
      </div>

      <p className="mt-3 w-full text-xs leading-5 text-black/55" data-ui-copy="supporting">Agents submit to <code className="break-all rounded bg-parchment px-1 py-0.5">/api/internal/prospect-enrichment/drafts</code> with an idempotency key. Each package is revalidated against the live ledger when you choose Import.</p>
      {error ? <p className="mt-3 w-full rounded border border-red-fail/30 bg-red-50 p-3 text-sm text-red-fail" role="alert" data-ui-copy="body">{error}</p> : null}

      <div className="mt-4 space-y-3" data-ui-component-content="ai-draft-inbox-list">
        {drafts === null && !error ? <p className="rounded border border-dashed border-border-brand bg-parchment/30 p-3 text-sm text-black/60" data-ui-copy="body">Loading staged AI packages...</p> : null}
        {drafts?.length === 0 ? <p className="rounded border border-dashed border-border-brand bg-parchment/30 p-3 text-sm text-black/60" data-ui-copy="body">No AI packages are staged. The inbox stays empty until a scoped agent submits a valid package.</p> : null}
        {drafts?.map((draft) => {
          const summary = draft.review.summary;
          const canApply = draft.state === "ready_for_operator" && reviewed[draft.draftId] && !busy;
          return <article key={draft.draftId} className="rounded border border-border-brand bg-parchment/20 p-3 sm:p-4" data-ui-component-content="ai-draft-inbox-row">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="w-full break-words font-semibold text-navy" data-ui-copy="heading">{draft.sourceName}</h3>
                <p className="mt-1 w-full text-xs text-black/55" data-ui-copy="supporting">Submitted by {draft.submittedBy} on {dateTime(draft.createdAt)}. {draft.recordCount} record{draft.recordCount === 1 ? "" : "s"}. Receipt {draft.payloadSha256.slice(0, 16)}...</p>
              </div>
              <span className="rounded-full border border-border-brand bg-white px-2 py-1 text-xs font-semibold text-navy">{stateLabel(draft.state)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"><span>New <strong className="text-navy">{summary.new}</strong></span><span>Updates <strong className="text-navy">{summary.update}</strong></span><span>Duplicates <strong className="text-navy">{summary.duplicate}</strong></span><span>Review <strong className="text-navy">{summary.reviewRequired}</strong></span><span>Invalid <strong className="text-navy">{summary.invalid}</strong></span></div>
            {draft.state === "review_required" ? <p className="mt-3 w-full rounded border border-amber-300/70 bg-amber-50/60 p-3 text-sm text-amber-950" data-ui-copy="body">This package cannot be imported yet. Resolve the invalid, duplicate, or identity-review rows in a replacement package. No records were changed.</p> : null}
            {draft.state === "applied" ? <p className="mt-3 w-full text-sm text-black/65" data-ui-copy="body">Imported {dateTime(draft.appliedAt)}. The retained receipt preserves the package lineage.</p> : null}
            {draft.state === "ready_for_operator" ? <div className="mt-3 border-t border-border-brand pt-3">
              <label className="flex w-full items-start gap-2 text-sm text-black/75"><input type="checkbox" className="mt-1" checked={Boolean(reviewed[draft.draftId])} onChange={(event) => setReviewed((current) => ({ ...current, [draft.draftId]: event.target.checked }))} /><span>I reviewed this staged package and want the server to revalidate and import it.</span></label>
              <button type="button" onClick={() => void apply(draft.draftId)} disabled={!canApply} className="mt-3 rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-45">{busy === draft.draftId ? "Revalidating and importing" : "Import staged package"}</button>
              {!canApply ? <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Import is disabled until you confirm this exact package. The server stops if its ledger review changed.</p> : null}
            </div> : null}
          </article>;
        })}
      </div>
    </section>
  );
}
