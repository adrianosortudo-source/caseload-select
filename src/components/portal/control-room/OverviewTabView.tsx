/**
 * CR-13: Overview tab presentational component (Section 9). Pure props-in,
 * no data fetching -- the real route wraps this with a server-side loader;
 * the fixture preview route (src/app/dev/control-room-preview) feeds it
 * directly from the DRG fixture so it can be verified without a database
 * or portal session.
 *
 * Responsive per Section 20: a real <table> on desktop (accessible,
 * semantic), stacked cards on mobile -- never a horizontally-scrolling
 * 13-column table shoved onto a phone. Status is always paired with text,
 * never conveyed by colour alone.
 */
import Link from "next/link";
import type { OverviewViewModel, OverviewRow, AssetStatus } from "@/lib/publishing-package-control-room-overview";

interface OverviewTabViewProps {
  firmId: string;
  periodId: string;
  periodTitle: string;
  periodDates: string;
  viewModel: OverviewViewModel;
}

const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  required: "Required", missing: "Missing", candidate: "Candidate",
  visually_selected: "Selected", hash_verified: "Hash verified", uploaded: "Uploaded",
  bound: "Bound", rendered_verified: "Rendered verified", release_ready: "Release ready",
  blocked: "Blocked", rejected: "Rejected", superseded: "Superseded", not_planned: "Not planned",
};

function StatusPill({ text, tone }: { text: string; tone: "ok" | "warn" | "bad" | "neutral" }) {
  const toneClass = {
    ok: "bg-navy/8 text-navy border-navy/20",
    warn: "bg-gold/15 text-navy border-gold/40",
    bad: "bg-red-50 text-red-800 border-red-200",
    neutral: "bg-black/5 text-black/60 border-black/10",
  }[tone];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border ${toneClass}`}>
      {text}
    </span>
  );
}

function toneForAssetStatus(status: AssetStatus): "ok" | "warn" | "bad" | "neutral" {
  if (status === "blocked" || status === "rejected") return "bad";
  if (status === "release_ready" || status === "rendered_verified" || status === "bound") return "ok";
  if (status === "not_planned") return "neutral";
  return "warn";
}

function toneForApproval(state: string): "ok" | "warn" | "bad" | "neutral" {
  if (state === "approved") return "ok";
  if (state === "changes_requested") return "bad";
  return "warn";
}

function ProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-black/60 mb-1">
        <span className="font-medium text-navy">{label}</span>
        <span>{done}/{total}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}: ${done} of ${total} complete`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 bg-black/5 overflow-hidden"
      >
        <div className="h-full bg-navy/70" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-black/40">{label}</div>
      <div className="text-lg font-semibold text-navy tabular-nums">{value}</div>
    </div>
  );
}

function rowHref(firmId: string, row: OverviewRow): string | null {
  if (!row.deliverableId) return null;
  return `/portal/${firmId}/deliverables/${row.deliverableId}`;
}

