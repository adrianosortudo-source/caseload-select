"use client";

/**
 * LeadRowActions: per-lead operator actions under a triage card.
 *
 *   Active / History view  -> Archive
 *   Archived view          -> Restore + Delete (Delete disabled for taken leads)
 *
 * Rendered as a sibling bar BELOW the card link (never nested inside it) so
 * the buttons don't fight the card's click-through. Refreshes the list on
 * success.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isDeletableStatus } from "@/lib/screened-lead-admin-pure";

type View = "active" | "history" | "archived";
type Busy = null | "archive" | "restore" | "delete";

export default function LeadRowActions({
  id,
  status,
  view,
}: {
  id: string;
  status: string;
  view: View;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [err, setErr] = useState<string | null>(null);

  async function setArchived(archived: boolean, kind: "archive" | "restore") {
    setBusy(kind);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/screened-leads/${id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr((b as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!confirm("Delete this lead permanently? This cannot be undone.")) return;
    setBusy("delete");
    setErr(null);
    try {
      const res = await fetch(`/api/admin/screened-leads/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr((b as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(null);
    }
  }

  const deletable = isDeletableStatus(status);
  const btn =
    "text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1.5 border transition-colors disabled:opacity-40";

  return (
    <div className="mt-1 flex items-center justify-end gap-2">
      {err && (
        <span className="text-[11px] text-red-700 truncate max-w-[260px]" title={err}>
          {err}
        </span>
      )}
      {view !== "archived" ? (
        <button
          type="button"
          onClick={() => setArchived(true, "archive")}
          disabled={!!busy}
          className={`${btn} border-black/20 text-black/60 hover:bg-navy hover:text-white hover:border-navy`}
        >
          {busy === "archive" ? "…" : "Archive"}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setArchived(false, "restore")}
            disabled={!!busy}
            className={`${btn} border-navy/30 text-navy hover:bg-navy hover:text-white`}
          >
            {busy === "restore" ? "…" : "Restore"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!!busy || !deletable}
            title={
              deletable
                ? undefined
                : "This lead became a client matter and cannot be deleted."
            }
            className={`${btn} border-red-300 text-red-700 hover:bg-red-700 hover:text-white hover:border-red-700`}
          >
            {busy === "delete" ? "…" : "Delete"}
          </button>
        </>
      )}
    </div>
  );
}
