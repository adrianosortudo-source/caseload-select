"use client";

import { useMemo, useRef, useState } from "react";

type EvidenceIssue = { sourceRecordKey: string; message: string };
type EvidenceSummary = { identityMappings: number; downtownGeography: number; websiteIntakeFindings: number; qualificationAssessments: number; reviewRequired: number };
type Review = { sourceSha256: string; packageId: string | null; summary: EvidenceSummary; rejected: EvidenceIssue[] };

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function evidenceSourceName(filename: string | null): string {
  const basename = (filename ?? "supplemental-prospect-evidence")
    .replace(/\.json$/i, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return basename || "supplemental-prospect-evidence";
}

function asIssues(value: unknown): EvidenceIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [{ sourceRecordKey: `item ${index + 1}`, message: "Evidence item was rejected." }];
    const raw = item as Record<string, unknown>;
    return [{ sourceRecordKey: typeof raw.sourceRecordKey === "string" ? raw.sourceRecordKey : typeof raw.path === "string" ? raw.path : `item ${index + 1}`, message: typeof raw.message === "string" ? raw.message : "Evidence item was rejected." }];
  });
}

function asSummary(value: unknown): EvidenceSummary {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const count = (key: string) => typeof raw[key] === "number" ? raw[key] : 0;
  return {
    identityMappings: count("identityMappings"),
    downtownGeography: count("downtownGeography"),
    websiteIntakeFindings: count("websiteIntakeFindings"),
    qualificationAssessments: count("qualificationAssessments"),
    reviewRequired: count("reviewRequired"),
  };
}

