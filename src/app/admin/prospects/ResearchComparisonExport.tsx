"use client";

import { useEffect, useState } from "react";
import { prepareResearchComparisonUpload, researchComparisonEndpoint, verifyResearchComparisonResponse, type ResearchComparisonMode } from "@/lib/prospect-enrichment-comparison-upload";
import { readResearchResponse } from "./ResearchEvidence";

export default function ResearchComparisonExport({ sourceRunKey }: { sourceRunKey?: string }) {
  const [mode, setMode] = useState<ResearchComparisonMode>(sourceRunKey ? "finalized" : "bootstrap");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [status, setStatus] = useState<string | null>(null);
  const [download, setDownload] = useState<{ href: string; filename: string } | null>(null);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.href); }, [download]);
  async function exportSnapshot(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null); setStatus(null); setDownload(null);
    try {
      const upload = await prepareResearchComparisonUpload(file, sourceRunKey);
      const response = await fetch(researchComparisonEndpoint(mode), { method: "POST", headers: upload.headers, body: upload.body, cache: "no-store", credentials: "same-origin" });
      const result = await readResearchResponse<Record<string, unknown>>(response);
      verifyResearchComparisonResponse(result, mode, upload.requestSha256);
      const blob = new Blob([JSON.stringify(result, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob), filename = `prospect-enrichment-comparison-${upload.runId}.json`;
      setDownload({ href: url, filename });
      setStatus("Admin read-back finished.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Admin could not verify the comparison request."); }
    finally { setBusy(false); }
  }
  return <section className="min-w-0" aria-label="Export authenticated comparison" data-ui-component-content="research-comparison-export">
    <h3 className="text-base font-semibold text-navy" data-ui-copy="heading">Check Admin research</h3>
    <div className="mt-2 space-y-1">
      <p className="text-sm" data-ui-copy="body">Upload the complete private file.</p>
      <p className="text-sm" data-ui-copy="body">Admin signs a read-only snapshot.</p>
    </div>
    <ul className="mt-2 space-y-1 text-sm">
      <li data-ui-copy="supporting">Initial: before registration.</li>
      <li data-ui-copy="supporting">Finalized: after registration.</li>
    </ul>
    <label className="mt-3 block text-sm font-semibold" htmlFor="prospect-comparison-mode">Comparison stage</label>
    <select id="prospect-comparison-mode" className="mt-2 block w-full min-w-0 rounded-md border border-border-brand p-2 text-sm" value={mode} disabled={busy} onChange={(event) => { setMode(event.currentTarget.value as ResearchComparisonMode); setError(null); setStatus(null); }}>
      <option value="bootstrap">Initial or resumed inventory check</option><option value="finalized">Finalized registered inventory check</option>
    </select>
    <label className="mt-3 block text-sm font-semibold" htmlFor="prospect-comparison-request">Private comparison request JSON or JSON.gz</label>
    <input id="prospect-comparison-request" className="mt-2 block w-full min-w-0 text-sm" type="file" accept="application/json,application/gzip,.json,.json.gz" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; void exportSnapshot(file); event.currentTarget.value = ""; }} />
    <ul className="mt-2 space-y-1 text-sm">
      <li data-ui-copy="supporting">JSON: 16 MiB maximum.</li>
      <li data-ui-copy="supporting">Gzip: 4 MiB compressed.</li>
      <li data-ui-copy="supporting">Decoded gzip: 32 MiB maximum.</li>
      <li data-ui-copy="supporting">Split into complete child runs.</li>
    </ul>
    {busy && <p role="status" className="mt-2 text-sm" data-ui-copy="supporting">Reading Admin records…</p>}
    {status && <div role="status" className="mt-2 space-y-1 text-sm"><p data-ui-copy="supporting">{status}</p>{download && <a className="inline-block rounded-md border border-border-brand px-3 py-2 font-semibold text-navy underline" href={download.href} download={download.filename}>Download signed comparison</a>}<p data-ui-copy="supporting">Save the download with this run.</p></div>}
    {error && <p role="alert" className="mt-2 text-sm" data-ui-copy="supporting">{error}</p>}
  </section>;
}
