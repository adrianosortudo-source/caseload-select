"use client";

import { useEffect, useState } from "react";
import {
  buildPlacementTrackingQueryString,
  appendPlacementTracking,
} from "@/lib/content-placement-tracking-pure";
import type { ContentPlacement, PlacementDestination, PublicationReceipt } from "@/lib/types";

const DESTINATION_LABELS: Record<PlacementDestination, string> = {
  firm_website: "Firm website",
  linkedin_article: "LinkedIn article",
  linkedin_post: "LinkedIn post",
  linkedin_company_page: "LinkedIn company page",
  google_business_profile: "Google Business Profile",
  email_delivery: "Email",
};

interface Props {
  firmId: string;
  deliverableId: string;
}

/**
 * Operator-only. Lists this deliverable's placements and the tracking
 * parameters to use when publishing each one -- the loop
 * Content Performance / Content-to-Matter Attribution depends on: a
 * lead's evidence only links back to a placement when utm_content
 * exactly equals that placement's id.
 *
 * Read-only helper, not a full placements management UI (there is none
 * yet in this app -- placements/receipts are currently API-only). This
 * panel exists to make the tracking parameters discoverable, not to
 * replace a future dedicated publishing workflow.
 */
export default function PlacementsTrackingPanel({ firmId, deliverableId }: Props) {
  const [placements, setPlacements] = useState<ContentPlacement[] | null>(null);
  const [receiptsByPlacement, setReceiptsByPlacement] = useState<Record<string, PublicationReceipt[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [baseUrlByPlacement, setBaseUrlByPlacement] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}/placements`);
      if (cancelled) return;
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not load placements.");
        return;
      }
      setPlacements(json.placements as ContentPlacement[]);
      const entries = await Promise.all(
        (json.placements as ContentPlacement[]).map(async (p) => {
          const r = await fetch(
            `/api/portal/${firmId}/deliverables/${deliverableId}/placements/${p.id}/receipts`,
          );
          const rj = await r.json();
          return [p.id, r.ok && rj.ok ? (rj.receipts as PublicationReceipt[]) : []] as const;
        }),
      );
      if (!cancelled) setReceiptsByPlacement(Object.fromEntries(entries));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [firmId, deliverableId]);

  if (error) {
    return <div className="text-xs text-rose-600">{error}</div>;
  }
  if (!placements) {
    return <div className="text-xs text-black/40">Loading placements...</div>;
  }
  if (placements.length === 0) {
    return (
      <div className="text-xs text-black/40">
        No placements exist for this deliverable yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {placements.map((placement) => {
        const query = buildPlacementTrackingQueryString(placement.id, placement.destination);
        const receipts = receiptsByPlacement[placement.id] ?? [];
        const hasReceipt = receipts.length > 0;
        const baseUrl = baseUrlByPlacement[placement.id] ?? "";
        const combined = baseUrl ? appendPlacementTracking(baseUrl, placement.id, placement.destination) : null;

        return (
          <div key={placement.id} className="border border-black/8 rounded p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">
                {DESTINATION_LABELS[placement.destination]}
                {placement.locale ? ` (${placement.locale})` : ""}
              </div>
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
                  hasReceipt ? "bg-emerald-50 text-emerald-700" : "bg-black/5 text-black/50"
                }`}
              >
                {hasReceipt ? "Published with receipt" : placement.state}
              </span>
            </div>

            <div className="mt-2 text-xs text-black/50">Tracking parameters (utm_content is this placement&apos;s id):</div>
            <code className="block mt-1 text-[11px] bg-black/[0.03] rounded px-2 py-1 break-all">{query}</code>

            {placement.destination === "firm_website" && !hasReceipt && (
              <div className="mt-2">
                <label className="block text-[11px] text-black/50 mb-1">
                  Paste the page&apos;s real URL to get the exact link to use:
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) =>
                    setBaseUrlByPlacement((prev) => ({ ...prev, [placement.id]: e.target.value }))
                  }
                  placeholder="https://firm-site.example.com/journal/article"
                  className="w-full text-xs border border-black/12 rounded px-2 py-1"
                />
                {combined && (
                  <code className="block mt-1 text-[11px] bg-black/[0.03] rounded px-2 py-1 break-all">
                    {combined}
                  </code>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
