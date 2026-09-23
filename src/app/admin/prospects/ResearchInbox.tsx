"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ResearchError, ResearchPanel, readResearchResponse, researchButton, researchLabel } from "./ResearchEvidence";

export type ResearchPackageSummary = Readonly<{ packageId: string; clientPackageId: string; displayName: string; firmId: string | null; runId: string; runName: string; researchOutcome: string | null; qualification: string | null; state: string; receivedAt: string }>;
const tabs = [{ value: "all", label: "All updates" }, { value: "ready_for_review", label: "Ready for review" }, { value: "held", label: "Held" }, { value: "applied", label: "Applied" }, { value: "rejected", label: "Rejected submissions" }] as const;

export default function ResearchInbox({ initialData }: { initialData?: readonly ResearchPackageSummary[] }) {
  const [packages, setPackages] = useState<readonly ResearchPackageSummary[]>(initialData ?? []);
  const [state, setState] = useState("all"); const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(!initialData);
  const load = useCallback(async (nextCursor?: string, signal?: AbortSignal) => {
    setLoading(true);
    try { const params = new URLSearchParams({ state, limit: "25" }); if (nextCursor) params.set("cursor", nextCursor); const response = await fetch(`/api/admin/prospect-enrichment/packages?${params}`, { cache: "no-store", signal }); const result = await readResearchResponse<{ packages: ResearchPackageSummary[]; nextCursor: string | null }>(response); if (!Array.isArray(result.packages) || result.packages.some((item) => typeof item.packageId !== "string" || typeof item.displayName !== "string")) throw new Error("The research updates response was incomplete."); setPackages((current) => nextCursor ? [...current, ...result.packages] : result.packages); setCursor(result.nextCursor); setError(null); }
    catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Research updates could not be loaded."); } finally { setLoading(false); }
  }, [state]);
  useEffect(() => { if (initialData && state === "all") return; const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(undefined, controller.signal); }); return () => controller.abort(); }, [initialData, load, state]);
  return <ResearchPanel title="Research updates" description="Review new findings, unresolved identities, and changes proposed by research runs." name="research-updates">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter research updates">{tabs.map((tab) => <button type="button" key={tab.value} className={`${researchButton} ${state === tab.value ? "border-navy bg-parchment" : ""}`} aria-pressed={state === tab.value} onClick={() => setState(tab.value)}>{tab.label}</button>)}</div>
    {error && <ResearchError message={error} retry={() => void load()} />}
    {loading && <p role="status" className="text-sm text-black/60">Loading research updates…</p>}
    {!loading && !error && !packages.length && <p className="text-sm text-black/60">No research updates match this filter.</p>}
    {packages.length > 0 && <div className="overflow-x-auto" role="region" aria-label="Research updates table" tabIndex={0}><table className="w-full text-left text-sm"><thead><tr className="border-b border-border-brand text-xs text-black/60">{["Firm or candidate", "Research run", "Research outcome", "Qualification", "Review state", "Last received"].map((label) => <th className="p-2 align-top" key={label}>{label}</th>)}</tr></thead><tbody>{packages.map((item) => <tr key={item.packageId} className="border-b border-border-brand"><td className="p-2 align-top"><Link className="font-semibold text-navy underline" href={`/admin/prospects/research-packages/${item.packageId}`}>{item.displayName}</Link><div className="mt-2 flex flex-col items-start gap-2"><Link className="text-xs underline" href={`/admin/prospects/research-packages/${item.packageId}`}>Open research package</Link>{item.firmId && <Link className="text-xs underline" href={`/admin/prospects/firms/${item.firmId}`}>Open firm research</Link>}</div></td><td className="p-2 align-top"><Link className="underline" href={`/admin/prospects/research-runs/${item.runId}`}>{item.runName}</Link></td><td className="p-2 align-top">{item.researchOutcome ? researchLabel(item.researchOutcome) : "Not recorded"}</td><td className="p-2 align-top">{item.qualification ? researchLabel(item.qualification) : "Not assessed"}</td><td className="p-2 align-top">{researchLabel(item.state)}</td><td className="p-2 align-top">{item.receivedAt}</td></tr>)}</tbody></table></div>}
    {cursor && <div><button type="button" className={researchButton} disabled={loading} onClick={() => void load(cursor)}>Load more updates</button></div>}
  </ResearchPanel>;
}
