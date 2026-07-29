"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  artifactControlState,
  type PublishKitPiece,
} from "@/lib/publish-kit-pure";

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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const artifact = piece.artifacts.find((item) => item.artifactType === "pdf" && !item.supersededAt) ?? null;
  const controlState = artifact
    ? artifactControlState({
        storagePath: artifact.storagePath,
        locked: false,
        supersededAt: artifact.supersededAt,
        unapproved: piece.boundArtifactsAreUnapproved,
        mayPublish: piece.mayPublish,
        signedUrl: artifact.signedUrl,
      })
    : "no_file";
  const canDownload = controlState === "download" && Boolean(artifact?.signedUrl);

  async function attach(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/portal/${firmId}/deliverables/${piece.id}/artifacts/pdf`, {
        method: "POST",
        body: form,
      });
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

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void attach(file);
  }

  if (!artifact) {
    return (
      <section className="border border-border-brand bg-white p-3.5" aria-labelledby={`checklist-pdf-${piece.id}`}>
        <h4 id={`checklist-pdf-${piece.id}`} className="text-xs font-bold text-navy">Checklist PDF not attached</h4>
        <p className="text-[11px] leading-relaxed text-black/60 mt-1.5">
          The approved copy remains available. Attach the exact PDF for this language and version to enable downloading from the Publish Kit.
        </p>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={handleFileChange} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="mt-3 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-navy bg-navy text-white hover:bg-navy/90 disabled:opacity-50"
        >
          {uploading ? "Attaching…" : "Attach PDF"}
        </button>
        {error && <p role="alert" className="text-[11px] text-red-700 mt-2">{error}</p>}
      </section>
    );
  }

  return (
    <section className="border border-border-brand bg-white p-3.5" aria-labelledby={`checklist-pdf-${piece.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`checklist-pdf-${piece.id}`} className="text-xs font-bold text-navy">Checklist PDF</h4>
          <p className="text-[10px] text-black/45 mt-0.5">Downloadable resource · current version</p>
        </div>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-green-pass">{piece.mayPublish ? "Ready" : "Attached"}</span>
      </div>

      {canDownload && artifact.signedUrl ? (
        <iframe
          title={artifact.filename ? `Preview of ${artifact.filename}` : "Checklist PDF preview"}
          src={`${artifact.signedUrl}#page=1&toolbar=0&navpanes=0`}
          className="w-full h-44 border border-border-brand bg-off-white mt-3"
        />
      ) : (
        <p className="border border-dashed border-border-brand bg-parchment/30 px-3 py-5 mt-3 text-[11px] text-black/45">
          {controlState === "unsigned" ? "Preview unavailable until the signed link is refreshed." : "Preview locked until this version is approved."}
        </p>
      )}

      <p className="text-[11px] font-mono text-black/60 mt-2 break-all">{artifact.filename ?? "Unnamed PDF"}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mt-2 text-[11px]">
        <dt className="text-black/40 uppercase tracking-wider">Format</dt><dd className="text-black/60">PDF</dd>
        <dt className="text-black/40 uppercase tracking-wider">Size</dt><dd className="text-black/60">{formatBytes(artifact.sizeBytes)}</dd>
        {artifact.locale && <><dt className="text-black/40 uppercase tracking-wider">Language</dt><dd className="text-black/60">{artifact.locale}</dd></>}
      </dl>

      <div className="flex flex-wrap gap-2 mt-3">
        {canDownload && artifact.signedUrl ? (
          <a href={artifact.signedUrl} download rel="noreferrer" className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-navy bg-navy text-white hover:bg-navy/90">Download PDF</a>
        ) : (
          <button type="button" aria-disabled="true" className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-black/20 bg-black/10 text-black/40 cursor-not-allowed">Download locked</button>
        )}
        {canDownload && artifact.signedUrl ? (
          <a href={artifact.signedUrl} target="_blank" rel="noreferrer" className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-border-brand text-navy hover:bg-parchment-2">Open preview</a>
        ) : null}
      </div>

      <details className="mt-3 border-t border-border-brand pt-2.5">
        <summary className="text-[10px] uppercase tracking-wider font-semibold text-navy/70 cursor-pointer">Provenance</summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-2 text-[11px]">
          <dt className="text-black/40 uppercase tracking-wider">Bound to version</dt><dd className="text-black/60 font-mono break-all">{artifact.versionId}</dd>
          {artifact.storagePath && <><dt className="text-black/40 uppercase tracking-wider">Storage path</dt><dd className="text-black/60 font-mono break-all">{artifact.storagePath}</dd></>}
          {artifact.sha256 && <><dt className="text-black/40 uppercase tracking-wider">SHA-256</dt><dd className="text-black/60 font-mono break-all">{artifact.sha256}</dd></>}
        </dl>
      </details>

      <div className="mt-3 border-t border-border-brand pt-2.5">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-black/40">Operator-only file management</p>
        <button type="button" onClick={() => setReplaceOpen(true)} className="text-[11px] font-semibold text-navy underline underline-offset-2 mt-1">Replace PDF</button>
      </div>

      {replaceOpen && (
        <div className="mt-3 border border-border-brand bg-parchment p-3" role="dialog" aria-label="New version required">
          <p className="text-xs font-bold text-navy">New version required</p>
          <p className="text-[11px] leading-relaxed text-black/65 mt-1.5">PDF release evidence is append-only. Post and approve a new deliverable version before attaching a replacement PDF.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Link href={`/portal/${firmId}/deliverables/${piece.id}`} className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-navy bg-navy text-white">Open review page</Link>
            <button type="button" onClick={() => setReplaceOpen(false)} className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-border-brand text-navy">Keep current PDF</button>
          </div>
        </div>
      )}
    </section>
  );
}
