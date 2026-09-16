"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyProspectDataChanged } from "./prospect-data-events";

type Summary = { received: number; eligibleForApply: number; new: number; update: number; duplicate: number; reviewRequired: number; invalid: number };
type Draft = {
  draftId: string; sourceName: string; submittedBy: string; payloadSha256: string; recordCount: number;
  review: { summary: Summary; records: { sourceRecordKey: string; disposition: string; reason: string }[] };
  state: "ready_for_operator" | "review_required" | "applied"; createdAt: string; appliedAt: string | null;
};
type RecordDetail = {
  draftId: string; sourceRecordKey: string; firmName: string | null; city: string | null; officeCities: string[];
  websiteUrl: string | null; practiceAreas: string[]; observedLawyerCount: number | null;
  observedLawyerCountQualifier: string | null; observedLawyerCountDisplay: string | null; reconciliationStatus: string | null;
  reviewSha256: string; disposition: string; reason: string; evidence: { type: string; sourceUrl: string; observedOn: string; value: string | null }[];
  publicContacts: { name: string | null; email: string | null; relationship: string; emailKind: string; sourceUrl: string; observedAt: string }[];
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
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<RecordDetail | null>(null);
  const [recordDetailError, setRecordDetailError] = useState<string | null>(null);
  const [recordDetailBusy, setRecordDetailBusy] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/admin/prospects/agent-drafts", { signal, headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({})) as { drafts?: unknown; error?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The AI draft inbox could not be loaded.");
      setDrafts(Array.isArray(payload.drafts) ? payload.drafts.filter(isDraft) : []);
      setReviewed({});
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
      const response = await fetch("/admin/prospects/agent-drafts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId, reviewSha256: reviewed[draftId] }) });
      const payload = await response.json().catch(() => ({})) as { error?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The staged package could not be imported.");
      setReviewed((current) => { const next = { ...current }; delete next[draftId]; return next; });
      await load();
      notifyProspectDataChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The staged package could not be imported."); }
    finally { setBusy(null); }
  }

  async function inspectRecord(draftId: string, sourceRecordKey: string) {
    const key = `${draftId}:${sourceRecordKey}`;
    if (recordDetailBusy) return;
    setRecordDetailBusy(key); setRecordDetailError(null);
    try {
      const response = await fetch(`/admin/prospects/agent-drafts/${encodeURIComponent(draftId)}/records/${encodeURIComponent(sourceRecordKey)}`, { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({})) as { record?: unknown; error?: unknown };
      if (!response.ok || !payload.record || typeof payload.record !== "object") throw new Error(typeof payload.error === "string" ? payload.error : "The staged record could not be loaded.");
      const detail = payload.record as RecordDetail;
      setRecordDetail(detail);
      setReviewed((current) => current[draftId] === detail.reviewSha256 ? current : { ...current, [draftId]: "" });
    } catch (cause) { setRecordDetail(null); setRecordDetailError(cause instanceof Error ? cause.message : "The staged record could not be loaded."); }
    finally { setRecordDetailBusy(null); }
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
          const canApply = draft.state === "ready_for_operator" && reviewed[draft.draftId] === recordDetail?.reviewSha256 && recordDetail?.draftId === draft.draftId && !busy;
          return <article key={draft.draftId} className="rounded border border-border-brand bg-parchment/20 p-3 sm:p-4" data-ui-component-content="ai-draft-inbox-row">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="w-full break-words font-semibold text-navy" data-ui-copy="heading">{draft.sourceName}</h3>
                <p className="mt-1 w-full text-xs text-black/55" data-ui-copy="supporting">Submitted by {draft.submittedBy} on {dateTime(draft.createdAt)}. {draft.recordCount} record{draft.recordCount === 1 ? "" : "s"}. Receipt {draft.payloadSha256.slice(0, 16)}...</p>
              </div>
              <span className="rounded-full border border-border-brand bg-white px-2 py-1 text-xs font-semibold text-navy">{stateLabel(draft.state)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"><span>New <strong className="text-navy">{summary.new}</strong></span><span>Updates <strong className="text-navy">{summary.update}</strong></span><span>Duplicates <strong className="text-navy">{summary.duplicate}</strong></span><span>Review <strong className="text-navy">{summary.reviewRequired}</strong></span><span>Invalid <strong className="text-navy">{summary.invalid}</strong></span></div>
            <details className="mt-3 border-t border-border-brand pt-3">
              <summary className="cursor-pointer text-sm font-semibold text-navy">Review staged records ({Math.min(draft.review.records.length, 20)} of {draft.review.records.length})</summary>
              <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Each view is limited to one public-evidence record. Contacts, raw package data, CRM data, and outreach are excluded.</p>
              <div className="mt-2 space-y-2">
                {draft.review.records.slice(0, 20).map((record) => <div key={record.sourceRecordKey} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-brand bg-white p-2 text-sm">
                  <span className="min-w-0 break-words text-black/75">{record.sourceRecordKey}: {record.disposition}</span>
                  <button type="button" onClick={() => void inspectRecord(draft.draftId, record.sourceRecordKey)} disabled={Boolean(recordDetailBusy)} className="rounded border border-navy px-2 py-1 text-xs font-semibold text-navy disabled:opacity-45">{recordDetailBusy === `${draft.draftId}:${record.sourceRecordKey}` ? "Loading" : "Review record"}</button>
                </div>)}
              </div>
            </details>
            {recordDetail?.draftId === draft.draftId ? <section className="mt-3 rounded border border-gold/50 bg-white p-3" aria-label="Staged record review" data-ui-component-content="ai-draft-record-review">
              <h4 className="w-full font-semibold text-navy" data-ui-copy="heading">{recordDetail.firmName ?? recordDetail.sourceRecordKey}</h4>
              <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">{recordDetail.disposition}: {recordDetail.reason}</p>
              <p className="mt-2 w-full text-xs text-black/60" data-ui-copy="supporting">{recordDetail.city ?? "City not supplied"} · {recordDetail.observedLawyerCountDisplay ?? (recordDetail.observedLawyerCount === null ? "Lawyer count not supplied" : `${recordDetail.observedLawyerCount} lawyers`)} · {recordDetail.reconciliationStatus ?? "Reconciliation status not supplied"}</p>
              {recordDetail.evidence.length ? <ul className="mt-2 w-full space-y-1 text-xs text-black/65">{recordDetail.evidence.map((evidence) => <li key={`${evidence.type}:${evidence.sourceUrl}`}><a className="break-all text-navy underline" href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.type} evidence</a> observed {evidence.observedOn}{evidence.value ? `: ${evidence.value}` : ""}</li>)}</ul> : <p className="mt-2 w-full text-xs text-black/55">No validated evidence is available for this record.</p>}
              {recordDetail.publicContacts.length ? <ul className="mt-2 w-full space-y-1 text-xs text-black/65">{recordDetail.publicContacts.map((contact) => <li key={`${contact.email ?? contact.name}:${contact.sourceUrl}`}><span className="font-semibold text-navy">{contact.name ?? "Published firm contact"}</span>{contact.email ? ` · ${contact.email}` : ""} · {contact.relationship}/{contact.emailKind} · <a className="break-all text-navy underline" href={contact.sourceUrl} target="_blank" rel="noreferrer">source</a> observed {contact.observedAt}</li>)}</ul> : <p className="mt-2 w-full text-xs text-black/55">No source-attributed public owner or email evidence is available for this record.</p>}
            </section> : null}
            {recordDetailError ? <p className="mt-3 w-full text-sm text-red-fail" role="alert">{recordDetailError}</p> : null}
            {draft.state === "review_required" ? <p className="mt-3 w-full rounded border border-amber-300/70 bg-amber-50/60 p-3 text-sm text-amber-950" data-ui-copy="body">This package cannot be imported yet. Resolve the invalid, duplicate, or identity-review rows in a replacement package. No records were changed.</p> : null}
            {draft.state === "applied" ? <p className="mt-3 w-full text-sm text-black/65" data-ui-copy="body">Imported {dateTime(draft.appliedAt)}. The retained receipt preserves the package lineage.</p> : null}
            {draft.state === "ready_for_operator" ? <div className="mt-3 border-t border-border-brand pt-3">
              <label className="flex w-full items-start gap-2 text-sm text-black/75"><input type="checkbox" className="mt-1" disabled={recordDetail?.draftId !== draft.draftId} checked={reviewed[draft.draftId] === recordDetail?.reviewSha256} onChange={(event) => setReviewed((current) => ({ ...current, [draft.draftId]: event.target.checked && recordDetail?.draftId === draft.draftId ? recordDetail.reviewSha256 : "" }))} /><span>I reviewed the loaded record detail and acknowledge this exact review receipt before import.</span></label>
              <button type="button" onClick={() => void apply(draft.draftId)} disabled={!canApply} className="mt-3 rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-45">{busy === draft.draftId ? "Revalidating and importing" : "Import staged package"}</button>
              {!canApply ? <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Open one staged record, review the bounded evidence, and acknowledge its receipt. Import remains disabled if the server review changes.</p> : null}
            </div> : null}
          </article>;
        })}
      </div>
    </section>
  );
}
