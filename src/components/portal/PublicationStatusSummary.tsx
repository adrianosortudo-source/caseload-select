/**
 * Deliverable detail: truthful, per-placement publication status. Keeps
 * "Individually approved" distinct from the DR-107 Pre-approved states
 * (product requirement, amended 2026-07-23): each status below maps to
 * exactly one label, or to "individual review required" when neither
 * applies, and never claims a lawyer reviewed a version she did not
 * review.
 */

export type PlacementStatusKind =
  | "individually_approved"
  | "authorized_standing"
  | "eligible_standing"
  | "individual_review_required"
  | "not_yet_released";

export interface PlacementStatusRow {
  placementId: string;
  destination: string;
  kind: PlacementStatusKind;
  effectiveAt: string | null;
  individualReviewReason: string | null;
  publicationVerificationState: "unverified" | "verified" | "failed" | "reconciling" | null;
}

const LABELS: Record<PlacementStatusKind, string> = {
  individually_approved: "Individually approved",
  authorized_standing: "Pre-approved: publishing under standing authorization",
  eligible_standing: "Pre-approved: ready to publish",
  individual_review_required: "Individual review required",
  not_yet_released: "Not yet released",
};

const COLOR: Record<PlacementStatusKind, string> = {
  individually_approved: "text-green-pass",
  authorized_standing: "text-green-pass",
  eligible_standing: "text-navy",
  individual_review_required: "text-amber-700",
  not_yet_released: "text-black/50",
};

export default function PublicationStatusSummary({ rows }: { rows: PlacementStatusRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white border border-border-brand p-4 space-y-3">
      <h3 className="text-sm font-bold text-navy">Publication status</h3>
      <p className="text-[11px] text-black/45">
        Every placement, on either path, must still pass CaseLoad Select&apos;s quality and
        legal-safety checks, metadata, artifact, and placement requirements before release.
      </p>
      {rows.map((row) => (
        <div key={row.placementId} className="text-sm border-t border-border-brand pt-2 first:border-t-0 first:pt-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-black/60 uppercase text-[11px] font-semibold tracking-wider">
              {row.destination}
            </span>
            <span className={`text-xs font-semibold ${COLOR[row.kind]}`}>{LABELS[row.kind]}</span>
          </div>
          <dl className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] text-black/55">
            {row.effectiveAt && (
              <div>
                <dt className="uppercase tracking-wider text-black/40">Effective</dt>
                <dd>{new Date(row.effectiveAt).toLocaleDateString()}</dd>
              </div>
            )}
            {row.individualReviewReason && (
              <div className="col-span-2">
                <dt className="uppercase tracking-wider text-black/40">Why individual review</dt>
                <dd>{row.individualReviewReason}</dd>
              </div>
            )}
            {row.publicationVerificationState && (
              <div>
                <dt className="uppercase tracking-wider text-black/40">Publication</dt>
                <dd className="capitalize">{row.publicationVerificationState}</dd>
              </div>
            )}
          </dl>
        </div>
      ))}
    </div>
  );
}
