"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ImportRecord = Record<string, unknown>;

type ImportIssue = {
  sourceRecordKey: string;
  message: string;
};

type ImportSummary = {
  newRecords: number;
  updates: number;
  duplicates: number;
  reviewRequired: number;
  invalid: number;
};

type ImportPreview = {
  sourceSha256: string;
  accepted: number;
  rejected: ImportIssue[];
  summary: ImportSummary;
};

type ImportReceipt = {
  id: string;
  recordedAt: string;
  inserted: number;
  updated: number;
  duplicates: number;
};

type ImportHistoryRow = {
  id: string;
  sourceName: string;
  sourceSha256: string;
  recordCount: number;
  state: string;
  appliedAt: string | null;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 2_000;

const TEMPLATE_HEADERS = [
  "id", "firmName", "city", "officeCities", "websiteUrl", "practiceAreas",
  "observedLawyerCount", "observedLawyerCountQualifier", "observedLawyerCountDisplay",
  "rosterSourceUrl", "rosterCheckedAt", "reconciliationStatus", "legacyClusterLawyerCount",
  "legacyCrosswalk", "reconciliationNote", "advertisingEvidence", "advertisingSourceUrl",
  "gbpEvidence", "gbpSourceUrl", "publicContacts",
] as const;

const TEMPLATE_ROW = [
  "gta-example-firm", "Example Law LLP", "Toronto", "Toronto|Mississauga", "https://example.com/", "Business law|Real estate",
  "4", "exact", "4 lawyers listed", "https://example.com/team", "2026-09-11", "new_pending_identity", "", "", "Public roster reviewed.", "unknown", "", "unknown", "", "[]",
] as const;

function cleanCell(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted value.");
  if (value.length > 0 || row.length > 0) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((row) => row.some((cell) => cell.trim() !== ""));
}

function parseCsv(input: string): ImportRecord[] {
  const rows = csvRows(input);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one prospect row.");
  const headers = rows[0].map((header) => header.trim());
  const missing = ["id", "firmName", "city", "officeCities", "practiceAreas", "rosterSourceUrl", "rosterCheckedAt", "reconciliationStatus"].filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`The CSV is missing required columns: ${missing.join(", ")}.`);
  return rows.slice(1).map((cells) => {
    const raw = Object.fromEntries(headers.map((header, index) => [header, cleanCell(cells[index] ?? "")]));
    const publicContacts = raw.publicContacts ? JSON.parse(String(raw.publicContacts)) : [];
    const fields: ImportRecord = {
      id: raw.id,
      firmName: raw.firmName,
      city: raw.city,
      officeCities: String(raw.officeCities ?? "").split("|").map((item) => item.trim()).filter(Boolean),
      websiteUrl: raw.websiteUrl,
      practiceAreas: String(raw.practiceAreas ?? "").split("|").map((item) => item.trim()).filter(Boolean),
      observedLawyerCount: raw.observedLawyerCount === null ? null : Number(raw.observedLawyerCount),
      observedLawyerCountQualifier: raw.observedLawyerCountQualifier,
      observedLawyerCountDisplay: raw.observedLawyerCountDisplay,
      rosterSourceUrl: raw.rosterSourceUrl,
      rosterCheckedAt: raw.rosterCheckedAt,
      reconciliationStatus: raw.reconciliationStatus,
      legacyClusterLawyerCount: raw.legacyClusterLawyerCount === null ? null : Number(raw.legacyClusterLawyerCount),
      legacyCrosswalk: raw.legacyCrosswalk,
      reconciliationNote: raw.reconciliationNote,
      advertisingEvidence: raw.advertisingEvidence ?? "unknown",
      advertisingSourceUrl: raw.advertisingSourceUrl,
      gbpEvidence: raw.gbpEvidence ?? "unknown",
      gbpSourceUrl: raw.gbpSourceUrl,
      publicContacts,
    };
    return fields;
  });
}

function parseInput(input: string, filename: string | null): ImportRecord[] {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Paste a JSON package or choose a CSV or JSON file.");
  const isCsv = filename?.toLowerCase().endsWith(".csv") || (!filename && !trimmed.startsWith("{") && !trimmed.startsWith("["));
  if (isCsv) return parseCsv(trimmed);
  const parsed: unknown = JSON.parse(trimmed);
  const records = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records) ? (parsed as { records: unknown[] }).records : null;
  if (!records) throw new Error("JSON must be an array of records or an object with a records array.");
  return records as ImportRecord[];
}

