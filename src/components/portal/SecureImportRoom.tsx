"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  CLIENT_IMPORT_TEMPLATE_VERSION,
  parseClientImportCsv,
  type ClientImportIssue,
  type ClientImportRow,
} from "@/lib/client-import-csv";

type Counts = {
  processed: number;
  created: number;
  existing: number;
  held: number;
  invalid: number;
  failed: number;
  reconcile: number;
};

const EMPTY_COUNTS: Counts = { processed: 0, created: 0, existing: 0, held: 0, invalid: 0, failed: 0, reconcile: 0 };
const RESUME_STORAGE_VERSION = "v1";

type ResumeState = {
  batchId: string;
  fileHash: string;
  rowCount: number;
  resumeIndex: number;
  counts?: Counts;
};

function resumeStorageKey(firmId: string): string {
  return `secure-import:${RESUME_STORAGE_VERSION}:${firmId}`;
}

function loadResumeState(firmId: string): ResumeState | null {
  try {
    const value = localStorage.getItem(resumeStorageKey(firmId));
    return value ? (JSON.parse(value) as ResumeState) : null;
  } catch {
    return null;
  }
}

function saveResumeState(firmId: string, state: ResumeState): void {
  try {
    localStorage.setItem(resumeStorageKey(firmId), JSON.stringify(state));
  } catch {
    // Resumability is best-effort; import authorization and idempotency stay server-side.
  }
}

function clearResumeState(firmId: string): void {
  try {
    localStorage.removeItem(resumeStorageKey(firmId));
  } catch {
    // Disabled storage must not prevent a securely authorized import.
  }
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function jsonPost(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({ error: "invalid_response" }))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "request_failed");
  return payload;
}