export default function SupplementalEvidenceImport({ onImported }: { onImported?: () => void }) {
  const [draft, setDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [packagePayload, setPackagePayload] = useState<Record<string, unknown> | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"review" | "apply" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const sourceName = evidenceSourceName(selectedFile?.name ?? null);
  const sourceLabel = selectedFile ? selectedFile.name : draft.trim() ? "Pasted JSON package" : "No package selected";
  const canApply = Boolean(review && packagePayload && review.rejected.length === 0 && review.summary.reviewRequired === 0 && confirmed && !busy);
  const sections = useMemo(() => review ? [
    ["Shared identity", review.summary.identityMappings],
    ["Downtown geometry", review.summary.downtownGeography],
    ["Website and intake", review.summary.websiteIntakeFindings],
    ["Qualification", review.summary.qualificationAssessments],
  ] as const : [], [review]);

  function clearReview() { setReview(null); setPackagePayload(null); setReceipt(null); setConfirmed(false); setError(null); }

  async function chooseFile(file: File | null) {
    setSelectedFile(file); clearReview();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError("This file is larger than the 2 MB review limit."); return; }
    try { setDraft(await file.text()); } catch { setError("The selected file could not be read."); }
  }

  async function requestReview() {
    setBusy("review"); clearReview();
    try {
      const parsed: unknown = JSON.parse(draft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The supplemental evidence package must be one JSON object, not a CSV or array.");
      const payload = parsed as Record<string, unknown>;
      setPackagePayload(payload);
      const response = await fetch("/admin/prospects/evidence-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName, payload }) });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The server could not review this evidence package.");
      if (typeof body.sourceSha256 !== "string") throw new Error("The server did not return an evidence-package fingerprint.");
      setReview({ sourceSha256: body.sourceSha256, packageId: typeof body.packageId === "string" ? body.packageId : null, summary: asSummary(body.summary), rejected: asIssues(body.rejected) });
    } catch (cause) {
      setPackagePayload(null);
      setError(cause instanceof Error ? cause.message : "This evidence package could not be prepared for review.");
    } finally { setBusy(null); }
  }

  async function apply() {
    if (!review || !packagePayload || !canApply) return;
    setBusy("apply"); setError(null);
    try {
      const response = await fetch("/admin/prospects/evidence-import", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName, sourceSha256: review.sourceSha256, payload: packagePayload }) });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The reviewed evidence package could not be applied.");
      setReceipt(typeof body.sourceSha256 === "string" ? body.sourceSha256 : review.sourceSha256);
      setConfirmed(false);
      onImported?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The reviewed evidence package could not be applied."); }
    finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="supplemental-evidence-import-heading" className="rounded-lg border border-border-brand bg-white p-4 sm:p-5 [&_[data-ui-copy]]:text-pretty" data-ui-component-content="supplemental-evidence-import">
      <p className="w-full text-xs font-semibold uppercase tracking-wider text-gold-on-light" data-ui-copy="supporting">Evidence intake</p>
      <h2 id="supplemental-evidence-import-heading" className="mt-1 w-full text-xl font-bold text-navy" data-ui-copy="heading">Add reviewed prospect evidence</h2>
      <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">Use the strict JSON package to add dated, source-linked evidence to firms already in the prospect ledger. This supplements records; it never creates a separate list, sends outreach, or activates a website channel.</p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="block w-full rounded border border-dashed border-border-brand bg-parchment/30 p-3 text-sm text-black/70">
          <span className="block w-full font-semibold text-navy">Choose a JSON evidence package</span>
          <input ref={input} type="file" accept=".json,application/json" className="mt-2 block w-full text-sm" onChange={(event) => void chooseFile(event.currentTarget.files?.[0] ?? null)} />
          <span className="mt-2 block w-full text-xs leading-5 text-black/55">JSON only, up to 2 MB. The package references existing source record keys and retains its evidence sources.</span>
        </label>
        <label className="block w-full text-xs font-semibold text-field-label">Or paste a JSON evidence package
          <textarea value={draft} onChange={(event) => { setDraft(event.target.value); setSelectedFile(null); clearReview(); }} className="mt-1 min-h-36 w-full rounded border border-border-brand px-3 py-2 font-mono text-xs leading-5 text-black" placeholder='{"schemaVersion":"1.0.0", ...}' spellCheck={false} />
        </label>
      </div>
      <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Source: {sourceLabel}</p>
      {error ? <p className="mt-3 w-full rounded border border-red-fail/30 bg-red-50 p-3 text-sm text-red-fail" role="alert" data-ui-copy="body">{error}</p> : null}

      <div className="mt-4 rounded border border-border-brand bg-parchment/30 p-3" data-ui-component-content="supplemental-evidence-import-review">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Step 1: Server review</p>
        <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">The protected review checks the full package, source records, identity gates, and evidence fields. It does not write a prospect, contact, assessment, or outreach action.</p>
        <button type="button" onClick={() => void requestReview()} disabled={busy !== null || !draft.trim()} className="mt-3 rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-45">{busy === "review" ? "Reviewing package" : "Review evidence package"}</button>
      </div>

      <div className="mt-4" data-ui-component-content="supplemental-evidence-import-summary">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Review result</p>
        {review ? <>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Evidence import review counts">{sections.map(([label, count]) => <div key={label} className="rounded border border-border-brand bg-parchment/45 p-3"><span className="block text-xs font-semibold uppercase tracking-wide text-field-label">{label}</span><strong className="mt-1 block text-xl text-navy">{count}</strong></div>)}</div>
          <p className="mt-3 w-full break-all text-xs text-black/55" data-ui-copy="supporting">{review.packageId ? <>Package ID: {review.packageId}<br /></> : null}Package fingerprint: {review.sourceSha256}</p>
          {review.rejected.length > 0 ? <details className="mt-3 rounded border border-amber-300/70 bg-amber-50/60 p-3"><summary className="cursor-pointer text-sm font-semibold text-amber-950">{review.rejected.length} evidence item{review.rejected.length === 1 ? "" : "s"} need correction</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{review.rejected.map((issue, index) => <li key={`${issue.sourceRecordKey}-${index}`}><strong>{issue.sourceRecordKey}:</strong> {issue.message}</li>)}</ul></details> : null}
          {review.summary.reviewRequired > 0 ? <p className="mt-3 w-full rounded border border-amber-300/70 bg-amber-50/60 p-3 text-sm text-amber-950" data-ui-copy="body">Evidence marked for review cannot be applied. Resolve it in the source package and run a fresh server review. Nothing has changed.</p> : null}
        </> : <p className="mt-2 w-full rounded border border-dashed border-border-brand bg-parchment/30 p-3 text-sm text-black/60" data-ui-copy="body">Section counts and the package fingerprint appear after protected server review.</p>}
      </div>

      <div className="mt-4 rounded border border-border-brand bg-parchment/30 p-3" data-ui-component-content="supplemental-evidence-import-confirmation">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Step 2: Confirm evidence record</p>
        <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">Only a valid, reviewed package with no unresolved evidence can be recorded. A confirmed record remains evidence, not permission to contact a person or use a website intake channel.</p>
        <label className="mt-3 flex w-full items-start gap-2 text-sm text-black/75"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!review || review.rejected.length > 0 || review.summary.reviewRequired > 0} className="mt-1" /><span>I reviewed this source-linked evidence package and want to record only the server-approved evidence.</span></label>
        <button type="button" onClick={() => void apply()} disabled={!canApply} className="mt-3 rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-45">{busy === "apply" ? "Recording reviewed evidence" : "Record reviewed evidence"}</button>
        {!canApply ? <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Recording remains disabled until every invalid or review-needed item is resolved and this confirmation is checked. The server reviews the exact package again before it writes.</p> : null}
      </div>

      {receipt ? <p className="mt-4 w-full rounded border border-green-800/25 bg-green-50 p-3 text-sm text-green-900" role="status" data-ui-copy="body">Evidence package recorded with fingerprint {receipt}. The prospect list can now display the source-linked findings.</p> : null}
    </section>
  );
}
