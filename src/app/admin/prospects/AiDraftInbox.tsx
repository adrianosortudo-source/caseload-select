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
type ReviewManifest = { draftId: string; reviewSha256: string; recordCount: number; records: RecordDetail[] };
const RECORDS_PER_PAGE = 20;

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
  const [manifests, setManifests] = useState<Record<string, ReviewManifest>>({});
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestBusy, setManifestBusy] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<RecordDetail | null>(null);
  const [recordPage, setRecordPage] = useState<Record<string, number>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/admin/prospects/agent-drafts", { signal, headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({})) as { drafts?: unknown; error?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The AI draft inbox could not be loaded.");
      setDrafts(Array.isArray(payload.drafts) ? payload.drafts.filter(isDraft) : []);
      setReviewed({});
      setManifests({}); setSelectedRecord(null); setRecordPage({});
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

  async function loadManifest(draft: Draft) {
    if (manifestBusy) return;
    setManifestBusy(draft.draftId); setManifestError(null);
    try {
      const response = await fetch(`/admin/prospects/agent-drafts/${encodeURIComponent(draft.draftId)}/review`, { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({})) as { manifest?: unknown; error?: unknown };
      const manifest = payload.manifest as ReviewManifest | undefined;
      if (!response.ok || !manifest || typeof manifest !== "object" || manifest.draftId !== draft.draftId
        || typeof manifest.reviewSha256 !== "string" || manifest.recordCount !== draft.review.records.length
        || !Array.isArray(manifest.records) || manifest.records.length !== draft.review.records.length
        || !manifest.records.every((record) => record?.draftId === draft.draftId && record.reviewSha256 === manifest.reviewSha256)
        || new Set(manifest.records.map((record) => record.sourceRecordKey)).size !== draft.review.records.length
        || !manifest.records.every((record) => draft.review.records.some((review) => review.sourceRecordKey === record.sourceRecordKey))) {
        throw new Error(typeof payload.error === "string" ? payload.error : "The complete staged package review could not be loaded.");
      }
      setManifests((current) => ({ ...current, [draft.draftId]: manifest }));
      setSelectedRecord(null); setRecordPage((current) => ({ ...current, [draft.draftId]: 0 }));
      setReviewed((current) => current[draft.draftId] === manifest.reviewSha256 ? current : { ...current, [draft.draftId]: "" });
    } catch (cause) { setManifests((current) => { const next = { ...current }; delete next[draft.draftId]; return next; }); setSelectedRecord(null); setManifestError(cause instanceof Error ? cause.message : "The complete staged package review could not be loaded."); }
    finally { setManifestBusy(null); }
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
          const manifest = manifests[draft.draftId];
          const currentPage = recordPage[draft.draftId] ?? 0;
          const pageCount = manifest ? Math.max(1, Math.ceil(manifest.records.length / RECORDS_PER_PAGE)) : 0;
          const visibleRecords = manifest?.records.slice(currentPage * RECORDS_PER_PAGE, (currentPage + 1) * RECORDS_PER_PAGE) ?? [];
          const canApply = draft.state === "ready_for_operator" && Boolean(manifest)
            && manifest?.draftId === draft.draftId && manifest?.reviewSha256 === reviewed[draft.draftId] && !busy;
          return <article key={draft.draftId} className="rounded border border-border-brand bg-parchment/20 p-3 sm:p-4" data-ui-component-content="ai-draft-inbox-row">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="w-full break-words font-semibold text-navy" data-ui-copy="heading">{draft.sourceName}</h3>
                <p className="mt-1 w-full text-xs text-black/55" data-ui-copy="supporting">Submitted by {draft.submittedBy} on {dateTime(draft.createdAt)}. {draft.recordCount} record{draft.recordCount === 1 ? "" : "s"}. Payload receipt <code className="break-all">{draft.payloadSha256}</code>.</p>
              </div>
              <span className="rounded-full border border-border-brand bg-white px-2 py-1 text-xs font-semibold text-navy">{stateLabel(draft.state)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"><span>New <strong className="text-navy">{summary.new}</strong></span><span>Updates <strong className="text-navy">{summary.update}</strong></span><span>Duplicates <strong className="text-navy">{summary.duplicate}</strong></span><span>Review <strong className="text-navy">{summary.reviewRequired}</strong></span><span>Invalid <strong className="text-navy">{summary.invalid}</strong></span></div>
            <details className="mt-3 border-t border-border-brand pt-3">
              <summary className="cursor-pointer text-sm font-semibold text-navy">Review complete staged package ({draft.review.records.length} records)</summary>
              <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Load the complete bounded manifest before acknowledgement. It contains each review row, while excluding raw package data, CRM data, and outreach.</p>
              {!manifest ? <button type="button" onClick={() => void loadManifest(draft)} disabled={manifestBusy === draft.draftId} className="mt-2 rounded border border-navy px-2 py-1 text-xs font-semibold text-navy disabled:opacity-45">{manifestBusy === draft.draftId ? "Loading complete review" : `Load complete review (${draft.review.records.length} records)`}</button> : null}
              {manifest ? <>
                <p className="mt-2 w-full text-xs text-black/60" data-ui-copy="supporting">Loaded all {manifest.records.length} record{manifest.records.length === 1 ? "" : "s"} for receipt {manifest.reviewSha256.slice(0, 16)}... Page {currentPage + 1} of {pageCount} makes every row accessible.</p>
                <div className="mt-2 space-y-2">
                  {visibleRecords.map((record) => <div key={record.sourceRecordKey} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-brand bg-white p-2 text-sm">
                    <span className="min-w-0 break-words text-black/75">{record.sourceRecordKey}: {record.disposition}</span>
                    <button type="button" onClick={() => setSelectedRecord(record)} className="rounded border border-navy px-2 py-1 text-xs font-semibold text-navy">Review record</button>
                  </div>)}
                </div>
                {pageCount > 1 ? <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setRecordPage((current) => ({ ...current, [draft.draftId]: Math.max(0, currentPage - 1) }))} disabled={currentPage === 0} className="rounded border border-navy px-2 py-1 text-xs font-semibold text-navy disabled:opacity-45">Previous page</button><button type="button" onClick={() => setRecordPage((current) => ({ ...current, [draft.draftId]: Math.min(pageCount - 1, currentPage + 1) }))} disabled={currentPage >= pageCount - 1} className="rounded border border-navy px-2 py-1 text-xs font-semibold text-navy disabled:opacity-45">Next page</button></div> : null}
              </> : null}
            </details>
            {selectedRecord?.draftId === draft.draftId ? <section className="mt-3 rounded border border-gold/50 bg-white p-3" aria-label="Staged record review" data-ui-component-content="ai-draft-record-review">
              <h4 className="w-full font-semibold text-navy" data-ui-copy="heading">{selectedRecord.firmName ?? selectedRecord.sourceRecordKey}</h4>
              <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">{selectedRecord.disposition}: {selectedRecord.reason}</p>
              <p className="mt-2 w-full text-xs text-black/60" data-ui-copy="supporting">{selectedRecord.city ?? "City not supplied"} · {selectedRecord.observedLawyerCountDisplay ?? (selectedRecord.observedLawyerCount === null ? "Lawyer count not supplied" : `${selectedRecord.observedLawyerCount} lawyers`)} · {selectedRecord.reconciliationStatus ?? "Reconciliation status not supplied"}</p>
              {selectedRecord.evidence.length ? <ul className="mt-2 w-full space-y-1 text-xs text-black/65">{selectedRecord.evidence.map((evidence) => <li key={`${evidence.type}:${evidence.sourceUrl}`}><a className="break-all text-navy underline" href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.type} evidence</a> observed {evidence.observedOn}{evidence.value ? `: ${evidence.value}` : ""}</li>)}</ul> : <p className="mt-2 w-full text-xs text-black/55">No validated evidence is available for this record.</p>}
              {selectedRecord.publicContacts.length ? <ul className="mt-2 w-full space-y-1 text-xs text-black/65">{selectedRecord.publicContacts.map((contact) => <li key={`${contact.email ?? contact.name}:${contact.sourceUrl}`}><span className="font-semibold text-navy">{contact.name ?? "Published firm contact"}</span>{contact.email ? ` · ${contact.email}` : ""} · {contact.relationship}/{contact.emailKind} · <a className="break-all text-navy underline" href={contact.sourceUrl} target="_blank" rel="noreferrer">source</a> observed {contact.observedAt}</li>)}</ul> : <p className="mt-2 w-full text-xs text-black/55">No source-attributed public owner or email evidence is available for this record.</p>}
            </section> : null}
            {manifestError ? <p className="mt-3 w-full text-sm text-red-fail" role="alert">{manifestError}</p> : null}
            {draft.state === "review_required" ? <p className="mt-3 w-full rounded border border-amber-300/70 bg-amber-50/60 p-3 text-sm text-amber-950" data-ui-copy="body">This package cannot be imported yet. Resolve the invalid, duplicate, or identity-review rows in a replacement package. No records were changed.</p> : null}
            {draft.state === "applied" ? <p className="mt-3 w-full text-sm text-black/65" data-ui-copy="body">Imported {dateTime(draft.appliedAt)}. The retained receipt preserves the package lineage.</p> : null}
            {draft.state === "ready_for_operator" ? <div className="mt-3 border-t border-border-brand pt-3">
              <label className="flex w-full items-start gap-2 text-sm text-black/75"><input type="checkbox" className="mt-1" disabled={!manifest || manifest.draftId !== draft.draftId} checked={reviewed[draft.draftId] === manifest?.reviewSha256} onChange={(event) => setReviewed((current) => ({ ...current, [draft.draftId]: event.target.checked && manifest?.draftId === draft.draftId ? manifest.reviewSha256 : "" }))} /><span>I reviewed this complete staged package and acknowledge this exact review receipt before import.</span></label>
              <button type="button" onClick={() => void apply(draft.draftId)} disabled={!canApply} className="mt-3 rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-45">{busy === draft.draftId ? "Revalidating and importing" : "Import staged package"}</button>
              {!canApply ? <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Load the complete bounded manifest, review every accessible row, and acknowledge its exact receipt. The server stops if its ledger review changed.</p> : null}
            </div> : null}
          </article>;
        })}
      </div>
    </section>
  );
}
