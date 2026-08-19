"use client";

import { useState } from "react";
import type { DeliverableStatus } from "@/lib/types";

function localDateValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function ManualPublicationToggle({
  firmId,
  deliverableId,
  viewerRole,
  status,
  publishedAt,
  supportPreview = false,
  onChanged,
}: {
  firmId: string;
  deliverableId: string;
  viewerRole: "operator" | "lawyer";
  status: DeliverableStatus;
  publishedAt: string | null;
  supportPreview?: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const published = Boolean(publishedAt);
  const [date, setDate] = useState(publishedAt ?? localDateValue());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (viewerRole !== "operator" || status === "archived") return null;

  async function update(nextPublished: boolean) {
    if (nextPublished && !date) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_publication_record",
          published: nextPublished,
          published_at: nextPublished ? date : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not update the publication record.");
        return;
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  const dateChanged = published && date !== publishedAt;

  return (
    <section className="border border-border-brand bg-parchment-1 p-4" aria-labelledby="publication-record-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-burgundy">
            Operator record
          </p>
          <h3 id="publication-record-title" className="mt-1 text-sm font-bold text-navy">
            Publication status
          </h3>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-navy">
          <input
            type="checkbox"
            role="switch"
            aria-label="Published in Deliverables"
            checked={published}
            disabled={busy || supportPreview || (!published && !date)}
            onChange={(event) => void update(event.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 border border-navy/30 bg-white transition-colors peer-checked:border-green-pass peer-checked:bg-green-pass peer-disabled:opacity-50">
            <span className="absolute left-0.5 top-0.5 h-3.5 w-3.5 bg-navy transition-transform peer-checked:translate-x-4 peer-checked:bg-white" />
          </span>
          <span>{published ? "Published" : "Not published"}</span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border-brand pt-3">
        <label className="min-w-40 flex-1 text-[10px] font-semibold uppercase tracking-wider text-black/50">
          Actual publication date
          <input
            type="date"
            value={date}
            disabled={busy || supportPreview}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1 block w-full border border-border-brand bg-white px-2 py-1.5 text-sm font-normal tracking-normal text-navy disabled:opacity-50"
          />
        </label>
        {dateChanged && (
          <button
            type="button"
            disabled={busy || supportPreview || !date}
            onClick={() => void update(true)}
            className="border border-navy px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-navy transition-colors hover:bg-navy hover:text-white disabled:opacity-50"
          >
            Update date
          </button>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-black/55">
        This records the external publication status in Deliverables only. It does not publish or remove
        content, change lawyer approval, or create a verified publication receipt.
      </p>
      {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
    </section>
  );
}
