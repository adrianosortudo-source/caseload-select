"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ResearchError, ResearchJson, ResearchPanel, readResearchResponse, researchButton } from "./ResearchEvidence";
import type { ResearchPackageSummary } from "./ResearchInbox";

export type ResearchRunSummary = Readonly<{ runId: string; sourceRunKey: string; runName: string; candidates: number; packages: number; awaitingReview: number; applied: number; researchVisible: number; canonicalVisibilityVerified: number; needsAttention: number }>;
export type ResearchRunItemDisposition = Readonly<{ clientItemId: string; itemKind: string; sourceEventKey: string; semanticSha256: string; itemId: string | null; actualSemanticSha256: string | null; disposition: "pending" | "accept_new" | "link_existing" | "retain_only"; reason: string | null; targets: readonly unknown[] }>;
export type ResearchRunEntry = Readonly<{
  entryId: string; researchKey: string | null; clientPackageId: string | null; expectedPayloadSha256: string | null; itemCount: number;
  clientItems: readonly Readonly<{ clientItemId: string; itemKind: string; sourceEventKey: string; semanticSha256: string }>[];
  initialDisposition: "ready_for_review" | "identity_hold" | "evidence_hold" | "hold_schema" | "source_root_unavailable" | "source_read_failed" | "source_changed_during_snapshot" | "reference_out_of_scope" | "reference_provenance_only" | "provenance_only";
  source: Readonly<{ sourceRoot: string | null; relativePath: string; sourcePointer: string; fileSha256: string | null }>; errorCodes: readonly string[];
  heldEvidenceSha256: string | null; heldEvidence: Readonly<{ evidenceSha256: string; original: unknown; issues: readonly Readonly<{ code: string; path: string; reason: string }>[] }> | null;
  packageId: string | null; actualPayloadSha256: string | null; packageState: string | null;
  reconciliationState: "missing_package" | "hash_mismatch" | "staged" | "rejected" | "applied" | "superseded" | "source_hold" | "retained_source_context";
  packageVisibilityVerified: boolean; canonicalVisibilityVerified: boolean; items: readonly ResearchRunItemDisposition[];
}>;
export type ResearchRunReconciliation = Readonly<{ inventoryState: "complete" | "incomplete" | "missing"; manifestSha256: string | null; sourceManifestSha256: string | null; expectedEntryCount: number; receivedEntryCount: number; expectedPackageCount: number; receivedPackageCount: number; stagedPackageCount: number; missingPackageCount: number; payloadMismatchCount: number; researchKeyMismatchCount: number; orphanPackageCount: number; entries: readonly ResearchRunEntry[]; nextEntryCursor: string | null }>;
export type ResearchRunDetail = Readonly<{ summary: ResearchRunSummary; packages: readonly ResearchPackageSummary[]; nextCursor: string | null; reconciliation: ResearchRunReconciliation }>;

