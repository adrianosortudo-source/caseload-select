/**
 * CR-14: Content tab (Section 10). "Primarily an inventory and navigation
 * view" -- reuses the same per-piece rows the Overview matrix already
 * computes (asset completeness, CTA completeness, approval, placement)
 * rather than recomputing anything, and adds no content-editing behavior
 * of its own. No data fetching in this component -- props only.
 */
import Link from "next/link";
import type { OverviewRow } from "@/lib/publishing-package-control-room-overview";

interface ContentTabViewProps {
  firmId: string;
  rows: OverviewRow[];
}

function Badge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-black/5 text-black/70 border border-black/10">
      {text}
    </span>
  );
}

export default function ContentTabView({ firmId, rows }: ContentTabViewProps) {
  return (
    <section aria-labelledby="control-room-content-heading" className="space-y-3">
      <h2 id="control-room-content-heading" className="text-sm font-semibold text-navy">
        Package content inventory
      </h2>
      <ul className="space-y-2">
        {rows.map((row) => {
          const assetComplete = row.assetStatus === "release_ready" || row.assetStatus === "rendered_verified" || row.assetStatus === "bound";
          const ctaComplete = row.ctaPdfStatus === "ok" || row.ctaPdfStatus === "not_applicable";
          return (
            <li key={row.contentSlotId} className="border border-black/8 bg-white p-3.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  {row.deliverableId ? (
                    <Link
                      href={`/portal/${firmId}/deliverables/${row.deliverableId}`}
                      className="font-medium text-navy underline underline-offset-2 hover:text-navy/70"
                    >
                      {row.pieceTitle}
                    </Link>
                  ) : (
                    <span className="font-medium text-navy">{row.pieceTitle}</span>
                  )}
                  <div className="text-xs text-black/50 mt-0.5">
                    Slot: {row.contentSlotId} · {row.locale} · {row.destination}
                    {row.sourceVersionId ? <> · source {row.sourceVersionId.slice(0, 8)}</> : " · no source version resolved"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <Badge text={`Assets: ${assetComplete ? "complete" : "incomplete"}`} />
                  <Badge text={`CTA: ${ctaComplete ? "complete" : "incomplete"}`} />
                  <Badge text={`Approval: ${row.approvalState}`} />
                  <Badge text={`Placement: ${row.placement.replace(/_/g, " ")}`} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