function toIssues(value: unknown): ImportIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (Array.isArray(item)) return item.map((issue) => ({ sourceRecordKey: typeof issue?.sourceRecordKey === "string" ? issue.sourceRecordKey : `row ${index + 1}`, message: typeof issue?.message === "string" ? issue.message : "Record was rejected." }));
    if (item && typeof item === "object") return [{ sourceRecordKey: typeof (item as { sourceRecordKey?: unknown }).sourceRecordKey === "string" ? (item as { sourceRecordKey: string }).sourceRecordKey : `row ${index + 1}`, message: typeof (item as { message?: unknown }).message === "string" ? (item as { message: string }).message : "Record was rejected." }];
    return [{ sourceRecordKey: `row ${index + 1}`, message: "Record was rejected." }];
  });
}

function summaryFrom(payload: Record<string, unknown>, accepted: number, rejected: ImportIssue[]): ImportSummary {
  const raw = payload.summary && typeof payload.summary === "object" ? payload.summary as Record<string, unknown> : {};
  const number = (key: string, fallback = 0) => typeof raw[key] === "number" ? raw[key] : fallback;
  return {
    newRecords: number("new", number("newRecords", accepted)),
    updates: number("updates"),
    duplicates: number("duplicates"),
    reviewRequired: number("reviewRequired", number("review_required")),
    invalid: number("invalid", rejected.length),
  };
}