export default function OverviewTabView({ firmId, periodId, periodTitle, periodDates, viewModel }: OverviewTabViewProps) {
  const { header, progress, rows } = viewModel;

  return (
    <div className="space-y-6">
      <section aria-labelledby="control-room-overview-heading" className="bg-white border border-black/8 p-4 sm:p-6 space-y-5">
        <div>
          <h1 id="control-room-overview-heading" className="text-lg font-semibold text-navy">{periodTitle}</h1>
          <p className="text-sm text-black/50">{periodDates}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <HeaderStat label="Package status" value={header.packageStatus} />
          <HeaderStat label="Planned pieces" value={`${header.expectedPieceCount} planned`} />
          <HeaderStat label="Actual pieces" value={header.actualPieceCount} />
          <HeaderStat label="Content ready" value={header.contentReadyCount} />
          <HeaderStat label="Assets ready" value={header.assetReadyCount} />
          <HeaderStat label="Blocked" value={header.blockedCount} />
          <HeaderStat label="Approved" value={header.approvalCount} />
          <HeaderStat label="Release ready" value={header.releaseReadyCount} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 pt-2 border-t border-black/5">
          <ProgressBar label="Content" done={progress.content.done} total={progress.content.total} />
          <ProgressBar label="Assets" done={progress.assets.done} total={progress.assets.total} />
          <ProgressBar label="Localization" done={progress.localization.done} total={progress.localization.total} />
          <ProgressBar label="Review" done={progress.review.done} total={progress.review.total} />
          <ProgressBar label="Release" done={progress.release.done} total={progress.release.total} />
        </div>
      </section>

      <section aria-labelledby="control-room-matrix-heading">
        <h2 id="control-room-matrix-heading" className="text-sm font-semibold text-navy mb-3">
          Weekly content matrix
        </h2>

        {/* Desktop: real accessible table. Hidden below sm. */}
        <div className="hidden sm:block overflow-x-auto border border-black/8">
          <table className="w-full text-sm border-collapse">
            <caption className="sr-only">Every planned piece in this week&apos;s package, with content, asset, CTA, approval, and release status.</caption>
            <thead>
              <tr className="bg-parchment-2 text-left text-xs uppercase tracking-wider text-black/50">
                <th scope="col" className="p-2.5">Piece</th>
                <th scope="col" className="p-2.5">Format</th>
                <th scope="col" className="p-2.5">Locale</th>
                <th scope="col" className="p-2.5">Destination</th>
                <th scope="col" className="p-2.5">Source/version</th>
                <th scope="col" className="p-2.5">Content status</th>
                <th scope="col" className="p-2.5">Required asset</th>
                <th scope="col" className="p-2.5">Actual asset</th>
                <th scope="col" className="p-2.5">Asset status</th>
                <th scope="col" className="p-2.5">CTA/PDF</th>
                <th scope="col" className="p-2.5">Approval</th>
                <th scope="col" className="p-2.5">Placement</th>
                <th scope="col" className="p-2.5">Release blockers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = rowHref(firmId, row);
                const titleCell = href ? (
                  <Link href={href} className="text-navy underline underline-offset-2 hover:text-navy/70">{row.pieceTitle}</Link>
                ) : (
                  <span>{row.pieceTitle}</span>
                );
                return (
                  <tr key={row.contentSlotId} className="border-t border-black/5 align-top">
                    <td className="p-2.5 font-medium max-w-[220px]">{titleCell}</td>
                    <td className="p-2.5 whitespace-nowrap">{row.format}</td>
                    <td className="p-2.5 whitespace-nowrap">{row.locale}</td>
                    <td className="p-2.5 whitespace-nowrap">{row.destination}</td>
                    <td className="p-2.5 whitespace-nowrap text-black/50">{row.sourceVersionId ? row.sourceVersionId.slice(0, 8) : "—"}</td>
                    <td className="p-2.5"><StatusPill text={row.contentStatus} tone={toneForApproval(row.contentStatus)} /></td>
                    <td className="p-2.5 whitespace-nowrap">{row.requiredAssetSummary}</td>
                    <td className="p-2.5 max-w-[160px] truncate" title={row.actualAssetSummary}>{row.actualAssetSummary}</td>
                    <td className="p-2.5"><StatusPill text={ASSET_STATUS_LABEL[row.assetStatus]} tone={toneForAssetStatus(row.assetStatus)} /></td>
                    <td className="p-2.5 whitespace-nowrap">{row.ctaPdfStatus === "not_applicable" ? "—" : row.ctaPdfStatus.replace(/_/g, " ")}</td>
                    <td className="p-2.5"><StatusPill text={row.approvalState} tone={toneForApproval(row.approvalState)} /></td>
                    <td className="p-2.5 whitespace-nowrap">{row.placement.replace(/_/g, " ")}</td>
                    <td className="p-2.5 max-w-[240px]">
                      {row.releaseBlockers.length === 0 ? (
                        <span className="text-black/40">none</span>
                      ) : (
                        <ul className="list-disc list-inside space-y-0.5">
                          {row.releaseBlockers.map((b, i) => (
                            <li key={i} className="text-red-800">{b}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: stacked cards, one per piece. Visible below sm only. */}
        <div className="sm:hidden space-y-3">
          {rows.map((row) => {
            const href = rowHref(firmId, row);
            return (
              <div key={row.contentSlotId} className="border border-black/8 bg-white p-3.5 space-y-2.5">
                <div>
                  {href ? (
                    <Link href={href} className="text-navy font-medium underline underline-offset-2">{row.pieceTitle}</Link>
                  ) : (
                    <span className="font-medium text-navy">{row.pieceTitle}</span>
                  )}
                  <div className="text-xs text-black/50 mt-0.5">{row.format} · {row.locale} · {row.destination}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusPill text={row.contentStatus} tone={toneForApproval(row.contentStatus)} />
                  <StatusPill text={ASSET_STATUS_LABEL[row.assetStatus]} tone={toneForAssetStatus(row.assetStatus)} />
                  <StatusPill text={row.approvalState} tone={toneForApproval(row.approvalState)} />
                </div>
                <div className="text-xs text-black/60 break-words">
                  <span className="font-medium">Asset:</span> {row.actualAssetSummary}
                </div>
                {row.releaseBlockers.length > 0 && (
                  <ul className="text-xs text-red-800 list-disc list-inside space-y-0.5">
                    {row.releaseBlockers.map((b, i) => (
                      <li key={i} className="break-words">{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
