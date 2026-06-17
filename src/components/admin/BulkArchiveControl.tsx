"use client";

/**
 * BulkArchiveControl: archive finalised leads (passed / referred / declined)
 * older than a chosen age. Shown on the History view. Respects the active
 * firm filter when one is set. Triaging and taken leads are never touched.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BulkArchiveControl({ firmId }: { firmId: string | null }) {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    const scope = firmId ? "for this firm" : "across all firms";
    if (
      !confirm(
        `Archive every finalised lead (passed, referred, declined) older than ${days} days ${scope}? They move to the Archived tab and can be restored.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/screened-leads/bulk-archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ olderThanDays: days, firmId }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr((b as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const count = (b as { count?: number }).count ?? 0;
      setNotice(count === 0 ? "Nothing older than that to archive." : `Archived ${count} lead${count === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-black/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider font-semibold text-black/50">
          Archive finalised older than
        </span>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          disabled={busy}
          className="text-xs px-2 py-1.5 border border-black/15 bg-white text-black/80 focus:outline-none focus:border-navy"
        >
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
        </select>
        {notice && <span className="text-[11px] text-emerald-800">{notice}</span>}
        {err && <span className="text-[11px] text-red-700">{err}</span>}
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="text-xs uppercase tracking-wider font-semibold px-3 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors disabled:opacity-40"
      >
        {busy ? "Archiving…" : "Archive batch"}
      </button>
    </div>
  );
}
