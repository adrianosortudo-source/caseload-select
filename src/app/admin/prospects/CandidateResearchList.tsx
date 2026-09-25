"use client";
import Link from "next/link";
import { CandidateWarnings } from "./CandidateResearchWarnings";
import CandidateResearchProfile from "./CandidateResearchProfile";
import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CANDIDATE_FILTER_KEYS, type CandidateFilterKey, type CandidateList } from "@/lib/prospect-enrichment-candidate-contract";
import { ResearchError, ResearchPanel, readResearchResponse, researchButton, researchInput, researchLabel } from "./ResearchEvidence";

const filterLabels: Record<CandidateFilterKey, string> = {
  firmId: "Verified firm ID", identityNamespace: "Exact candidate source namespace", identityKey: "Exact candidate source key", text: "Search all research", originalStatus: "Original status", selectionDisposition: "Selection disposition", processingDisposition: "Processing disposition", qualificationState: "Qualification state", identityState: "Identity state", fieldPointer: "Research field (JSON pointer)", fieldValue: "Exact field value (JSON)", fieldRefRevision: "Exact field reference revision", fieldRefPointerSha256: "Exact field pointer digest", sourceUrl: "Source URL", observedFrom: "Observed from (UTC)", observedTo: "Observed through (UTC)", retrievedFrom: "Retrieved from (UTC)", retrievedTo: "Retrieved through (UTC)", observedUnknown: "Observation date unknown", retrievedUnknown: "Retrieval date unknown",
};
function states(values: string[]): string { return values.length ? values.map(value => value === "" ? 'Empty text ""' : value).join(", ") : "Not recorded"; }
function InlineCandidateProfile({ candidateId, coverageRevision }: { candidateId: string; coverageRevision: number }) {
  const [open, setOpen] = useState(false);
  return <details className="mt-3 min-w-0" onToggle={event => setOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold text-navy">Research revisions and source evidence</summary>{open && <div className="mt-3 min-w-0"><CandidateResearchProfile candidateId={candidateId} coverageRevision={coverageRevision} /></div>}</details>;
}
export default function CandidateResearchList({ firmId, embeddedProfiles = false }: { firmId?: string; embeddedProfiles?: boolean } = {}) {
  const query = useSearchParams(), router = useRouter(), pathname = usePathname();
  const [data, setData] = useState<CandidateList | null>(null), [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const apiQuery = new URLSearchParams();
  for (const key of [...CANDIDATE_FILTER_KEYS, "cursor"] as const) { const value = query.get("cr_" + key); if (value !== null) apiQuery.set(key, value); }
  if (firmId) apiQuery.set("firmId", firmId);
  const requestKey = apiQuery.toString();
  useEffect(() => {
    const abort = new AbortController(); setData(null); setError(null);
    fetch("/api/admin/prospect-enrichment/candidates?" + requestKey, { cache: "no-store", signal: abort.signal })
      .then(response => readResearchResponse<CandidateList>(response)).then(setData)
      .catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Candidate research could not be loaded."); });
    return () => abort.abort();
  }, [requestKey, retry]);
  function navigate(next: URLSearchParams) { router.push(pathname + (next.size ? "?" + next.toString() : ""), { scroll: false }); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget), next = new URLSearchParams(query.toString()); next.delete("cr_cursor");
    for (const key of CANDIDATE_FILTER_KEYS) { const value = key === "firmId" && firmId ? firmId : String(values.get(key) ?? "").trim(); if (value) next.set("cr_" + key, value); else next.delete("cr_" + key); }
    navigate(next);
  }
  return <ResearchPanel title={firmId ? "Research for this firm" : "All researched candidates"} name="research-candidate-list" description={firmId ? "Search every retained source candidate linked to this verified firm. Original statuses, gaps and source evidence remain available." : "Search retained findings across every selection state, including unresolved identities and held source records."}>
    <form key={requestKey} onSubmit={submit} className="space-y-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">{CANDIDATE_FILTER_KEYS.filter(key => !firmId || key !== "firmId").map(key => <label key={key} className="min-w-0 text-sm font-medium text-navy">{filterLabels[key]}
        {key.endsWith("Unknown") ? <select name={key} defaultValue={query.get("cr_" + key) ?? ""} className={researchInput}><option value="">Any date</option><option value="true">Not recorded</option></select>
          : key === "identityState" ? <select name={key} defaultValue={query.get("cr_" + key) ?? ""} className={researchInput}><option value="">All identities</option>{["resolved", "unresolved", "conflict"].map(value => <option key={value} value={value}>{researchLabel(value)}</option>)}</select>
          : <input name={key} defaultValue={query.get("cr_" + key) ?? ""} type={key.endsWith("From") || key.endsWith("To") ? "date" : "text"} maxLength={2048} className={researchInput} placeholder={key === "fieldValue" ? 'false, null, "text", [], {}' : key.endsWith("Status") || key.endsWith("Disposition") || key === "qualificationState" ? "Any; __unknown__ for missing" : undefined} />}
      </label>)}</div>
      <p className="text-sm text-black/60">Exact field filters distinguish false, null, text and empty containers. Open a profile to filter a retained value. For verified firms, filters search the combined evidence from all linked source candidates. Unresolved identities stay separate. Matching facts may come from different revisions; inspect their sources below.</p>
      <div className="flex flex-wrap gap-2"><button className={researchButton} type="submit">Search candidates</button><button className={researchButton} type="button" onClick={() => { const next = new URLSearchParams(query.toString()); [...CANDIDATE_FILTER_KEYS, "cursor"].forEach(key => next.delete("cr_" + key)); if (firmId) next.set("cr_firmId", firmId); navigate(next); }}>Clear research filters</button></div>
    </form>
    {error ? <ResearchError message={error} retry={() => setRetry(value => value + 1)} /> : !data ? <p>Loading candidate research…</p> : <>
      <CandidateWarnings warnings={data.readWarnings} complete={data.complete} />
      <p className="text-sm text-black/60">{data.filteredCount} matching source candidates from {data.inventoryCount} retained candidates. Coverage revision {data.coverageRevision}.</p>
      {data.items.length === 0 && <p>No candidates match this research snapshot.</p>}
      <div className="space-y-3">{data.items.map(candidate => <article key={candidate.id} className="min-w-0 rounded border border-border-brand p-3" data-testid="candidate-summary">
        <h3 className="break-words font-semibold"><Link className="underline underline-offset-2" href={`/admin/prospects/candidates/${candidate.id}?coverageRevision=${data.coverageRevision}`}>{candidate.displayName}</Link></h3>
        <p className="mt-1 break-all text-xs text-black/60">{candidate.identityNamespace}: {candidate.identityKey}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="font-semibold">Original status</dt><dd>{states(candidate.originalStatuses)}</dd></div><div><dt className="font-semibold">Selection</dt><dd>{states(candidate.selectionDispositions)}</dd></div><div><dt className="font-semibold">Qualification</dt><dd>{states(candidate.qualificationStates)}</dd></div><div><dt className="font-semibold">Processing</dt><dd>{states(candidate.processingDispositions)}</dd></div><div><dt className="font-semibold">Identity</dt><dd>{researchLabel(candidate.identityState)}</dd></div><div><dt className="font-semibold">Retained revisions</dt><dd>{candidate.revisionCount}</dd></div></dl>
        {candidate.verifiedFirmId && <p className="mt-3 text-sm"><Link className="font-semibold underline" href={`/admin/prospects/firms/${candidate.verifiedFirmId}`}>Open the verified firm profile</Link>{!firmId && <> · <Link className="underline" href={`/admin/prospects/candidates?cr_firmId=${candidate.verifiedFirmId}`}>Search all research for this firm</Link></>}</p>}
        <CandidateWarnings warnings={candidate.readWarnings} complete={candidate.readWarnings.length === 0} />
        {embeddedProfiles && <InlineCandidateProfile candidateId={candidate.id} coverageRevision={data.coverageRevision} />}
      </article>)}</div>
      <div className="flex flex-wrap gap-2"><button className={researchButton} type="button" disabled={!query.has("cr_cursor")} onClick={() => { const next = new URLSearchParams(query.toString()); next.delete("cr_cursor"); navigate(next); }}>First page</button><button className={researchButton} type="button" disabled={!data.nextCursor} onClick={() => { if (data.nextCursor) { const next = new URLSearchParams(query.toString()); next.set("cr_cursor", data.nextCursor); navigate(next); } }}>Next candidates</button></div>
    </>}
  </ResearchPanel>;
}
