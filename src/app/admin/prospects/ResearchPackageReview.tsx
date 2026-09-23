"use client";

import Link from "next/link";
import NewFirmEvidenceReview from "./NewFirmEvidenceReview";
import type { ProspectEnrichmentNewCoreOptions, SourceBoundNewCoreInput } from "@/lib/prospect-enrichment-core-evidence";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JsonValue, ProspectEnrichmentEnvelope, ProspectEnrichmentSource } from "@/lib/prospect-enrichment-contract";
import { ResearchError, ResearchJson, ResearchSource, ResearchOriginal, ResearchPanel, readResearchResponse, researchButton, researchInput, researchLabel, researchUrl } from "./ResearchEvidence";

export type ResearchItemDisposition = "accept_new" | "link_existing" | "retain_only";
export type ResearchProfileChoice = Readonly<{ fieldKey: string; sourceSelector: string; selectedValue: JsonValue }>;
export type ReviewedNewCoreInput = SourceBoundNewCoreInput;
export type ResearchPackageReviewRequest = { payloadSha256: string; identity: { choice: "existing" | "new" | "unresolved"; firmId: string | null; coreInput: ReviewedNewCoreInput | null }; items: { itemId: string; disposition: ResearchItemDisposition; reason: string | null; profileChoice: ResearchProfileChoice | null }[] };
export type ResearchPackageReviewItem = Readonly<{ itemId: string; clientItemId: string; itemKind: string; data: unknown; sourceIds: readonly string[]; sourceEventId: string | null; hash: string; targets: readonly unknown[]; currentValue?: unknown; profileOmissionReason?: string; conflicts?: readonly string[]; allowedDispositions?: readonly ResearchItemDisposition[]; allowedDispositionsForNewIdentity?: readonly ResearchItemDisposition[]; allowProfileChoice?: boolean; allowedProfileChoice?: ResearchProfileChoice | null }>;
export type ResearchPackageReviewView = Readonly<{ packageId: string; clientPackageId: string; payloadSha256: string; state: string; identityState: string; newCoreOptions?: ProspectEnrichmentNewCoreOptions | null; firmId: string | null; payload: ProspectEnrichmentEnvelope; items: readonly ResearchPackageReviewItem[]; sources: readonly ProspectEnrichmentSource[]; events: readonly unknown[]; reviewJson: unknown; receipt: unknown; holds: readonly unknown[]; identityOptions?: readonly Readonly<{ value: "existing" | "new" | "unresolved"; label: string; eligible: boolean; firmId?: string; coreInput?: unknown }>[]; reviewSha256?: string | null; expectedRevisionSha256?: string | null; reviewExpiresAt?: string | null }>;
type Choice = { disposition: ResearchItemDisposition; reason: string; useInProfile: boolean };
type ReviewReceipt = { reviewSha256: string; expectedRevisionSha256: string; reviewExpiresAt: string; review?: unknown };
const dispositionLabels: Record<ResearchItemDisposition, string> = { accept_new: "Add to evidence history", link_existing: "Link existing evidence", retain_only: "Retain in research package" };
const perPage = 25;

