"use client";

import Link from "next/link";
import { researchEvidenceFields, researchFirmHeading, appendResearchHistoryPage } from "@/lib/prospect-enrichment-presentation";
import { useCallback, useEffect, useState } from "react";
import type { ProspectEnrichmentEvidence, ProspectEnrichmentFirmDetail } from "@/lib/prospect-enrichment-reader";
import { ResearchError, ResearchJson, ResearchSource, ResearchOriginal, ResearchPanel, readResearchResponse, researchButton, researchLabel } from "./ResearchEvidence";


function ObservationSummary({ item }: { item: ProspectEnrichmentEvidence }) {
  if (item.table === "prospect_advertising_observations") {
    const label = item.data.evidence_type === "advertising-pixel" ? "Pixel detected" : item.data.evidence_type === "historical-ad" ? "Historical advertisement" : "Research incomplete";
    return <div className="mt-3 space-y-2"><p className="text-sm font-semibold">{label}</p>{item.enrichment.map((lineage) => {
      const outer = lineage.data && typeof lineage.data === "object" && !Array.isArray(lineage.data) ? lineage.data as Record<string, unknown> : {};
      const data = outer.data && typeof outer.data === "object" && !Array.isArray(outer.data) ? outer.data as Record<string, unknown> : outer;
      const labelFor = (value: unknown, yes: string) => value === true ? yes : value === false ? "Not observed in reviewed sources" : value === null ? "Not checked" : "Could not verify";
      return <p key={lineage.itemId} className="text-sm">Configuration: {labelFor(data.configured, "Configured")}. Firing: {labelFor(data.fired, "Observed firing")}.</p>;
    })}</div>;
  }
  if (item.table === "prospect_qualification_decisions") {
    const labels: Record<string, string> = { "recent-ad-verified": "Recent advertisement verified", "historical-ad-only": "Historical advertisement", "pixels-detected": "Pixel detected", "not-observed": "Not observed in reviewed sources" };
    return <p className="mt-3 text-sm">Advertising: {typeof item.data.advertising_status === "string" ? labels[item.data.advertising_status] ?? "Research incomplete" : "Research incomplete"}.</p>;
  }
  return null;
}

