"use client";

/**
 * DeliverableCard: one clickable card in the deliverables hub.
 *
 * Click opens the item: a file resolves a 60-second signed download URL,
 * a link resolves its external URL (both via GET /files/[id], which also
 * audit-logs the access). Archived cards render muted and non-interactive.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fileTypeLabel, formatBytes, type FileKind } from "@/lib/firm-files-pure";

interface Props {
  firmId: string;
  id: string;
  kind: FileKind;
  displayName: string;
  description: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  externalUrl: string | null;
  uploadedByRole: "operator" | "lawyer";
  createdAt: string;
  archived: boolean;
}

type State = "idle" | "opening" | "archiving" | "error";

export default function DeliverableCard(props: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const isLink = props.kind === "link";
  const typeLabel = fileTypeLabel({
    kind: props.kind,
    mimeType: props.mimeType,
    displayName: props.displayName,
  });
  const chipClass = `flex-none inline-flex items-center justify-center font-mono font-bold text-[10px] tracking-wider px-2 h-9 min-w-[44px] border ${
    isLink ? "bg-parchment-2 text-navy border-border-brand" : "bg-parchment text-navy border-border-brand"
  }`;

  async function onOpen() {
    if (state !== "idle") return;
    setState("opening");
    setErrMsg(null);
    try {
      const res = await fetch(`/api/portal/${props.firmId}/files/${props.id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrMsg((body as { error?: string }).error ?? `HTTP ${res.status}`);
        setState("error");
        return;
      }
      const url = (body as { url?: string }).url;
      if (!url) {
        setErrMsg("No URL returned.");
        setState("error");
        return;
      }
      window.open(url, "_blank", "noopener");
      setState("idle");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  async function onArchive(e: React.MouseEvent) {
    e.stopPropagation();
    if (state !== "idle") return;
    if (!confirm("Archive this item? It stays in the audit trail but disappears from the list.")) {
      return;
    }
    setState("archiving");
    setErrMsg(null);
    try {
      const res = await fetch(`/api/portal/${props.firmId}/files/${props.id}`, { method: "DELETE" });
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

  if (props.archived) {
    return (
      <div className="bg-white border border-border-brand opacity-60 flex gap-3 p-4">
        <span className={chipClass}>{typeLabel}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-navy break-words">{props.displayName}</span>
            <UploaderTag role={props.uploadedByRole} />
          </div>
          <div className="mt-1.5 text-[11px] text-black/40 uppercase tracking-wider">
            Archived · {formatDate(props.createdAt)}
          </div>
        </div>
      </div>
    );
  }

  const metaLeft = isLink ? "Link" : `${typeLabel} · ${formatBytes(props.sizeBytes ?? 0)}`;

  return (
    <div className="group bg-white border border-border-brand hover:border-navy/40 transition-colors">
      <button
        type="button"
        onClick={onOpen}
        disabled={state === "opening"}
        className="w-full text-left flex gap-3 p-4 disabled:opacity-60"
      >
        <span className={chipClass}>{typeLabel}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-navy break-words">{props.displayName}</span>
            <UploaderTag role={props.uploadedByRole} />
          </span>
          {props.description && (
            <span className="mt-1 block text-xs text-black/60 break-words">{props.description}</span>
          )}
          <span className="mt-1.5 flex items-center gap-2 text-[11px] text-black/40 uppercase tracking-wider">
            <span>{metaLeft}</span>
            <span aria-hidden>·</span>
            <span>{formatDate(props.createdAt)}</span>
          </span>
        </span>
        <span
          className="flex-none self-center text-black/30 group-hover:text-navy transition-colors"
          aria-hidden
        >
          {state === "opening" ? "…" : isLink ? "↗" : "↓"}
        </span>
      </button>
      <div className="flex items-center justify-end gap-2 px-4 pb-2 -mt-1">
        {state === "error" && errMsg && (
          <span className="text-[11px] text-red-fail truncate max-w-[200px]" title={errMsg}>
            {errMsg}
          </span>
        )}
        <button
          type="button"
          onClick={onArchive}
          disabled={state !== "idle"}
          className="text-[10px] uppercase tracking-wider font-semibold text-black/40 hover:text-red-fail disabled:opacity-40"
        >
          {state === "archiving" ? "…" : "Archive"}
        </button>
      </div>
    </div>
  );
}

function UploaderTag({ role }: { role: "operator" | "lawyer" }) {
  const label = role === "operator" ? "From operator" : "From firm";
  const colour =
    role === "operator"
      ? "bg-navy/5 text-navy border-navy/15"
      : "bg-parchment-2 text-navy border-border-brand";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${colour}`}>
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
