"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { candidateFieldReference, loadCandidateRevision } from "@/lib/prospect-enrichment-candidate-content";
import type { CandidateDetail, CandidateHistory, CandidateHistoryItem } from "@/lib/prospect-enrichment-candidate-contract";
import { CandidateWarnings } from "./CandidateResearchList";
import { ResearchError, ResearchJson, ResearchPanel, readResearchResponse, researchButton, researchLabel } from "./ResearchEvidence";

function ExactFieldLink({ revisionId, pointer, value }: { revisionId: string; pointer: string; value: unknown }) {
  const router = useRouter(), [error, setError] = useState(false);
  const filter = new URLSearchParams({ cr_fieldPointer: pointer, cr_fieldValue: JSON.stringify(value) });
  if (pointer && pointer.length <= 2048 && JSON.stringify(value).length <= 2048 && filter.toString().length <= 4000) return <Link href={`/admin/prospects/candidates?${filter}`} className="mt-2 inline-block text-sm font-semibold text-navy underline">Find this exact field value</Link>;
  return <><button type="button" className="mt-2 text-sm font-semibold text-navy underline" onClick={() => { setError(false); void candidateFieldReference(revisionId, pointer).then(query => router.push(`/admin/prospects/candidates?${query}`)).catch(() => setError(true)); }}>Find this exact field value</button>{error && <p role="alert">The exact field reference could not be prepared. Retry this filter.</p>}</>;
}
function CandidateRevision({ item: metadata, coverageRevision }: { item: CandidateHistoryItem; coverageRevision: number }) {
  const [open, setOpen] = useState(false), [fieldLimit, setFieldLimit] = useState(50), [content, setContent] = useState<CandidateHistoryItem | null>(null), [contentError, setContentError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const item = content ?? metadata;
  async function readContent() {
    if (!metadata.contentDeferred || content || loading) return; setLoading(true); setContentError(null);
    try { setContent(await loadCandidateRevision(metadata.candidateId, metadata.id, coverageRevision)); }
    catch (cause) { setContentError(cause instanceof Error ? cause.message : "Retained content could not be loaded."); } finally { setLoading(false); }
  }
  return <article className="min-w-0 rounded border border-border-brand p-3" data-testid="candidate-revision">
    <h3 className="font-semibold">{researchLabel(item.itemKind)}</h3><p className="mt-1 break-words text-xs text-black/60">Recorded {item.recordedAt}. Observation {item.observedAt ?? "not recorded"}; retrieval {item.retrievedAt ?? "not recorded"}.</p>
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{[["Original status", item.originalStatus], ["Selection", item.selectionDisposition], ["Qualification", item.qualificationState], ["Processing", item.processingDisposition]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value === "" ? 'Empty text ""' : value ?? "Not recorded"}</dd></div>)}</dl>
    <CandidateWarnings warnings={item.readWarnings} complete={!item.readWarnings.length} />
    <details className="mt-3" onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open) void readContent(); }}><summary className="cursor-pointer font-semibold text-navy">Evidence, exact fields and original revision</summary>{open && <div className="mt-3 min-w-0 space-y-4">{loading && <p>Loading and verifying retained evidence…</p>}{contentError && <ResearchError message={contentError} retry={() => void readContent()} />}
      <dl className="space-y-2 break-all text-xs"><div><dt className="font-semibold">Source artifact and pointer</dt><dd>{item.sourceRoot ?? "Not recorded"} / {item.relativePath ?? "Not recorded"} {item.sourcePointer ?? "(pointer not recorded)"}</dd></div><div><dt className="font-semibold">Source file SHA-256</dt><dd>{item.sourceFileSha256 ?? "Not recorded"}</dd></div><div><dt className="font-semibold">Source package or evidence SHA-256</dt><dd>{item.payloadSha256}</dd></div><div><dt className="font-semibold">Retained original JSON SHA-256</dt><dd>{item.originalJsonSha256}</dd></div><div><dt className="font-semibold">Exact lineage</dt><dd>Run {item.runId}; entry {item.entryId}; package {item.packageId ?? "not supplied"}; revision {item.id}</dd></div></dl>
      <div className="space-y-3">{item.fields.slice(0, fieldLimit).map(field => {
        return <div key={field.pointer} className="min-w-0 rounded bg-parchment p-3"><p className="break-all font-mono text-xs">{field.pointer || "(root)"} · {field.scalarType}</p><ResearchJson value={field.value} /><p className="mt-2 break-words text-xs">Observed {field.observedAt ?? "not recorded"}; retrieved {field.retrievedAt ?? "not recorded"}. {researchLabel(field.validationState)}.</p><p className="break-all text-xs">Item {field.sourceItemId ?? "not recorded"}; source references {JSON.stringify(field.sourceIds)}.</p><ExactFieldLink revisionId={item.id} pointer={field.pointer} value={field.value} /></div>;
      })}</div>
      {item.fields.length > fieldLimit && <button className={researchButton} onClick={() => setFieldLimit(value => value + 50)} type="button">Show 50 more retained fields</button>}
      {!item.contentDeferred && <details><summary className="cursor-pointer font-semibold text-navy">Complete original JSON</summary><div className="mt-3 min-w-0"><ResearchJson value={item.originalJson} /></div></details>}
      {!item.contentDeferred && <details><summary className="cursor-pointer font-semibold text-navy">Unmapped original paths</summary><div className="mt-3"><ResearchJson value={item.unmappedPaths} /></div></details>}
    </div>}</details>
  </article>;
}
export default function CandidateResearchProfile({ candidateId, coverageRevision }: { candidateId: string; coverageRevision?: number }) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null), [history, setHistory] = useState<CandidateHistory | null>(null);
  const [error, setError] = useState<string | null>(null), [historyError, setHistoryError] = useState<string | null>(null), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const base = "/api/admin/prospect-enrichment/candidates/" + encodeURIComponent(candidateId);
  useEffect(() => {
    const abort = new AbortController(); setDetail(null); setHistory(null); setError(null); setHistoryError(null);
    const suffix = coverageRevision === undefined ? "" : "?coverageRevision=" + coverageRevision;
    fetch(base + suffix, { cache: "no-store", signal: abort.signal }).then(response => readResearchResponse<CandidateDetail>(response)).then(async result => {
      if (abort.signal.aborted) return; setDetail(result);
      try { const response = await fetch(base + "/history?coverageRevision=" + result.coverageRevision, { cache: "no-store", signal: abort.signal }); const page = await readResearchResponse<CandidateHistory>(response); if (!abort.signal.aborted) setHistory(page); }
      catch (cause) { if (!abort.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : "Retained history could not be loaded."); }
    }).catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Candidate research could not be loaded."); });
    return () => abort.abort();
  }, [base, coverageRevision, retry]);
  async function more() {
    if (!history?.nextCursor || busy) return; setBusy(true); setHistoryError(null);
    try {
      const page = await readResearchResponse<CandidateHistory>(await fetch(base + "/history?cursor=" + encodeURIComponent(history.nextCursor), { cache: "no-store" }));
      if (page.coverageRevision !== history.coverageRevision) throw new Error("Research snapshot changed. Reload the profile.");
      setHistory({ ...page, readWarnings: [...new Set([...history.readWarnings, ...page.readWarnings])], complete: history.complete && page.complete, items: [...history.items, ...page.items] });
    } catch (cause) { setHistoryError(cause instanceof Error ? cause.message : "Retained history could not be loaded."); } finally { setBusy(false); }
  }
  return <ResearchPanel title="Candidate research" name="research-candidate-profile" description="Original research remains available across selection changes. A candidate identity is separate from a verified firm identity.">
    <Link href="/admin/prospects/candidates" className="text-sm font-semibold text-navy underline">All researched candidates</Link>
    {error ? <ResearchError message={error} retry={() => setRetry(value => value + 1)} /> : !detail ? <p>Loading candidate profile…</p> : <>
      <CandidateWarnings warnings={detail.readWarnings} complete={detail.complete} />
      <dl className="space-y-2 text-sm"><div><dt className="font-semibold">Research name</dt><dd className="w-full whitespace-pre-wrap break-words text-base font-semibold [overflow-wrap:anywhere]" data-testid="candidate-research-name">{detail.candidate.displayName}</dd></div><div><dt className="font-semibold">Candidate identity</dt><dd className="break-all">{detail.candidate.identityNamespace}: {detail.candidate.identityKey}</dd></div><div><dt className="font-semibold">Identity review</dt><dd>{researchLabel(detail.candidate.identityState)}</dd></div><div><dt className="font-semibold">Verified firm</dt><dd>{detail.candidate.verifiedFirmId ? <Link className="underline" href={`/admin/prospects/firms/${detail.candidate.verifiedFirmId}`}>{detail.candidate.verifiedFirmId}</Link> : "Not linked to a verified firm"}</dd></div><div><dt className="font-semibold">Coverage snapshot</dt><dd>{detail.coverageRevision}</dd></div></dl>
      <CandidateWarnings warnings={detail.candidate.readWarnings} complete={!detail.candidate.readWarnings.length} />
      <h3 className="font-semibold">Explicitly reviewed profile choices</h3>{detail.profileChoices.length ? <ResearchJson value={detail.profileChoices} /> : <p className="text-sm">No explicit profile value has been selected. Research observations remain below.</p>}
      <h3 className="font-semibold">Retained revisions and review history</h3>
      {historyError && <ResearchError message={historyError} retry={() => history ? void more() : setRetry(value => value + 1)} />}
      {!history && !historyError && <p>Loading retained research…</p>}
      {history && <><CandidateWarnings warnings={history.readWarnings} complete={history.complete} />{!history.items.length && <p>No retained revisions were returned for this snapshot.</p>}<div className="space-y-4">{history.items.map(item => <CandidateRevision key={item.id} item={item} coverageRevision={history.coverageRevision} />)}</div>{history.nextCursor && <button type="button" className={researchButton} disabled={busy} onClick={() => void more()}>{busy ? "Loading revisions…" : "Load older retained records"}</button>}</>}
    </>}
  </ResearchPanel>;
}
