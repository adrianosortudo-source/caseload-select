"use client";

/**
 * FileRowActions — per-row Download + Archive actions.
 *
 * Download flow:
 *   1. POST GET /api/portal/[firmId]/files/[id] -> { url, expires_in_seconds }
 *   2. Open the signed URL in a new tab; the response sets
 *      Content-Disposition: attachment with the original display_name.
 *
 * Archive flow:
 *   DELETE /api/portal/[firmId]/files/[id] -> { ok: true }, then refresh.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  firmId: string;
  fileId: string;
  archived: boolean;
}

type State = "idle" | "downloading" | "archiving" | "error";

export default function FileRowActions({ firmId, fileId, archived }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function onDownload() {
    if (state !== "idle") return;
    setState("downloading");
    setErrMsg(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/files/${fileId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrMsg((body as { error?: string }).error ?? `HTTP ${res.status}`);
        setState("error");
        return;
      }
      const url = (body as { url?: string }).url;
      if (!url) {
        setErrMsg("Signed URL missing in response.");
        setState("error");
        return;
      }
      // Open in a new tab; browser handles the actual download via
      // Content-Disposition: attachment baked into the signed URL.
      window.open(url, "_blank", "noopener");
      setState("idle");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  async function onArchive() {
    if (state !== "idle") return;
    if (!confirm("Archive this file? It stays in the audit trail but disappears from the list.")) {
      return;
    }
    setState("archiving");
    setErrMsg(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/files/${fileId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrMsg((body as { error?: string }).error ?? `HTTP ${res.status}`);
        setState("error");
        return;
      }
      setState("idle");
      router.refresh();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      {state === "error" && errMsg && (
        <span className="text-[11px] text-red-700 truncate max-w-[180px]" title={errMsg}>
          {errMsg}
        </span>
      )}
      {!archived && (
        <button
          type="button"
          onClick={onDownload}
          disabled={state !== "idle"}
          className="text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors disabled:opacity-40"
        >
          {state === "downloading" ? "Opening…" : "Download"}
        </button>
      )}
      {!archived && (
        <button
          type="button"
          onClick={onArchive}
          disabled={state !== "idle"}
          className="text-[11px] uppercase tracking-wider font-semibold px-2 py-1.5 text-black/50 hover:text-red-700 disabled:opacity-40"
          title="Archive"
        >
          {state === "archiving" ? "…" : "Archive"}
        </button>
      )}
      {archived && (
        <span className="text-[11px] uppercase tracking-wider text-black/40">Archived</span>
      )}
    </div>
  );
}
