"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { artifactControlState, type PublishKitPiece } from "@/lib/publish-kit-pure";

type PdfCandidate = {
  sourceKind: "version" | "approval" | "comment";
  sourceId: string;
  versionId: string;
  storagePath: string;
  name: string;
  size: number | null;
  mime: string;
  sourceLabel: string;
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Not recorded";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChecklistPdfArtifactPanel({
  piece,
  firmId,
  onRefresh,
}: {
  piece: PublishKitPiece;
  firmId: string;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [candidates, setCandidates] = useState<PdfCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const artifact = piece.artifacts.find((item) => item.artifactType === "pdf" && !item.supersededAt) ?? null;
  const controlState = artifact
    ? artifactControlState({ storagePath: artifact.storagePath, locked: false, supersededAt: artifact.supersededAt, unapproved: piece.boundArtifactsAreUnapproved, mayPublish: piece.mayPublish, signedUrl: artifact.signedUrl })
    : "no_file";
  const canDownload = controlState === "download" && Boolean(artifact?.signedUrl);

  async function attach(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/portal/${firmId}/deliverables/${piece.id}/artifacts/pdf`, { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The PDF could not be attached.");
      router.refresh();
      onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The PDF could not be attached.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function openReplacement() {
    setReplaceOpen(true);
    setError(null);
    setCandidatesLoading(true);
    try {
      const response = await fetch(`/api/portal/${firmId}/deliverables/${piece.id}/artifacts/pdf`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { candidates?: PdfCandidate[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Stored PDF candidates could not be loaded.");
      setCandidates(body.candidates ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stored PDF candidates could not be loaded.");
    } finally {
      setCandidatesLoading(false);
    }
  }

  async function replacePdf() {
    if (!artifact || !reason.trim() || (selectedCandidate === null && !replacementFile)) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("prior_artifact_id", artifact.id);
      form.append("reason", reason.trim());
      if (replacementFile) {
        form.append("file", replacementFile);
      } else {
        const candidate = candidates.find((item) => `${item.sourceKind}:${item.sourceId}` === selectedCandidate);
        if (!candidate) throw new Error("Select a stored PDF or upload a replacement file.");
        form.append("candidate_storage_path", candidate.storagePath);
        form.append("candidate_source_kind", candidate.sourceKind);
        form.append("candidate_source_id", candidate.sourceId);
      }
      const response = await fetch(`/api/portal/${firmId}/deliverables/${piece.id}/artifacts/pdf`, { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The PDF could not be replaced.");
      setReplaceOpen(false);
      setSelectedCandidate(null);
      setReplacementFile(null);
      setReason("");
      router.refresh();
      onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The PDF could not be replaced.");
    } finally {
      setUploading(false);
      if (replacementInputRef.current) replacementInputRef.current.value = "";
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void attach(file);
  }

  if (!artifact) {
    return (
      <section className="border border-border-brand bg-white p-3.5" aria-labelledby={`checklist-pdf-${piece.id}`}>
        <h4 id={`checklist-pdf-${piece.id}`} className="text-xs font-bold text-navy">Checklist PDF not attached</h4>
        <p className="mt-1.5 text-[11px] leading-relaxed text-black/60">The approved copy remains available. Attach the exact PDF for this language and version to enable downloading from the Publish Kit.</p>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={handleFileChange} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="mt-3 border border-navy bg-navy px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-navy/90 disabled:opacity-50">{uploading ? "Attaching…" : "Attach PDF"}</button>
        {error && <p role="alert" className="mt-2 text-[11px] text-red-700">{error}</p>}
      </section>
    );
  }

  return (
    <section className="border border-border-brand bg-white p-3.5" aria-labelledby={`checklist-pdf-${piece.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`checklist-pdf-${piece.id}`} className="text-xs font-bold text-navy">Checklist PDF</h4>
          <p className="mt-0.5 text-[10px] text-black/45">Downloadable resource · current version</p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-green-pass">{piece.mayPublish ? "Ready" : "Attached"}</span>
      </div>

      <p className="mt-3 break-all font-mono text-[11px] text-black/60">{artifact.filename ?? "Unnamed PDF"}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="uppercase tracking-wider text-black/40">Format</dt><dd className="text-black/60">PDF</dd>
        <dt className="uppercase tracking-wider text-black/40">Size</dt><dd className="text-black/60">{formatBytes(artifact.sizeBytes)}</dd>
        {artifact.locale && <><dt className="uppercase tracking-wider text-black/40">Language</dt><dd className="text-black/60">{artifact.locale}</dd></>}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        {canDownload && artifact.signedUrl ? <a href={artifact.signedUrl} download rel="noreferrer" className="border border-navy bg-navy px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-navy/90">Download PDF</a> : <span className="border border-black/20 bg-black/10 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/40">Download locked</span>}
        {canDownload && artifact.signedUrl ? <a href={artifact.signedUrl} target="_blank" rel="noreferrer" className="border border-border-brand px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy hover:bg-parchment-2">Open PDF</a> : null}
      </div>

      <details className="mt-3 border-t border-border-brand pt-2.5">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-navy/70">Provenance</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="uppercase tracking-wider text-black/40">Bound to version</dt><dd className="break-all font-mono text-black/60">{artifact.versionId}</dd>
          {artifact.storagePath && <><dt className="uppercase tracking-wider text-black/40">Storage path</dt><dd className="break-all font-mono text-black/60">{artifact.storagePath}</dd></>}
          {artifact.sha256 && <><dt className="uppercase tracking-wider text-black/40">SHA-256</dt><dd className="break-all font-mono text-black/60">{artifact.sha256}</dd></>}
        </dl>
      </details>

      <div className="mt-3 border-t border-border-brand pt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-black/40">Operator-only file management</p>
        <button type="button" onClick={() => void openReplacement()} className="mt-1 text-[11px] font-semibold text-navy underline underline-offset-2">Replace PDF</button>
      </div>

      {replaceOpen && (
        <div className="mt-3 border border-border-brand bg-parchment p-3" role="dialog" aria-label="Replace checklist PDF">
          <p className="text-xs font-bold text-navy">Replace checklist PDF</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-black/65">This changes only the downloadable PDF. The approved copy, approval status, and deliverable version will remain unchanged.</p>
          <fieldset className="mt-3">
            <legend className="text-[10px] font-semibold uppercase tracking-wider text-black/50">Choose a stored PDF</legend>
            {candidatesLoading ? <p className="mt-2 text-[11px] text-black/60">Loading stored PDFs…</p> : candidates.length === 0 ? <p className="mt-2 text-[11px] text-black/60">No stored PDF candidates found. Upload the correct PDF below.</p> : <div className="mt-2 space-y-1.5">{candidates.map((candidate) => { const value = `${candidate.sourceKind}:${candidate.sourceId}`; return <label key={value} className="flex cursor-pointer gap-2 border border-border-brand bg-white p-2 text-[11px]"><input type="radio" name={`pdf-candidate-${piece.id}`} checked={selectedCandidate === value} onChange={() => { setSelectedCandidate(value); setReplacementFile(null); }} /><span className="min-w-0"><span className="block break-all font-mono text-black/75">{candidate.name}</span><span className="block text-black/50">{candidate.sourceLabel} · {formatBytes(candidate.size)}</span></span></label>; })}</div>}
          </fieldset>
          <div className="mt-3 border-t border-border-brand pt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-black/50" htmlFor={`replacement-file-${piece.id}`}>Or upload a different PDF</label>
            <input id={`replacement-file-${piece.id}`} ref={replacementInputRef} type="file" accept="application/pdf,.pdf" className="mt-1 block w-full text-[11px]" onChange={(event) => { setReplacementFile(event.target.files?.[0] ?? null); setSelectedCandidate(null); }} />
          </div>
          <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-black/50" htmlFor={`replacement-reason-${piece.id}`}>Why is this being replaced?</label>
          <input id={`replacement-reason-${piece.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Wrong document uploaded" className="mt-1 w-full border border-border-brand bg-white px-2 py-1.5 text-[11px] text-navy" />
          {error && <p role="alert" className="mt-2 text-[11px] text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void replacePdf()} disabled={uploading || !reason.trim() || (selectedCandidate === null && !replacementFile)} className="border border-navy bg-navy px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white disabled:opacity-50">{uploading ? "Replacing…" : "Replace PDF"}</button>
            <button type="button" onClick={() => { setReplaceOpen(false); setError(null); }} className="border border-border-brand px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy">Keep current PDF</button>
          </div>
        </div>
      )}
      {error && !replaceOpen && <p role="alert" className="mt-2 text-[11px] text-red-700">{error}</p>}
    </section>
  );
}
