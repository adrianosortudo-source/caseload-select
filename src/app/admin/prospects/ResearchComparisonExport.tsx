"use client";

import { useState } from "react";
import { prepareResearchComparisonUpload, researchComparisonEndpoint, verifyResearchComparisonResponse, type ResearchComparisonMode } from "@/lib/prospect-enrichment-comparison-upload";
import { readResearchResponse } from "./ResearchEvidence";

export default function ResearchComparisonExport({ sourceRunKey }: { sourceRunKey?: string }) {
  const [mode, setMode] = useState<ResearchComparisonMode>(sourceRunKey ? "finalized" : "bootstrap");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [status, setStatus] = useState<string | null>(null);
  async function exportSnapshot(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      const upload = await prepareResearchComparisonUpload(file, sourceRunKey);
      const response = await fetch(researchComparisonEndpoint(mode), { method: "POST", headers: upload.headers, body: upload.body, cache: "no-store", credentials: "same-origin" });
      const result = await readResearchResponse<Record<string, unknown>>(response);
      verifyResearchComparisonResponse(result, mode, upload.requestSha256);
      const blob = new Blob([JSON.stringify(result, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `prospect-enrichment-comparison-${upload.runId}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Authenticated Admin read-back finished. Save the downloaded comparison in the private run folder.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Admin could not verify the comparison request."); }
    finally { setBusy(false); }
  }
  return <section className="min-w-0" aria-label="Export authenticated comparison" data-ui-component-content="research-comparison-export">
    <h3 className="text-base font-semibold text-navy" data-ui-copy="heading">Verify research against Admin</h3>
    <p className="mt-2 text-sm" data-ui-copy="body">Upload the complete private comparison request. Admin reads current records and signs a snapshot without changing prospect records.</p>
    <p className="mt-1 text-pretty text-sm" data-ui-copy="supporting">Use an initial check before registering a new run, or a finalized check after its inventory is registered.</p>
    <label className="mt-3 block text-sm font-semibold" htmlFor="prospect-comparison-mode">Comparison stage</label>
    <select id="prospect-comparison-mode" className="mt-2 block w-full min-w-0 rounded-md border border-border-brand p-2 text-sm" value={mode} disabled={busy} onChange={(event) => { setMode(event.currentTarget.value as ResearchComparisonMode); setError(null); setStatus(null); }}>
      <option value="bootstrap">Initial or resumed inventory check</option><option value="finalized">Finalized registered inventory check</option>
    </select>
    <label className="mt-3 block text-sm font-semibold" htmlFor="prospect-comparison-request">Private comparison request JSON or JSON.gz</label>
    <input id="prospect-comparison-request" className="mt-2 block w-full min-w-0 text-sm" type="file" accept="application/json,application/gzip,.json,.json.gz" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; void exportSnapshot(file); event.currentTarget.value = ""; }} />
    <p className="mt-2 text-sm" data-ui-copy="supporting">JSON limit: 16 MB. Gzip limit: 4 MB compressed and 32 MB decoded. Larger inventories need complete bounded child runs.</p>
    {busy && <p role="status" className="mt-2 text-sm" data-ui-copy="supporting">Reading the complete Admin comparison…</p>}
    {status && <p role="status" className="mt-2 text-sm" data-ui-copy="supporting">{status}</p>}
    {error && <p role="alert" className="mt-2 text-sm" data-ui-copy="supporting">{error}</p>}
  </section>;
}
