"use client";

/**
 * The activation UI for a period with no package manifest yet. A JSON
 * text field, not a file upload -- the manifest is structured data the
 * operator pastes in (from wherever it was authored), matching the
 * no-generic-file-upload non-goal. Renders inline result feedback, same
 * visual pattern as AssetsTabView's operator actions (not extracted into
 * a shared module in this pass).
 */
import { useState } from "react";

interface CreateManifestPanelProps {
  firmId: string;
  periodId: string;
}

export default function CreateManifestPanel({ firmId, periodId }: CreateManifestPanelProps) {
  const [manifestText, setManifestText] = useState("");
  const [expectedPieceCount, setExpectedPieceCount] = useState("");
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function submit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestText);
    } catch {
      setResult({ kind: "error", message: "not valid JSON" });
      return;
    }

    try {
      const res = await fetch(`/api/portal/${firmId}/periods/${periodId}/package-manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest: parsed, expected_piece_count: Number(expectedPieceCount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ kind: "error", message: (json as { error?: string }).error ?? `HTTP ${res.status}` });
        return;
      }
      setResult({ kind: "success", message: `Package created (revision ${(json as { manifestRevision?: number }).manifestRevision}). Reload this page to view it.` });
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : "request failed" });
    }
  }

  return (
    <div className="mt-4 border border-black/10 bg-white p-4 space-y-3 text-left">
      <h2 className="text-sm font-semibold text-navy">Create package manifest</h2>
      <label className="block text-xs text-black/50">
        Expected piece count
        <input
          value={expectedPieceCount}
          onChange={(e) => setExpectedPieceCount(e.target.value)}
          className="block w-full border border-black/15 px-2 py-1 text-sm mt-1"
        />
      </label>
      <label className="block text-xs text-black/50">
        Package manifest JSON
        <textarea
          value={manifestText}
          onChange={(e) => setManifestText(e.target.value)}
          rows={10}
          className="block w-full border border-black/15 px-2 py-1 text-xs font-mono mt-1"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        className="text-xs font-medium text-white bg-navy px-3 py-1.5"
      >
        Create package manifest
      </button>
      {result && (
        <div className={`text-xs px-2.5 py-1.5 border ${result.kind === "success" ? "border-navy/30 bg-navy/5 text-navy" : "border-red-300 bg-red-50 text-red-800"}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}
