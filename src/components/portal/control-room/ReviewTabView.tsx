/**
 * CR-19/20: Review tab (Section 14). Operator and lawyer/client
 * presentations from the same ReviewPackageView -- the split already
 * happened in filterPackageForViewer, so this component just renders
 * whichever payload it's given differently by viewerRole.
 */
import type { ReviewPackageView } from "@/lib/publishing-package-control-room-review";

interface ReviewTabViewProps {
  view: ReviewPackageView;
}

export default function ReviewTabView({ view }: ReviewTabViewProps) {
  if (view.viewerRole === "lawyer") {
    return (
      <section aria-labelledby="control-room-review-heading" className="space-y-4">
        <h2 id="control-room-review-heading" className="text-sm font-semibold text-navy">
          This week&apos;s content, at a glance
        </h2>
        <p className="text-xs text-black/60 border border-black/10 bg-parchment-2 px-3 py-2">
          Reviewing or preferring an image does not approve, publish, replace, or authorize the related content.
        </p>
        <ul className="space-y-2">
          {view.pieces.map((piece) => (
            <li key={piece.contentSlotId} className="border border-black/8 bg-white p-3.5">
              <div className="font-medium text-navy">{piece.pieceTitle}</div>
              <div className="text-xs text-black/50 mt-0.5">{piece.locale} · {piece.destination}</div>
              <div className="text-xs text-black/60 mt-2">
                {piece.selectedAsset ? `Selected visual: ${piece.selectedAsset.filename}` : "No visual selected yet"}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-black/5 text-black/70 border border-black/10">
                  Content status: {piece.sourceContentStatus}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-black/5 text-black/70 border border-black/10">
                  {piece.approvalState}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section aria-labelledby="control-room-review-heading" className="space-y-4">
      <h2 id="control-room-review-heading" className="text-sm font-semibold text-navy">
        Review -- all {view.pieces.length} pieces
      </h2>
      <ul className="space-y-2">
        {view.pieces.map((piece) => (
          <li key={piece.contentSlotId} className="border border-black/8 bg-white p-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-medium text-navy">{piece.pieceTitle}</div>
              <span className="text-[11px] text-black/50">{piece.locale} · {piece.destination} · {piece.placementStatus.replace(/_/g, " ")}</span>
            </div>
            <div className="text-xs text-black/60 mt-1">
              Content: {piece.sourceContentStatus} · Approval: {piece.approvalState}
            </div>
            {piece.candidates.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {piece.candidates.map((c) => (
                  <span
                    key={c.assetId}
                    className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium border ${
                      c.isSelected ? "bg-navy text-white border-navy" : "bg-black/5 text-black/60 border-black/10"
                    }`}
                    title={c.sha256}
                  >
                    {c.filename} · {c.status}
                  </span>
                ))}
              </div>
            )}
            {piece.releaseBlockers.length > 0 && (
              <ul className="mt-2 text-[11px] text-red-800 list-disc list-inside">
                {piece.releaseBlockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
