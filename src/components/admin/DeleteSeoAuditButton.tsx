"use client";

/**
 * DeleteSeoAuditButton: hard-deletes one saved seo_check_runs row.
 * No protective status guard (unlike LeadRowActions) since this table has
 * no inbound FKs and no downstream state that depends on a saved audit.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteSeoAuditButton({ id, domain }: { id: string; domain: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onDelete() {
    if (!confirm(`Delete the saved audit for ${domain}? This cannot be undone.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/seo-check/runs?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
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
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {err && (
        <span className="text-[11px] text-red-700 truncate max-w-[160px]" title={err}>
          {err}
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="text-xs font-display font-semibold uppercase tracking-wider text-red-700 hover:underline disabled:opacity-40"
      >
        {busy ? "…" : "Delete"}
      </button>
    </span>
  );
}