function downloadTemplate() {
  const escape = (value: string) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const text = [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.map(escape).join(",")].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  link.download = "gta-prospect-import-template.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function importSourceName(filename: string | null): string {
  const basename = (filename ?? "pasted-gta-prospects")
    .replace(/\.(?:csv|json)$/i, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return basename || "pasted-gta-prospects";
}

function dateTime(value: string | null): string {
  if (!value) return "Not applied";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function stateLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function GtaProspectImport({ onImported }: { onImported?: () => void }) {
  const [draft, setDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [records, setRecords] = useState<ImportRecord[] | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [history, setHistory] = useState<ImportHistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"validate" | "apply" | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const sourceName = importSourceName(selectedFile?.name ?? null);
  const sourceLabel = selectedFile ? selectedFile.name : draft.trim() ? "Pasted package" : "No package selected";
  const canApply = Boolean(preview && records && preview.accepted > 0 && preview.rejected.length === 0 && preview.summary.reviewRequired === 0 && reviewed && !busy);
  const counts = useMemo(() => preview ? [
    ["New", preview.summary.newRecords], ["Updates", preview.summary.updates], ["Duplicates", preview.summary.duplicates], ["Review needed", preview.summary.reviewRequired], ["Invalid", preview.summary.invalid],
  ] as const : [], [preview]);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/admin/prospects/research-import", { signal, headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({})) as { error?: unknown; history?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Import history could not be loaded.");
      const rows = Array.isArray(payload.history) ? payload.history : [];
      setHistory(rows.slice(0, 10).flatMap((row): ImportHistoryRow[] => {
        if (!row || typeof row !== "object") return [];
        const item = row as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.sourceName !== "string" || typeof item.sourceSha256 !== "string" || typeof item.recordCount !== "number" || typeof item.state !== "string") return [];
        return [{ id: item.id, sourceName: item.sourceName, sourceSha256: item.sourceSha256, recordCount: item.recordCount, state: item.state, appliedAt: typeof item.appliedAt === "string" ? item.appliedAt : null }];
      }));
      setHistoryError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setHistory(null);
      setHistoryError(cause instanceof Error ? cause.message : "Import history could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory]);

  async function useFile(file: File | null) {
    setSelectedFile(file);
    setPreview(null); setReceipt(null); setRecords(null); setReviewed(false); setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError("This file is larger than the 2 MB review limit."); return; }
    try { setDraft(await file.text()); } catch { setError("The selected file could not be read."); }
  }

  async function validate() {
    setBusy("validate"); setError(null); setPreview(null); setReceipt(null); setReviewed(false);
    try {
      const parsed = parseInput(draft, selectedFile?.name ?? null);
      if (parsed.length > MAX_RECORDS) throw new Error(`Review no more than ${MAX_RECORDS.toLocaleString("en-CA")} records at once.`);
      setRecords(parsed);
      const response = await fetch("/admin/prospects/research-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName, records: parsed }) });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The server could not validate this package.");
      const rejected = toIssues(payload.rejected);
      const accepted = typeof payload.accepted === "number" ? payload.accepted : Math.max(0, parsed.length - rejected.length);
      if (typeof payload.sourceSha256 !== "string") throw new Error("The server did not return a package fingerprint.");
      setPreview({ sourceSha256: payload.sourceSha256, accepted, rejected, summary: summaryFrom(payload, accepted, rejected) });
    } catch (cause) {
      setRecords(null);
      setError(cause instanceof Error ? cause.message : "This package could not be prepared for review.");
    } finally { setBusy(null); }
  }

  async function apply() {
    if (!preview || !records || !canApply) return;
    setBusy("apply"); setError(null);
    try {
      const response = await fetch("/admin/prospects/research-import", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName, sourceSha256: preview.sourceSha256, records }) });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The reviewed package could not be imported.");
      const receipts = Array.isArray(payload.receipts) ? payload.receipts.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
      const countState = (state: string) => receipts.filter((item) => item.state === state).length;
      setReceipt({
        id: typeof payload.sourceSha256 === "string" ? payload.sourceSha256 : preview.sourceSha256,
        recordedAt: new Date().toISOString(),
        inserted: countState("created"),
        updated: countState("updated"),
        duplicates: countState("already_present") + countState("already_applied"),
      });
      setReviewed(false);
      await loadHistory();
      onImported?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The reviewed package could not be imported."); }
    finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="gta-prospect-import-heading" className="rounded-lg border border-border-brand bg-white p-4 sm:p-5 [&_[data-ui-copy]]:text-pretty" data-ui-component-content="gta-prospect-import">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="w-full text-xs font-semibold uppercase tracking-wider text-gold-on-light" data-ui-copy="supporting">Research data intake</p>
          <h2 id="gta-prospect-import-heading" className="mt-1 w-full text-xl font-bold text-navy" data-ui-copy="heading">Add reviewed GTA prospects</h2>
          <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">Upload a standard CSV or JSON package, inspect the protected server review, then explicitly confirm the import. Public owner and email evidence remains source-attributed information, not outreach permission.</p>
        </div>
        <button type="button" onClick={downloadTemplate} className="shrink-0 rounded border border-navy px-3 py-2 text-sm font-semibold text-navy hover:bg-navy hover:text-white">Download CSV template</button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="block w-full rounded border border-dashed border-border-brand bg-parchment/30 p-3 text-sm text-black/70">
          <span className="block w-full font-semibold text-navy">Choose a CSV or JSON package</span>
          <input ref={fileInput} type="file" accept=".csv,text/csv,.json,application/json" className="mt-2 block w-full text-sm" onChange={(event) => void useFile(event.currentTarget.files?.[0] ?? null)} />
          <span className="mt-2 block w-full text-xs leading-5 text-black/55">Up to 2 MB and 2,000 records. CSV uses pipe-separated cities and practice areas; public contacts are JSON in one cell.</span>
        </label>
        <label className="block w-full text-xs font-semibold text-field-label">Or paste a JSON package
          <textarea value={draft} onChange={(event) => { setDraft(event.target.value); setSelectedFile(null); setPreview(null); setReceipt(null); setReviewed(false); setError(null); }} className="mt-1 min-h-36 w-full rounded border border-border-brand px-3 py-2 font-mono text-xs leading-5 text-black" placeholder='{"records":[...]}' spellCheck={false} />
        </label>
      </div>
      <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Source: {sourceLabel}{records ? ` · ${records.length} parsed record${records.length === 1 ? "" : "s"}` : ""}</p>
      {error && <p className="mt-3 w-full rounded border border-red-fail/30 bg-red-50 p-3 text-sm text-red-fail" role="alert" data-ui-copy="body">{error}</p>}

      <div className="mt-4 rounded border border-border-brand bg-parchment/30 p-3" data-ui-component-content="gta-prospect-import-review">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Step 1: Server review</p>
        <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">Validation checks the source package and returns a fingerprint. It does not create or change a prospect record.</p>
        <button type="button" onClick={() => void validate()} disabled={busy !== null || !draft.trim()} className="mt-3 rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-45">{busy === "validate" ? "Reviewing package" : "Review package"}</button>
      </div>

      <div className="mt-4" data-ui-component-content="gta-prospect-import-summary">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Review result</p>
        {preview ? <>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Prospect import review counts">{counts.map(([label, count]) => <div key={label} className="rounded border border-border-brand bg-parchment/45 p-3"><span className="block text-xs font-semibold uppercase tracking-wide text-field-label">{label}</span><strong className="mt-1 block text-xl text-navy">{count}</strong></div>)}</div>
          <p className="mt-3 w-full break-all text-xs text-black/55" data-ui-copy="supporting">Package fingerprint: {preview.sourceSha256}</p>
          {preview.rejected.length > 0 && <details className="mt-3 rounded border border-amber-300/70 bg-amber-50/60 p-3"><summary className="cursor-pointer text-sm font-semibold text-amber-950">{preview.rejected.length} record{preview.rejected.length === 1 ? "" : "s"} need correction</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{preview.rejected.map((issue, index) => <li key={`${issue.sourceRecordKey}-${index}`}><strong>{issue.sourceRecordKey}:</strong> {issue.message}</li>)}</ul></details>}
          {preview.summary.reviewRequired > 0 && <p className="mt-3 w-full rounded border border-amber-300/70 bg-amber-50/60 p-3 text-sm text-amber-950" data-ui-copy="body">Records marked for identity review cannot be imported. Resolve them in the source package, then request a fresh server review. No records were changed.</p>}
        </> : <p className="mt-2 w-full rounded border border-dashed border-border-brand bg-parchment/30 p-3 text-sm text-black/60" data-ui-copy="body">Review counts appear after the protected server validates a package.</p>}
      </div>

      <div className="mt-4 rounded border border-border-brand bg-parchment/30 p-3" data-ui-component-content="gta-prospect-import-confirmation">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Step 2: Confirm import</p>
        <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">Only a valid, server-tokenized package with no invalid rows can be imported. Duplicate and identity-review classifications stay visible in the receipt and do not authorize contact or outreach.</p>
        <label className="mt-3 flex w-full items-start gap-2 text-sm text-black/75"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} disabled={!preview || preview.rejected.length > 0 || preview.summary.reviewRequired > 0} className="mt-1" /><span>I reviewed this package and want to import only the server-approved records.</span></label>
        <button type="button" onClick={() => void apply()} disabled={!canApply} className="mt-3 rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-45">{busy === "apply" ? "Importing reviewed records" : "Import reviewed records"}</button>
        {!canApply && <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Import stays disabled until every invalid or identity-review row is resolved and this confirmation is checked. The server recalculates the review before it writes anything.</p>}
      </div>

      <div className="mt-4 rounded border border-border-brand bg-white p-3" data-ui-component-content="gta-prospect-import-history">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Latest import receipt</p>
        {receipt ? <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">Receipt {receipt.id} was recorded {dateTime(receipt.recordedAt)}. {receipt.inserted} new record{receipt.inserted === 1 ? "" : "s"}, {receipt.updated} update{receipt.updated === 1 ? "" : "s"}, and {receipt.duplicates} duplicate{receipt.duplicates === 1 ? "" : "s"} retained for traceability.</p> : <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">No import receipt is available in this session. A confirmed import will appear here and in the operator import history.</p>}
        <div className="mt-4 border-t border-border-brand pt-3" data-ui-component-content="gta-prospect-import-history-list">
          <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Recent import history</p>
          {history === null && !historyError ? <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">Loading the last 10 import receipts...</p> : null}
          {historyError ? <p className="mt-2 w-full rounded border border-red-fail/30 bg-red-50 p-3 text-sm text-red-fail" role="status" data-ui-copy="body">Import history is unavailable: {historyError}</p> : null}
          {history && history.length === 0 ? <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">No import batches have been recorded yet.</p> : null}
          {history && history.length > 0 ? <div className="mt-2 overflow-x-auto rounded border border-border-brand"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-parchment/45 text-xs uppercase tracking-wide text-field-label"><tr><th className="px-3 py-2">Source</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Records</th><th className="px-3 py-2">Applied</th></tr></thead><tbody>{history.map((row) => <tr key={row.id} className="border-t border-border-brand align-top"><td className="px-3 py-2"><span className="block font-semibold text-navy">{row.sourceName}</span><span className="mt-1 block break-all text-xs text-black/55">{row.sourceSha256}</span></td><td className="px-3 py-2 text-black/70">{stateLabel(row.state)}</td><td className="px-3 py-2 text-black/70">{row.recordCount}</td><td className="px-3 py-2 text-black/70">{dateTime(row.appliedAt)}</td></tr>)}</tbody></table></div> : null}
        </div>
      </div>
    </section>
  );
}