function ComparisonExport({ sourceRunKey }: { sourceRunKey: string }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [status, setStatus] = useState<string | null>(null);
  async function exportSnapshot(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("The private comparison request is larger than 16 MB.");
      const body = await file.text();
      const request = JSON.parse(body) as { schemaVersion?: unknown; manifest?: { runId?: unknown } };
      if (request.schemaVersion !== "prospect-enrichment-comparison-request/v1" || request.manifest?.runId !== sourceRunKey) throw new Error("Choose the complete comparison request for this exact run.");
      const response = await fetch("/api/admin/prospect-enrichment/comparison-export", { method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store" });
      const result = await readResearchResponse<Record<string, unknown>>(response);
      const signature = result.signature as { algorithm?: unknown; keyId?: unknown; signatureBase64?: unknown } | undefined;
      if (result.schemaVersion !== "prospect-enrichment-comparison/v1" || result.projectId !== "ssxryjxifwiivghglqer" || typeof result.snapshotSha256 !== "string" || signature?.algorithm !== "Ed25519" || typeof signature.keyId !== "string" || typeof signature.signatureBase64 !== "string") throw new Error("Admin returned an incomplete or unsigned comparison snapshot.");
      const blob = new Blob([JSON.stringify(result, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `prospect-enrichment-comparison-${sourceRunKey}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Authenticated Admin read-back finished. The comparison file was downloaded for the private run folder.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Admin could not verify the comparison request."); }
    finally { setBusy(false); }
  }
  return <section className="min-w-0 rounded-md border border-border-brand bg-white p-4" aria-label="Export authenticated comparison">
    <h3 className="text-base font-semibold text-navy">Verify this run against Admin</h3>
    <p className="mt-2 text-sm">Select the private comparison request generated for this exact run. Admin checks its finalized inventory, reads current records and signs the returned snapshot; this check does not import or change prospect records.</p>
    <p className="mt-1 text-sm">The request is processed in memory by the authenticated Admin page and is not saved as a database record.</p>
    <label className="mt-3 block text-sm font-semibold" htmlFor="prospect-comparison-request">Private comparison request JSON</label>
    <input id="prospect-comparison-request" className="mt-2 block w-full min-w-0 text-sm" type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; void exportSnapshot(file); event.currentTarget.value = ""; }} />
    {busy && <p role="status" className="mt-2 text-sm">Reading the complete Admin comparison…</p>}
    {status && <p role="status" className="mt-2 text-sm">{status}</p>}
    {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
  </section>;
}


function RunInventory({ value, loading, more }: { value: ResearchRunReconciliation; loading: boolean; more: (cursor: string) => void }) {
  const labels: Record<ResearchRunEntry["reconciliationState"], string> = { missing_package: "Expected package missing", hash_mismatch: "Package hash mismatch", staged: "Package staged", rejected: "Submission rejected", applied: "Evidence applied", superseded: "Package superseded", source_hold: "Source held", retained_source_context: "Source context retained" };
  return <section className="min-w-0 space-y-3" aria-label="Expected run entries">
    <h3 className="text-base font-semibold text-navy">Every expected entry</h3>
    <p className="text-sm">{value.receivedEntryCount} of {value.expectedEntryCount} inventory entries and {value.receivedPackageCount} of {value.expectedPackageCount} package entries registered. Admin has {value.stagedPackageCount} staged packages.</p>
    {value.inventoryState !== "complete" && <ResearchError message={`Run reconciliation is incomplete: ${value.missingPackageCount} missing packages, ${value.payloadMismatchCount} payload mismatches, ${value.researchKeyMismatchCount} research identity mismatches, ${value.orphanPackageCount} unlisted packages.`} />}
    {value.entries.map((entry) => <article key={entry.entryId} className="min-w-0 rounded-md border border-border-brand p-3">
      <h4 className="break-all text-sm font-semibold">{entry.clientPackageId ?? entry.researchKey ?? entry.entryId}</h4>
      <p className="mt-2 text-sm">{labels[entry.reconciliationState]}. Initial disposition: {entry.initialDisposition.replace(/_/g, " ")}.</p>
      <p className="mt-1 text-sm">Research visibility: {entry.packageVisibilityVerified ? "Verified" : "Pending"}. Canonical visibility: {entry.canonicalVisibilityVerified ? "Verified" : "Pending"}.</p>
      {entry.packageId && <Link className="mt-2 inline-block text-sm text-navy underline" href={"/admin/prospects/research-packages/" + entry.packageId}>Open expected package</Link>}
      {entry.errorCodes.length > 0 && <ResearchJson value={entry.errorCodes} />}
      {entry.heldEvidenceSha256 && !entry.heldEvidence && <ResearchError message="Held candidate source evidence is not available in Admin." />}
      {entry.heldEvidence && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Original held candidate and gaps ({entry.heldEvidence.issues.length} issues)</summary><div className="mt-3 space-y-3"><p className="text-sm">Evidence hash verified: {entry.heldEvidence.evidenceSha256}</p><h5 className="text-sm font-semibold">Original source candidate</h5><ResearchJson value={entry.heldEvidence.original} /><h5 className="text-sm font-semibold">Issue codes, paths and reasons</h5><ResearchJson value={entry.heldEvidence.issues} /></div></details>}
      <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Every item disposition ({entry.items.length} of {entry.itemCount})</summary>
        <div className="mt-3 space-y-3">{entry.items.map((item) => <div className="min-w-0 rounded-md bg-parchment p-3" key={item.clientItemId}><p className="break-all text-xs font-semibold">{item.clientItemId}</p><p className="mt-1 text-sm">{item.itemKind}: {item.disposition.replace(/_/g, " ")}{item.reason ? ". " + item.reason : ""}</p><ResearchJson value={item} /></div>)}</div>
      </details>
      <details className="mt-3"><summary className="cursor-pointer text-sm">Source, hashes and original inventory</summary><div className="mt-3"><ResearchJson value={{ entryId: entry.entryId, researchKey: entry.researchKey, source: entry.source, expectedPayloadSha256: entry.expectedPayloadSha256, actualPayloadSha256: entry.actualPayloadSha256, clientItems: entry.clientItems }} /></div></details>
    </article>)}
    {value.nextEntryCursor && <button type="button" className={researchButton} disabled={loading} onClick={() => more(value.nextEntryCursor!)}>Load more expected entries</button>}
    <details><summary className="cursor-pointer text-sm">Manifest identity</summary><ResearchJson value={{ manifestSha256: value.manifestSha256, sourceManifestSha256: value.sourceManifestSha256 }} /></details>
  </section>;
}

export default function ResearchRunList({ runId, initialData }: { runId?: string; initialData?: readonly ResearchRunSummary[] }) {
  const [runs, setRuns] = useState<readonly ResearchRunSummary[]>(initialData ?? []); const [detail, setDetail] = useState<ResearchRunDetail | null>(null); const [nextCursor, setCursor] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(!initialData);
  const load = useCallback(async (cursor?: string, signal?: AbortSignal, entryCursor?: string) => {
    setLoading(true);
    try { const params = new URLSearchParams({ limit: "25" }); if (cursor) params.set("cursor", cursor); if (entryCursor) params.set("entryCursor", entryCursor); const response = await fetch(`/api/admin/prospect-enrichment/runs${runId ? `/${encodeURIComponent(runId)}` : ""}?${params}`, { cache: "no-store", signal });
      if (runId) { const result = await readResearchResponse<ResearchRunDetail>(response, "run"); if (!result.summary || !Array.isArray(result.packages) || !result.reconciliation || !Array.isArray(result.reconciliation.entries)) throw new Error("The research run response was incomplete."); setDetail((current) => current && (cursor || entryCursor) ? { ...result, packages: cursor ? [...current.packages, ...result.packages] : current.packages, reconciliation: { ...result.reconciliation, entries: entryCursor ? [...current.reconciliation.entries, ...result.reconciliation.entries] : current.reconciliation.entries } } : result); setRuns([result.summary]); setCursor(result.nextCursor); }
      else { const result = await readResearchResponse<{ runs: ResearchRunSummary[]; nextCursor: string | null }>(response); if (!Array.isArray(result.runs)) throw new Error("The research runs response was incomplete."); setRuns((current) => cursor ? [...current, ...result.runs] : result.runs); setCursor(result.nextCursor); } setError(null);
    } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Research runs could not be loaded."); } finally { setLoading(false); }
  }, [runId]);
  useEffect(() => { if (initialData) return; const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(undefined, controller.signal); }); return () => controller.abort(); }, [initialData, load]);
  return <ResearchPanel title="Research runs" description="Each run records its Admin read-backs and the candidate changes it contains." name="research-runs">
    {runId && <Link href="/admin/prospects" className="text-sm underline">Back to prospect list</Link>}
    {error && <ResearchError message={error} retry={() => void load()} />}{loading && <p role="status" className="text-sm text-black/60">Loading research runs…</p>}
    {!loading && !error && !runs.length && <p className="text-sm text-black/60">No research runs have been recorded.</p>}
    {runs.length > 0 && <div className="overflow-x-auto" role="region" aria-label="Research run counts" tabIndex={0}><table className="w-full text-left text-sm"><thead><tr className="border-b border-border-brand text-xs text-black/60">{["Run", "Candidates", "Packages", "Awaiting review", "Applied", "Research visible", "Canonical visibility verified", "Needs attention"].map((label) => <th className="p-2 align-top" key={label}>{label}</th>)}</tr></thead><tbody>{runs.map((run) => <tr key={run.runId} className="border-b border-border-brand"><td className="p-2"><Link href={`/admin/prospects/research-runs/${run.runId}`} className="font-semibold text-navy underline">{run.runName}</Link></td>{[run.candidates, run.packages, run.awaitingReview, run.applied, run.researchVisible, run.canonicalVisibilityVerified, run.needsAttention].map((count, index) => <td key={index} className="p-2 tabular-nums">{count}</td>)}</tr>)}</tbody></table></div>}
    <p className="text-sm text-black/60">Research visible includes held candidates with verified package evidence. Canonical visibility requires an applied receipt and a successful firm read-back.</p>
    {detail && <><ComparisonExport sourceRunKey={detail.summary.sourceRunKey} /><h3 className="text-base font-semibold text-navy">Every package in this run</h3><ul className="space-y-3">{detail.packages.map((item) => <li key={item.packageId} className="rounded-md border border-border-brand p-3"><Link className="font-semibold text-navy underline" href={`/admin/prospects/research-packages/${item.packageId}`}>{item.displayName}</Link><p className="mt-2 text-sm text-black/60">Review: {item.state}. Research: {item.researchOutcome ?? "not recorded"}. Qualification: {item.qualification ?? "not assessed"}.</p></li>)}</ul><RunInventory value={detail.reconciliation} loading={loading} more={(cursor) => void load(undefined, undefined, cursor)} /></>}
    {nextCursor && <div><button type="button" className={researchButton} disabled={loading} onClick={() => void load(nextCursor)}>Load more {runId ? "packages" : "runs"}</button></div>}
  </ResearchPanel>;
}
