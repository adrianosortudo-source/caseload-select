"use client";

/**
 * FileUploader — single-file picker + category select + optional description.
 *
 * Uploads via multipart/form-data POST to /api/portal/[firmId]/files. On
 * success, calls router.refresh() so the file list re-renders with the new
 * row included. The component itself stays mounted across refreshes so the
 * lawyer's selected category persists.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORY_LABELS,
  FILE_CATEGORIES,
  MAX_FILE_SIZE_BYTES,
  formatBytes,
  type FileCategory,
} from "@/lib/firm-files-pure";

type Mode = "idle" | "uploading" | "success" | "error";

const DEFAULT_CATEGORY: FileCategory = "report";

export default function FileUploader({ firmId }: { firmId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<FileCategory>(DEFAULT_CATEGORY);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setDescription("");
    setMode("idle");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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

    setMode("uploading");
    setError(null);

    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    if (description.trim()) form.append("description", description.trim());

    try {
      const res = await fetch(`/api/portal/${firmId}/files`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `Upload failed (HTTP ${res.status}).`);
        setMode("error");
        return;
      }
      setMode("success");
      // Brief visual pause, then clear + refresh.
      setTimeout(() => {
        reset();
        router.refresh();
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setMode("error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-black/10 p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold uppercase tracking-wider text-navy">Upload a file</h2>
        <span className="text-[11px] text-black/40 uppercase tracking-wider">
          Up to {formatBytes(MAX_FILE_SIZE_BYTES)}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] items-start">
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

        <label className="block min-w-[160px]">
          <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
            Category
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FileCategory)}
            disabled={mode === "uploading"}
            className="w-full text-sm px-3 py-2 border border-black/15 bg-white text-black/80 focus:outline-none focus:border-navy"
          >
            {FILE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

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
        {file && mode !== "uploading" && (
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
          disabled={!file || mode === "uploading"}
          className="bg-navy text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-40"
        >
          {mode === "uploading" ? "Uploading…" : mode === "success" ? "Uploaded" : "Upload"}
        </button>
      </div>
    </form>
  );
}
