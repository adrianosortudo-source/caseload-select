"use client";

/**
 * FileUploader: add a deliverable to the hub, as either a file or a link.
 *
 * File mode posts multipart/form-data with the binary; link mode posts an
 * external_url (+ optional title). Both carry a workstream `section`. On
 * success the component clears and calls router.refresh() so the new card
 * appears. The chosen section persists across refreshes.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FILE_SECTIONS,
  SECTION_LABELS,
  MAX_FILE_SIZE_BYTES,
  formatBytes,
  type FileSection,
  type FileKind,
} from "@/lib/firm-files-pure";

type Mode = "idle" | "uploading" | "success" | "error";

const DEFAULT_SECTION: FileSection = "reports";

export default function FileUploader({ firmId }: { firmId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<FileKind>("file");
  const [section, setSection] = useState<FileSection>(DEFAULT_SECTION);
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setLinkUrl("");
    setLinkTitle("");
    setDescription("");
    setMode("idle");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const form = new FormData();
    form.append("kind", kind);
    form.append("section", section);
    if (description.trim()) form.append("description", description.trim());

    if (kind === "file") {
      if (!file) {
        setError("Choose a file first.");
        setMode("error");
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError(`File exceeds the ${formatBytes(MAX_FILE_SIZE_BYTES)} ceiling.`);
        setMode("error");
        return;
      }
      form.append("file", file);
    } else {
      const url = linkUrl.trim();
      if (!url) {
        setError("Paste a link first.");
        setMode("error");
        return;
      }
      if (!/^https:\/\//i.test(url)) {
        setError("Links must start with https://.");
        setMode("error");
        return;
      }
      form.append("external_url", url);
      if (linkTitle.trim()) form.append("title", linkTitle.trim());
    }

    setMode("uploading");
    setError(null);

    try {
      const res = await fetch(`/api/portal/${firmId}/files`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `Failed (HTTP ${res.status}).`);
        setMode("error");
        return;
      }
      setMode("success");
      setTimeout(() => {
        reset();
        router.refresh();
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setMode("error");
    }
  }

  const dirty = !!file || linkUrl.length > 0 || linkTitle.length > 0 || description.length > 0;

  return (
    <form onSubmit={onSubmit} className="bg-white border border-black/10 p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold uppercase tracking-wider text-navy">Add a file or link</h2>
        {kind === "file" && (
          <span className="text-[11px] text-black/40 uppercase tracking-wider">
            Up to {formatBytes(MAX_FILE_SIZE_BYTES)}
          </span>
        )}
      </div>

      <div className="inline-flex border border-black/15">
        {(["file", "link"] as FileKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setMode("idle");
              setError(null);
            }}
            disabled={mode === "uploading"}
            className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              kind === k ? "bg-navy text-white" : "bg-white text-black/60 hover:text-navy"
            }`}
          >
            {k === "file" ? "File" : "Link"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] items-start">
        {kind === "file" ? (
          <label className="block">
            <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
              File
            </span>
            <input
              ref={inputRef}
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) setMode("idle");
              }}
              disabled={mode === "uploading"}
              className="block w-full text-sm text-black/80 file:mr-3 file:py-2 file:px-3 file:border file:border-black/15 file:bg-parchment file:text-xs file:uppercase file:tracking-wider file:font-semibold file:text-navy hover:file:bg-navy hover:file:text-white transition-colors"
            />
            {file && (
              <span className="mt-1 block text-xs text-black/50">
                {file.name} · {formatBytes(file.size)}
              </span>
            )}
          </label>
        ) : (
          <label className="block">
            <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
              Link URL
            </span>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value);
                setMode("idle");
              }}
              disabled={mode === "uploading"}
              placeholder="https://..."
              className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
            />
          </label>
        )}

        <label className="block min-w-[160px]">
          <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
            Section
          </span>
          <select
            value={section}
            onChange={(e) => setSection(e.target.value as FileSection)}
            disabled={mode === "uploading"}
            className="w-full text-sm px-3 py-2 border border-black/15 bg-white text-black/80 focus:outline-none focus:border-navy"
          >
            {FILE_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {kind === "link" && (
        <label className="block">
          <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
            Title (optional)
          </span>
          <input
            type="text"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            disabled={mode === "uploading"}
            maxLength={200}
            placeholder="What the firm sees on the card."
            className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
          />
        </label>
      )}

      <label className="block">
        <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
          Note (optional)
        </span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={mode === "uploading"}
          placeholder="One line of context. Visible to the recipient."
          maxLength={500}
          className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
        />
      </label>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        {dirty && mode !== "uploading" && (
          <button
            type="button"
            onClick={reset}
            className="text-xs uppercase tracking-wider font-semibold text-black/50 hover:text-navy px-3 py-2"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={mode === "uploading"}
          className="bg-navy text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-40"
        >
          {mode === "uploading"
            ? "Saving…"
            : mode === "success"
              ? "Added"
              : kind === "file"
                ? "Upload"
                : "Add link"}
        </button>
      </div>
    </form>
  );
}
