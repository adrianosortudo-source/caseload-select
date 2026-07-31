"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { HERO_UPLOAD_ACCEPT, heroUploadPath, isAllowedHeroFile, readHeroUploadError } from "./hero-image-control-pure";

export default function HeroImageControl({
  firmId, deliverableId, deliverableTitle, hasHero, onSaved,
}: {
  firmId: string; deliverableId: string; deliverableTitle: string; hasHero: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  function clearSelection() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setFile(null); setPreviewUrl(null); setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setError(null);
    if (!nextFile) return;
    if (!isAllowedHeroFile(nextFile)) {
      setError("Choose a PNG, JPG, JPEG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreviewUrl = URL.createObjectURL(nextFile);
    previewUrlRef.current = nextPreviewUrl;
    setFile(nextFile); setPreviewUrl(nextPreviewUrl);
  }

  async function saveHero() {
    if (!file || saving) return;
    setSaving(true); setError(null);
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(heroUploadPath(firmId, deliverableId), { method: "POST", body });
      if (!response.ok) { setError(await readHeroUploadError(response)); return; }
      clearSelection(); await onSaved();
    } catch { setError("Could not save hero image. Check your connection and try again."); }
    finally { setSaving(false); }
  }

  const actionLabel = hasHero ? "Replace hero image" : "Add hero image";
  return (
    <section className="border border-border-brand bg-parchment-2 p-4" aria-label="Hero image controls">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-black/45">Operator control</p>
          <h2 className="text-sm font-semibold text-navy mt-1">{actionLabel}</h2>
          <p className="text-xs text-black/55 mt-1">PNG, JPG, JPEG, or WebP · max 10 MB</p>
        </div>
        {!file && (
          <label className="inline-flex cursor-pointer items-center border border-navy bg-white px-3 py-2 text-xs font-semibold text-navy transition-colors hover:bg-navy hover:text-white focus-within:ring-2 focus-within:ring-navy focus-within:ring-offset-2">
            Choose image
            <input ref={inputRef} type="file" accept={HERO_UPLOAD_ACCEPT} onChange={onFileChange} className="sr-only" aria-label={`${actionLabel} for ${deliverableTitle}`} />
          </label>
        )}
      </div>
      {previewUrl && file && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[120px_1fr] items-center">
          <img src={previewUrl} alt={`Selected hero image for ${deliverableTitle}`} className="h-20 w-full object-cover border border-border-brand bg-white" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-navy truncate" title={file.name}>{file.name}</p>
            <p className="text-[11px] text-black/50 mt-0.5">Ready to save. The current hero remains unchanged until you confirm.</p>
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={saveHero} disabled={saving} className="border border-navy bg-navy px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving hero image..." : "Save hero image"}</button>
              <button type="button" onClick={clearSelection} disabled={saving} className="border border-border-brand bg-white px-3 py-2 text-xs font-semibold text-navy transition-colors hover:bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 disabled:opacity-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs font-medium text-red-fail">{error}</p>}
    </section>
  );
}