function EvidenceCard({ item }: { item: ProspectEnrichmentEvidence }) {
  const payload = item.table === "prospect_enrichment_packages" && item.data.payload && typeof item.data.payload === "object" && !Array.isArray(item.data.payload) ? item.data.payload : null;
  const original = payload?.originalResearch && typeof payload.originalResearch === "object" && !Array.isArray(payload.originalResearch) ? payload.originalResearch : null;
  return <article className="min-w-0 rounded-md border border-border-brand p-3" data-ui-component-content="research-evidence-card">
    <h3 className="w-full text-sm font-semibold text-navy" data-ui-copy="heading">{item.qualificationCategory ?? researchLabel(item.table.replace(/^(gta_)?prospect_/, ""))}</h3>
    <p className="mt-2 w-full text-xs text-black/60" data-ui-copy="supporting">{item.dateLabel}{item.freshness === "refresh_recommended" ? ". Refresh recommended." : ""}</p>
    <ObservationSummary item={item} />
    {researchEvidenceFields(item).map((fields, index) => <dl key={index} className="mt-3 space-y-3">{fields.map((field) => <div key={field.label} className="min-w-0"><dt className="text-xs font-semibold text-black/60">{field.label}</dt><dd className="mt-1 text-sm"><ResearchJson value={field.value} /></dd></div>)}</dl>)}
    {item.retractions.length > 0 && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold">Retracted finding</p><ResearchJson value={item.retractions} /></div>}
    {item.sourceUrls.length > 0 && <ul className="mt-3 space-y-2">{item.sourceUrls.map((url) => <li key={url}><a className="break-all text-sm text-navy underline underline-offset-2" href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>}
    <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Complete stored evidence</summary><div className="mt-3"><ResearchJson value={Object.fromEntries(Object.entries(item.data).filter(([key]) => !["payload", "id", "firm_id"].includes(key)))} /></div></details>
    {item.enrichment.map((lineage) => <div key={lineage.itemId} className="mt-4 space-y-3 rounded-md bg-parchment p-3"><h4 className="text-sm font-semibold text-navy">Complete finding and source evidence</h4><ResearchJson value={lineage.data} /><details><summary className="cursor-pointer text-sm font-semibold">Sources, publication dates and retrieval history</summary><div className="mt-3">{lineage.sources.map((source, index) => <ResearchSource key={index} source={source} />)}</div></details><dl className="space-y-1 break-all font-mono text-xs"><div><dt>Research run</dt><dd>{lineage.runId ?? "Not recorded"}</dd></div><div><dt>Package and item IDs</dt><dd>{lineage.packageId} / {lineage.itemId}</dd></div><div><dt>Source event ID</dt><dd>{lineage.sourceEventId ?? "Not recorded"}</dd></div><div><dt>Source IDs</dt><dd>{lineage.sourceIds.join(", ") || "Not recorded"}</dd></div><div><dt>Payload SHA-256</dt><dd>{lineage.payloadSha256 ?? "Not recorded"}</dd></div></dl><Link className="text-sm text-navy underline" href={`/admin/prospects/research-packages/${lineage.packageId}`}>Open original package and all retained fields</Link></div>)}
    {item.legacyCriteria.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Evidence retained in historical criteria</summary><div className="mt-3 space-y-3">{item.legacyCriteria.map((projection) => <div key={projection.selector}><p className="break-all font-mono text-xs">{projection.selector}</p><ResearchJson value={projection.value} /><p className="mt-1 text-xs text-black/50">Retained with the original assessment. No new contact or advertising row was inferred.</p></div>)}</div></details>}
    {original && <div className="mt-4"><ResearchOriginal content={original.content} unmappedPaths={Array.isArray(original.unmappedPaths) ? original.unmappedPaths.filter((path): path is string => typeof path === "string") : []} sourcePath={typeof original.sourcePath === "string" ? original.sourcePath : undefined} sourcePointer={typeof original.sourcePointer === "string" ? original.sourcePointer : undefined} sha256={typeof original.sourceSha256 === "string" ? original.sourceSha256 : undefined} /></div>}
    {item.events && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Receipt, revision and verification events</summary><div className="mt-3"><ResearchJson value={item.events} /></div></details>}
    {payload && <div className="mt-4"><Link className={researchButton} href={`/admin/prospects/research-packages/${item.id}`}>Open complete research package</Link></div>}
    <details className="mt-4"><summary className="cursor-pointer text-xs text-black/50">Evidence identifiers</summary><div className="mt-2 space-y-1 break-all font-mono text-xs"><p>{item.table} / {item.id}</p><p>Semantic SHA-256: {item.semanticSha256}</p></div></details>
  </article>;
}

function ProfileChoice({ choice }: { choice: ProspectEnrichmentEvidence }) {
  const retracted = choice.retractions.length > 0;
  return <article className="min-w-0 rounded-md border border-border-brand bg-white p-3">
    <p className="text-sm font-semibold text-navy">{researchLabel(String(choice.data.field_key).split(":", 1)[0])}</p>
    {retracted ? <><p className="mt-2 text-sm font-semibold text-amber-900">Retracted finding</p><p className="mt-1 text-sm">No current value selected.</p><ResearchJson value={choice.retractions} /><details className="mt-3"><summary className="cursor-pointer text-sm">Original selected value</summary><ResearchJson value={choice.data.selected_value} /></details></> : <div className="mt-2"><ResearchJson value={choice.data.selected_value} /></div>}
    <details className="mt-3"><summary className="cursor-pointer text-sm underline">Selected evidence, source and reason</summary><div className="mt-3 space-y-3"><ResearchJson value={choice.data.selected_provenance} /><ResearchJson value={choice.data.rationale} />{choice.profileSource && <><p className="break-all font-mono text-xs">{choice.profileSource.table} / {choice.profileSource.id} / {choice.profileSource.selector}</p><ResearchJson value={choice.profileSource.data} />{choice.profileSource.enrichment.map((source) => <div key={source.itemId}><ResearchJson value={source.sources} /><Link className="text-sm text-navy underline" href={"/admin/prospects/research-packages/" + source.packageId}>Open selected source package</Link></div>)}{choice.profileSource.table === "prospect_enrichment_packages" && <Link className="text-sm text-navy underline" href={"/admin/prospects/research-packages/" + choice.profileSource.id}>Open selected source package</Link>}</>}</div></details>
  </article>;
}

export default function ProspectResearchDetail({ firmId, initialData }: { firmId: string; initialData?: ProspectEnrichmentFirmDetail }) {
  const [detail, setDetail] = useState<ProspectEnrichmentFirmDetail | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const response = await fetch(`/api/admin/prospect-enrichment/firms/${encodeURIComponent(firmId)}`, { cache: "no-store", signal }); const result = await readResearchResponse<ProspectEnrichmentFirmDetail>(response, "firm"); if (!Array.isArray(result.sections) || result.firm.id !== firmId) throw new Error("The firm research response was incomplete."); setDetail(result); setError(null); }
    catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Firm research could not be loaded."); }
  }, [firmId]);
  useEffect(() => { if (initialData) return; const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [initialData, load]);
  async function more(sectionKey: string, table: string, cursor: string) {
    setBusy(table);
    try { const params = new URLSearchParams({ table, cursor }); const response = await fetch(`/api/admin/prospect-enrichment/firms/${encodeURIComponent(firmId)}/history?${params}`, { cache: "no-store" }); const page = await readResearchResponse<{ table: string; items: ProspectEnrichmentEvidence[]; nextCursor: string | null; revision: string; revisionStable: boolean }>(response); if (!Array.isArray(page.items) || typeof page.revision !== "string" || typeof page.revisionStable !== "boolean") throw new Error("The history response was incomplete."); setDetail((current) => current ? appendResearchHistoryPage(current, sectionKey, table, page) : current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "More evidence could not be loaded."); } finally { setBusy(null); }
  }
  const heading = detail ? researchFirmHeading(detail) : null;
  return <div className="min-w-0 space-y-4" data-testid="prospect-research-detail">
    <Link href="/admin/prospects" className="text-sm text-navy underline underline-offset-2">Back to prospect list</Link>
    {error && <ResearchError message={error} retry={() => void load()} />}
    {!detail && !error && <p role="status" className="text-sm text-black/60">Loading research profile…</p>}
    {detail && <><header data-ui-component-content="research-detail-heading"><h1 className="w-full text-balance text-xl font-bold text-navy lg:text-2xl" data-ui-copy="heading">{detail.firm.displayName}</h1><p className="mt-2 w-full text-balance text-sm text-black/60" data-ui-copy="supporting">Research profile and evidence history</p>{detail.firm.websiteUrl && <a className="mt-3 block break-all text-sm text-navy underline" href={detail.firm.websiteUrl} target="_blank" rel="noopener noreferrer">{detail.firm.websiteUrl}</a>}{heading && <div className="mt-3 space-y-2 text-sm"><p className="w-full" data-ui-copy="supporting">Domain: {heading.domains.join(", ") || (heading.identityState === "error" ? "Could not verify" : "Not recorded")}</p><p className="w-full" data-ui-copy="supporting">{heading.complete ? "Latest observation: " : "Latest loaded observation: "}{heading.latestObservation}</p><p className="w-full" data-ui-copy="supporting">{heading.freshness}. {!heading.complete ? "Some evidence remains unloaded or unavailable." : ""}</p></div>}<details className="mt-3"><summary className="cursor-pointer text-sm text-black/60">Firm identity details</summary><dl className="mt-2 space-y-2 break-all font-mono text-xs"><div><dt>Database UUID</dt><dd>{detail.firm.id}</dd></div><div><dt>Stable firm ID</dt><dd>{heading?.stableIds.join(", ") || (heading?.identityState === "error" ? "Could not verify" : "Not recorded")}</dd></div><div><dt>Source key</dt><dd>{detail.firm.sourceRecordKey}</dd></div><div><dt>Revision</dt><dd>{detail.firm.revision}</dd></div></dl></details></header>
      {!detail.revisionStable && <ResearchError message="The firm record changed while this profile loaded. Reload before verifying evidence." retry={() => void load()} />}
      {detail.sections.map((section) => <ResearchPanel key={section.key} title={section.title} name={`research-section-${section.key}`}>
        {section.state === "error" && <ResearchError message="This section could not be fully loaded. Other available evidence remains visible." errorId={section.errorId} retry={() => void load()} />}
        {section.state === "empty" && <p className="text-sm text-black/50">No evidence was found in this section.</p>}
        {section.key === "profile" && <div className="rounded-md bg-parchment p-3"><h3 className="text-sm font-semibold text-navy">Explicitly selected profile values</h3>{detail.profileChoices.length ? <div className="mt-3 space-y-3">{detail.profileChoices.map((choice) => <ProfileChoice key={choice.id} choice={choice} />)}</div> : <p className="mt-2 text-sm text-black/60">{section.state === "error" ? "Current profile choices could not be verified. The available evidence below retains its original status." : "No explicit profile choices were found. The records below retain their original evidence status."}</p>}</div>}
        {section.items.map((item) => <EvidenceCard key={`${item.table}:${item.id}`} item={item} />)}
        {Object.entries(section.nextCursors).map(([table, cursor]) => <div key={table}><button className={researchButton} type="button" disabled={Boolean(busy)} onClick={() => void more(section.key, table, cursor)}>{busy === table ? "Loading evidence…" : `Load more ${researchLabel(table.replace(/^(gta_)?prospect_/, "")).toLowerCase()}`}</button></div>)}
      </ResearchPanel>)}
    </>}
  </div>;
}