export default function SecureImportRoom({
  firmId,
  readOnly,
  enabled,
  maxRows,
  trustGuide,
}: {
  firmId: string;
  readOnly: boolean;
  enabled: boolean;
  maxRows: number;
  trustGuide: ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState("");
  const [rows, setRows] = useState<ClientImportRow[]>([]);
  const [issues, setIssues] = useState<ClientImportIssue[]>([]);
  const [attested, setAttested] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [batchId, setBatchId] = useState("");
  const [resumeIndex, setResumeIndex] = useState(0);
  const [resumeReady, setResumeReady] = useState(false);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [status, setStatus] = useState<"prepare" | "authorize" | "importing" | "results">("prepare");

  const suppressedCount = useMemo(
    () => rows.filter((row) => row.marketingPermission === "unknown" || row.marketingPermission === "no_contact").length,
    [rows],
  );
  const controlsDisabled = readOnly || !enabled || busy;

  async function chooseFile(selected: File | null) {
    setError("");
    setIssues([]);
    setRows([]);
    setFile(null);
    setFileHash("");
    setBatchId("");
    setResumeIndex(0);
    setResumeReady(false);
    setCounts(EMPTY_COUNTS);
    setStatus("prepare");
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      setIssues([{ rowNumber: 1, field: "file", message: "Choose the CaseLoad Select CSV template." }]);
      return;
    }
    const text = await selected.text();
    const parsed = parseClientImportCsv(text, { byteLength: selected.size, maxRows });
    setIssues(parsed.issues);
    if (!parsed.ok) return;
    const hash = await sha256Hex(selected);
    setFile(selected);
    setRows(parsed.rows);
    setFileHash(hash);
    try {
      const saved = loadResumeState(firmId);
      if (saved?.batchId && saved.fileHash === hash && saved.rowCount === parsed.rows.length) {
        setBatchId(saved.batchId);
        setResumeIndex(Number(saved.resumeIndex ?? 0));
        setCounts(saved.counts ?? EMPTY_COUNTS);
        setResumeReady(true);
        setStatus("importing");
      }
    } catch {
      clearResumeState(firmId);
    }
  }

  async function requestCode() {
    if (!file || !rows.length || !attested) return;
    setBusy(true);
    setError("");
    try {
      const payload = await jsonPost(`/api/portal/${firmId}/client-imports/step-up/request`, {});
      setChallengeId(String(payload.challengeId));
      setSentTo(String(payload.sentTo));
      setStatus("authorize");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "authorization_failed");
    } finally {
      setBusy(false);
    }
  }

  async function authorizeAndImport() {
    if (!file || !challengeId || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError("");
    try {
      await jsonPost(`/api/portal/${firmId}/client-imports/step-up/verify`, { challengeId, code, attested });
      const start = await jsonPost(`/api/portal/${firmId}/client-imports`, {
        challengeId,
        fileSha256: fileHash,
        fileByteCount: file.size,
        rowCount: rows.length,
        templateVersion: CLIENT_IMPORT_TEMPLATE_VERSION,
      });
      const newBatchId = String(start.batchId);
      setBatchId(newBatchId);
      saveResumeState(firmId, { batchId: newBatchId, fileHash, rowCount: rows.length, resumeIndex: 0 });
      setStatus("importing");
      await runChunks(newBatchId, 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "import_failed");
    } finally {
      setBusy(false);
    }
  }

  async function runChunks(targetBatchId: string, startIndex: number) {
    for (let index = startIndex; index < rows.length; index += 25) {
      const payload = await jsonPost(`/api/portal/${firmId}/client-imports/${targetBatchId}/rows`, {
        rows: rows.slice(index, index + 25),
      });
      const nextCounts = payload.counts as Counts;
      setCounts(nextCounts);
      const chunkOutcomes = Array.isArray(payload.outcomes)
        ? payload.outcomes as Array<{ status?: unknown }>
        : [];
      if (chunkOutcomes.some((outcome) => outcome.status === "processing")) {
        setResumeIndex(index);
        saveResumeState(firmId, { batchId: targetBatchId, fileHash, rowCount: rows.length, resumeIndex: index, counts: nextCounts });
        throw new Error("rows_still_processing");
      }
      setResumeIndex(index + 25);
      saveResumeState(firmId, { batchId: targetBatchId, fileHash, rowCount: rows.length, resumeIndex: index + 25, counts: nextCounts });
    }
    clearResumeState(firmId);
    setResumeReady(false);
    setStatus("results");
  }

  async function retryImport() {
    if (!batchId) return;
    setBusy(true);
    setError("");
    try {
      await runChunks(batchId, resumeIndex);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "import_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="readable-prose space-y-6">
      <header>
        <p className="font-display text-[0.72rem] uppercase tracking-[0.14em] text-[color:var(--portal-accent)]">Clients / Secure import</p>
        <h1 className="measure-heading mt-2 text-3xl font-extrabold text-navy">Secure Import Room</h1>
        <p className="mt-2 text-sm leading-6 text-black/60">
          Validate your firm&apos;s relationship database in this browser, then authorize a protected import into your firm&apos;s CRM.
        </p>
      </header>

      <div className="grid gap-px border border-black/10 bg-black/10 sm:grid-cols-3" aria-label="Import safeguards">
        {["Raw file is never uploaded", "Messaging begins suppressed", "Existing contacts are not overwritten"].map((item) => (
          <div key={item} className="bg-white px-4 py-3 text-sm font-semibold text-navy">{item}</div>
        ))}
      </div>

      {readOnly && (
        <div className="border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-navy">
          <p>Support preview is read-only. An authorized firm lawyer or administrator must authorize and run the import.</p>
        </div>
      )}
      {!enabled && !readOnly && (
        <div className="border border-black/15 bg-white px-4 py-3 text-sm text-black/65">
          <p>Secure importing is installed but not activated for this firm. Contact CaseLoad Select to complete the location-level safety check.</p>
        </div>
      )}

      <section className="border border-gold-on-light bg-highlight p-5 sm:p-6" aria-labelledby="prepare-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-navy">Prepare</p>
            <h2 id="prepare-heading" className="measure-heading mt-1 text-xl font-bold text-navy">Select the completed relationship import CSV</h2>
            <p id="prepare-description" className="mt-2 text-sm leading-6 text-black/60">
              The check happens in this browser. You will review the row count, suppression state and any corrections before authorization.
            </p>
          </div>
          <a href="/templates/caseload-select-relationship-import.csv" download className="shrink-0 text-sm font-bold text-navy underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2">
            Download CSV template
          </a>
        </div>
        <label className="mt-5 block text-sm font-bold text-navy" htmlFor="relationship-import-file">CSV file</label>
        <input
          id="relationship-import-file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby="prepare-description import-file-requirements"
          disabled={controlsDisabled}
          onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
          className="mt-2 block min-w-0 max-w-full border border-black/20 bg-white px-3 py-3 text-sm outline-none file:mr-4 file:border-0 file:bg-navy file:px-4 file:py-2 file:font-bold file:text-white focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 disabled:opacity-50"
        />
        <p id="import-file-requirements" className="mt-2 text-xs leading-5 text-black/65">
          CSV only, up to 5 MB and {maxRows.toLocaleString()} contacts. Use the template headers exactly as shown above.
        </p>
      </section>

      {(rows.length > 0 || issues.length > 0) && (
        <section className="border border-black/10 bg-white p-5 sm:p-6" aria-labelledby="check-heading">
          <p className="font-display text-[0.68rem] uppercase tracking-[0.14em] text-field-label">Check</p>
          <h2 id="check-heading" className="measure-heading mt-1 text-xl font-bold text-navy">Review before authorization</h2>
          {rows.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-px bg-black/10 sm:grid-cols-4">
              <Summary label="Ready" value={rows.length} />
              <Summary label="Suppressed" value={suppressedCount} />
              <Summary label="Possible duplicates" value="Checked during import" />
              <Summary label="Original file stored" value="No" />
            </div>
          )}
          {issues.length > 0 && (
            <div className="mt-4 border border-red-300 bg-red-50 p-4" role="alert">
              <p className="font-bold text-red-900">Correct these items before continuing</p>
              <ul className="mt-2 space-y-1 text-sm text-red-900">
                {issues.slice(0, 25).map((issue, index) => (
                  <li key={`${issue.rowNumber}-${issue.field}-${index}`}>Row {issue.rowNumber}: {issue.message}</li>
                ))}
              </ul>
            </div>
          )}
          {rows.length > 0 && (
            <label className="mt-5 flex items-start gap-3 border border-black/10 bg-parchment p-4 text-sm leading-6 text-navy">
              <input type="checkbox" checked={attested} disabled={controlsDisabled} onChange={(event) => setAttested(event.target.checked)} className="mt-1 outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2" />
              <span className="measure-readable">
                I am authorized by this firm to import this relationship database. I understand that importing a contact does not authorize marketing or client communications.
              </span>
            </label>
          )}
          {status === "prepare" && rows.length > 0 && (
            <button type="button" onClick={() => void requestCode()} disabled={controlsDisabled || !attested} className="mt-5 bg-navy px-5 py-3 text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? "Sending code..." : "Send authorization code"}
            </button>
          )}
        </section>
      )}

      {status === "authorize" && (
        <section className="border border-black/10 bg-white p-5 sm:p-6" aria-labelledby="authorize-heading">
          <p className="font-display text-[0.68rem] uppercase tracking-[0.14em] text-field-label">Authorize</p>
          <h2 id="authorize-heading" className="measure-heading mt-1 text-xl font-bold text-navy">Confirm this sensitive action</h2>
          <p className="mt-2 text-sm text-black/60">Enter the six-digit code sent to {sentTo}.</p>
          <label htmlFor="secure-import-code" className="mt-4 block text-sm font-bold text-navy">Authorization code</label>
          <input id="secure-import-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-2 w-48 max-w-full border border-black/20 bg-parchment px-3 py-3 text-lg tracking-[0.3em] outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2" />
          <button type="button" onClick={() => void authorizeAndImport()} disabled={busy || code.length !== 6} className="mt-4 block bg-navy px-5 py-3 text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 disabled:opacity-40">
            {busy ? "Starting securely..." : "Authorize and start import"}
          </button>
        </section>
      )}

      {(status === "importing" || status === "results") && (
        <section className="border border-black/10 bg-white p-5 sm:p-6" aria-labelledby="import-status-heading">
          <p className="font-display text-[0.68rem] uppercase tracking-[0.14em] text-field-label">{status === "results" ? "Results" : "Import"}</p>
          <h2 id="import-status-heading" className="measure-heading mt-1 text-xl font-bold text-navy">{status === "results" ? "Import receipt" : "Creating held contact records"}</h2>
          <p className="mt-2 break-words text-sm text-black/60" role="status" aria-live="polite" aria-atomic="true">
            Processed {counts.processed} of {rows.length}. Batch {batchId || "preparing"}.
          </p>
          <progress
            className="mt-3 h-2 w-full accent-navy"
            aria-label="Import progress"
            max={Math.max(rows.length, 1)}
            value={Math.min(counts.processed, rows.length)}
          />
          <div className="mt-4 grid grid-cols-2 gap-px bg-black/10 sm:grid-cols-5">
            <Summary label="Created" value={counts.created} />
            <Summary label="Existing, unchanged" value={counts.existing} />
            <Summary label="Held for review" value={counts.held} />
            <Summary label="Invalid / failed" value={counts.invalid + counts.failed} />
            <Summary label="Require reconciliation" value={counts.reconcile} />
          </div>
          {resumeReady && status === "importing" && (
            <button type="button" onClick={() => void retryImport()} disabled={busy} className="mt-5 bg-navy px-5 py-3 text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 disabled:opacity-40">
              {busy ? "Resuming..." : "Resume this verified batch"}
            </button>
          )}
        </section>
      )}

      {error && (
        <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          <p className="break-words">Import paused: {error.replaceAll("_", " ")}. No uncertain row will be created again without a fresh duplicate check.</p>
          {batchId && status === "importing" && (
            <button type="button" onClick={() => void retryImport()} disabled={busy} className="mt-3 border border-red-900 px-4 py-2 font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-900 focus-visible:ring-offset-2 disabled:opacity-40">
              {busy ? "Resuming..." : "Resume import"}
            </button>
          )}
        </div>
      )}

      {trustGuide}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="bg-parchment px-4 py-3"
      data-readable-measure-exception="compact import summary data"
    >
      <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-field-label">{label}</p>
      <p className="mt-1 break-words text-lg font-extrabold text-navy">{value}</p>
    </div>
  );
}