export default function ResearchPackageReview({ packageId, initialData }: { packageId: string; initialData?: ResearchPackageReviewView }) {
  const [record, setRecord] = useState<ResearchPackageReviewView | null>(initialData ?? null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(0); const [choices, setChoices] = useState<Record<string, Choice>>({}); const [identity, setIdentity] = useState("unresolved");
  const [newCoreInput, setNewCoreInput] = useState<SourceBoundNewCoreInput | null>(null);
  const [review, setReview] = useState<ReviewReceipt | null>(null); const [acknowledged, setAcknowledged] = useState(false); const [message, setMessage] = useState<string | null>(null); const [verification, setVerification] = useState<unknown>(null); const [rejectReason, setRejectReason] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const response = await fetch(`/api/admin/prospect-enrichment/packages/${encodeURIComponent(packageId)}`, { cache: "no-store", signal }); const result = await readResearchResponse<ResearchPackageReviewView>(response, "package"); if (result.packageId !== packageId || !result.payload || !Array.isArray(result.items) || !Array.isArray(result.sources)) throw new Error("The research package response was incomplete."); setRecord(result); setError(null); }
    catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "The research package could not be loaded."); }
  }, [packageId]);
  useEffect(() => { if (initialData) return; const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [initialData, load]);
  function invalidate() { setReview(null); setAcknowledged(false); setMessage(null); }
  function choose(itemId: string, patch: Partial<Choice>) { setChoices((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? { disposition: "retain_only", reason: "", useInProfile: false }), ...patch } })); invalidate(); }
  const covered = useMemo(() => record?.items.filter((item) => { const choice = choices[item.itemId]; return choice && (choice.disposition !== "retain_only" || choice.reason.trim().length > 0); }).length ?? 0, [choices, record]);
  const itemCount = record?.items.length ?? 0; const terminal = record?.state === "applied" || record?.state === "rejected" || record?.state === "superseded";
  const savedChoices = useMemo(() => {
    const saved = record?.reviewJson && typeof record.reviewJson === "object" && !Array.isArray(record.reviewJson) ? record.reviewJson as Record<string, unknown> : {};
    const result: Record<string, Choice> = {};
    if (Array.isArray(saved.items)) for (const candidate of saved.items) {
      if (!candidate || typeof candidate !== "object" || typeof candidate.itemId !== "string" || !["accept_new", "link_existing", "retain_only"].includes(candidate.disposition)) continue;
      result[candidate.itemId] = { disposition: candidate.disposition, reason: typeof candidate.reason === "string" ? candidate.reason : "", useInProfile: candidate.profileChoice !== null && typeof candidate.profileChoice === "object" };
    }
    return result;
  }, [record]);

  async function requestReview() {
    if (!record || covered !== itemCount || terminal) return;
    setBusy("review"); setError(null); setAcknowledged(false);
    try { const option = record.identityOptions?.find((candidate) => candidate.value === identity && candidate.eligible); if (identity !== "unresolved" && !option) throw new Error("The selected firm identity is not ready for review.");
      if (identity === "new" && !newCoreInput) throw new Error("Select and review the source evidence for the new firm first.");
      const request: ResearchPackageReviewRequest = { payloadSha256: record.payloadSha256, identity: { choice: identity as "existing" | "new" | "unresolved", firmId: identity === "existing" ? option?.firmId ?? null : null, coreInput: identity === "new" ? newCoreInput : null }, items: record.items.map((item) => ({ itemId: item.itemId, disposition: choices[item.itemId].disposition, reason: choices[item.itemId].reason || null, profileChoice: choices[item.itemId].useInProfile ? item.allowedProfileChoice ?? null : null })) };
      const response = await fetch(`/api/admin/prospect-enrichment/packages/${packageId}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      if (response.status === 409) { invalidate(); throw new Error("The firm record changed after this review. Review the updated changes before applying."); }
      const result = await readResearchResponse<ReviewReceipt>(response); if (!result.reviewSha256 || !result.expectedRevisionSha256 || !result.reviewExpiresAt || !Number.isFinite(Date.parse(result.reviewExpiresAt))) throw new Error("The server did not return a complete review receipt."); setReview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The review could not be prepared."); } finally { setBusy(null); }
  }
  async function verify(scope: "package" | "canonical") {
    if (!record) throw new Error("Load the exact research package before verifying.");
    const response = await fetch(`/api/admin/prospect-enrichment/packages/${packageId}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibilityScope: scope, payloadSha256: record.payloadSha256 }) });
    const result = await readResearchResponse<Record<string, unknown>>(response); setVerification(result);
    if (result.verified !== true) throw new Error(scope === "canonical" ? "Evidence was saved, but Admin could not verify every item. Review the verification details." : "Admin could not verify every retained research item. Review the verification details.");
  }
  async function apply() {
    if (!review || !acknowledged || !record || terminal) return;
    if (Date.parse(review.reviewExpiresAt) <= Date.now()) { invalidate(); setError("This review expired. Prepare the exact review again before applying."); return; }
    setBusy("apply"); setError(null);
    try { const response = await fetch(`/api/admin/prospect-enrichment/packages/${packageId}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewSha256: review.reviewSha256, expectedRevisionSha256: review.expectedRevisionSha256, acknowledged: true }) });
      if (response.status === 409) { invalidate(); throw new Error("The firm record changed after this review. Review the updated changes before applying."); }
      await readResearchResponse(response); setMessage("Evidence saved. Admin visibility is being checked."); setAcknowledged(false); setReview(null); await load(); await verify("canonical");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The evidence could not be applied."); } finally { setBusy(null); }
  }
  async function reject() {
    if (!record || terminal || !rejectReason.trim()) return;
    setBusy("reject"); setError(null);
    try { const response = await fetch(`/api/admin/prospect-enrichment/packages/${packageId}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reject", payloadSha256: record.payloadSha256, reason: rejectReason }) }); await readResearchResponse(response); invalidate(); await load(); setMessage("Submission rejected. Its research remains available."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The submission could not be rejected."); } finally { setBusy(null); }
  }
  return <div className="min-w-0 space-y-4" data-testid="research-package-review">
    <Link href="/admin/prospects" className="text-sm text-navy underline">Back to prospect list</Link>
    <header data-ui-component-content="research-package-heading"><h1 className="w-full text-2xl font-bold text-navy" data-ui-copy="heading">Review research package</h1><p className="mt-2 w-full text-sm text-black/60" data-ui-copy="supporting">Keep every finding traceable to its source and review profile changes separately.</p></header>
    {error && <ResearchError message={error} retry={() => void load()} />}{message && <p role="status" className="rounded-md border border-border-brand bg-parchment p-3 text-sm">{message}</p>}
    {!record && !error && <p role="status" className="text-sm text-black/60">Loading research package…</p>}
    {record && <>
      <ResearchPanel title={record.payload.subject.displayName} name="research-package-identity">
        <p className="text-sm">Submission: {researchLabel(record.state)}. Identity: {researchLabel(record.identityState)}.</p>
        {record.identityState.includes("conflict") && <ResearchError message="More than one firm may use this website. Review the legal entity before linking this research." />}
        {record.holds.length > 0 && <details open><summary className="text-sm font-semibold">Evidence and identity holds</summary><div className="mt-3"><ResearchJson value={record.holds} /></div></details>}
        <fieldset disabled={Boolean(busy) || terminal} className="space-y-3"><legend className="mb-2 text-sm font-semibold">Identity choice</legend>{(["existing", "new", "unresolved"] as const).map((value) => { const option = record.identityOptions?.find((candidate) => candidate.value === value); const eligible = value === "unresolved" || option?.eligible === true; return <label className="flex items-start gap-2 text-sm" key={value}><input type="radio" className="mt-1" name="research-identity" value={value} checked={identity === value} disabled={!eligible} onChange={() => { setIdentity(value); setNewCoreInput(null); setChoices({}); invalidate(); }} /><span>{value === "existing" ? "Use verified existing firm" : value === "new" ? "Create new firm" : "Keep identity unresolved"}{!eligible && <span className="block text-xs text-black/50">Server validation has not made this choice available.</span>}</span></label>; })}</fieldset>
        {identity === "new" && record.newCoreOptions && <NewFirmEvidenceReview key={record.payloadSha256} options={record.newCoreOptions} disabled={Boolean(busy) || terminal} onChange={(value) => { setNewCoreInput(value); invalidate(); }} />}
        {record.firmId && <Link className={researchButton} href={`/admin/prospects/firms/${record.firmId}`}>Open firm research</Link>}
      </ResearchPanel>
      <ResearchPanel title="Complete evidence review" name="research-package-items" description={`${terminal ? Object.keys(savedChoices).length : covered} of ${itemCount} items have an explicit review disposition.`}>
        <p className="text-sm text-black/60">Sources, observations and assessments remain available even when they are retained without a profile change.</p>
        {record.items.slice(page * perPage, (page + 1) * perPage).map((item) => { const choice = terminal ? savedChoices[item.itemId] : choices[item.itemId]; const allowed = terminal && choice ? [choice.disposition] : identity === "new" && newCoreInput ? item.allowedDispositionsForNewIdentity ?? ["retain_only"] : identity === "existing" ? item.allowedDispositions ?? ["retain_only"] : ["retain_only"] as const; return <article key={item.itemId} className="min-w-0 rounded-md border border-border-brand p-3" data-ui-component-content="research-review-item">
          <h3 className="w-full text-sm font-semibold text-navy" data-ui-copy="heading">{researchLabel(item.itemKind)}</h3><p className="mt-2 break-all font-mono text-xs text-black/50">{item.clientItemId}</p>
          <div className="mt-3 space-y-3"><details open><summary className="cursor-pointer text-sm font-semibold">Current value and accepted history</summary><ResearchJson value={item.currentValue ?? { state: "unavailable", message: "The current comparison was not supplied. Reload this package before review." }} /></details><h4 className="text-xs font-semibold text-black/60">Proposed observation</h4><ResearchJson value={item.data} />
            {item.conflicts?.length ? <ResearchError message={item.conflicts.join(" ")} /> : null}
            <details><summary className="cursor-pointer text-sm font-semibold">Sources and observation dates</summary><div className="mt-3 space-y-3">{record.sources.filter((source) => item.sourceIds.includes(source.sourceId) || item.clientItemId === "src:" + source.sourceId).map((source) => <div key={source.sourceId}>{researchUrl(source.url) && <a className="break-all text-sm underline" href={source.url!} target="_blank" rel="noopener noreferrer">{source.url}</a>}<ResearchSource source={source} /></div>)}</div></details>
            <label className="block text-sm font-semibold">Intended disposition<select className={`${researchInput} mt-2`} value={choice?.disposition ?? ""} disabled={Boolean(busy) || terminal} onChange={(event) => choose(item.itemId, { disposition: event.target.value as ResearchItemDisposition, useInProfile: false })}><option value="" disabled>Select an action</option>{allowed.map((value) => <option value={value} key={value}>{dispositionLabels[value]}</option>)}</select></label>
            {choice?.disposition === "retain_only" && <label className="block text-sm font-semibold">Reason for retaining this item<textarea className={`${researchInput} mt-2`} value={choice.reason} disabled={Boolean(busy) || terminal} onChange={(event) => choose(item.itemId, { reason: event.target.value })} /></label>}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={choice?.useInProfile ?? false} disabled={Boolean(busy) || terminal || !item.allowProfileChoice || !choice || choice.disposition === "retain_only"} onChange={(event) => choose(item.itemId, { useInProfile: event.target.checked })} /><span>Use this observation in the current profile</span></label>{item.allowedProfileChoice && <details><summary className="cursor-pointer text-sm">Exact available profile value</summary><ResearchJson value={item.allowedProfileChoice} /></details>}
            {(!choice?.useInProfile || !item.allowProfileChoice) && <p className="text-xs text-black/50">{choice?.disposition === "retain_only" ? "Retained in this research package. This disposition does not change the current profile." : item.profileOmissionReason ?? "An eligible source-backed observation must be explicitly selected before the current profile changes."}</p>}
          </div>
        </article>; })}
        {!record.items.length && <p className="text-sm text-black/60">This package contains original research without normalized evidence items.</p>}
        <div className="flex flex-wrap items-center gap-3"><button type="button" className={researchButton} disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous 25 items</button><span className="text-sm">Page {page + 1} of {Math.max(1, Math.ceil(itemCount / perPage))}</span><button type="button" className={researchButton} disabled={(page + 1) * perPage >= itemCount} onClick={() => setPage((value) => value + 1)}>Next 25 items</button></div>
        {!terminal && <div><button type="button" className={researchButton} disabled={Boolean(busy) || covered !== itemCount || (identity === "new" && !newCoreInput)} onClick={() => void requestReview()}>{busy === "review" ? "Preparing review…" : "Prepare exact review"}</button></div>}
      </ResearchPanel>
      {review && <ResearchPanel title="Confirm reviewed changes" name="research-package-confirmation"><ResearchJson value={review.review ?? choices} /><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I reviewed this exact package and the changes shown below.</span></label><div><button className={`${researchButton} bg-navy text-white`} type="button" disabled={!acknowledged || Boolean(busy)} onClick={() => void apply()}>{busy === "apply" ? "Applying evidence…" : "Apply reviewed evidence"}</button></div></ResearchPanel>}
      <ResearchPanel title="Original research and verification" name="research-package-original"><ResearchOriginal content={record.payload.originalResearch.content} unmappedPaths={record.payload.originalResearch.unmappedPaths} sourcePath={record.payload.originalResearch.sourcePath} sourcePointer={record.payload.originalResearch.sourcePointer} sha256={record.payload.originalResearch.sourceSha256} /><div><button type="button" className={researchButton} disabled={Boolean(busy) || record.state === "rejected" || record.state === "superseded"} onClick={async () => { setBusy("verify"); setError(null); try { await verify(record.state === "applied" ? "canonical" : "package"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Verification could not be completed."); } finally { setBusy(null); } }}>{record.state === "applied" ? "Verify applied evidence visibility" : "Verify retained research visibility"}</button></div>{verification !== null && <ResearchJson value={verification} />}<details><summary className="cursor-pointer text-sm font-semibold">Import receipt and event history</summary><div className="mt-3 space-y-3"><ResearchJson value={record.receipt} /><ResearchJson value={record.events} /></div></details></ResearchPanel>
      {!terminal && <ResearchPanel title="Reject this submission" name="research-package-reject" description="Rejecting a submission retains its research and does not disqualify the firm."><label className="block text-sm font-semibold">Rejection reason<textarea className={`${researchInput} mt-2`} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} /></label><div><button type="button" className={researchButton} disabled={Boolean(busy) || !rejectReason.trim()} onClick={() => void reject()}>Reject submission and retain research</button></div></ResearchPanel>}
    </>}
  </div>;
}
