"use client";

/**
 * PublishKit: the client-side rendering of one period's publish kit.
 *
 * All interactivity (filters, clipboard, downloads, provenance disclosure)
 * lives here; the server page only fetches and maps the bundle. Reads
 * exclusively from the view model in @/lib/publish-kit-pure -- no
 * re-derivation of may_publish, no independent readiness logic.
 */

import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  toAgentRecord,
  toAgentManifest,
  artifactControlState,
  copyColumnMessage,
  pieceMatchesFilter,
  filteredTotals,
  blockedPiecesAreFullyWithheld,
  type PublishKitView,
  type PublishKitPiece,
  type ConstraintReading,
  type ArtifactControlState,
  type PublisherLane,
} from "@/lib/publish-kit-pure";

interface Props {
  view: PublishKitView;
  firmId: string;
}

type ChannelFilter = "all" | "firm_website" | "linkedin" | "google_business_profile";
type PublisherFilter = "any" | "manual" | "pipeline";

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-CA", { day: "numeric", month: "long", year: "numeric" });
}

function formatByteCount(bytes: number): string {
  return `${bytes.toLocaleString("en-CA")} bytes`;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "piece";
}

// Record, not a chain of ifs: adding a member to PublisherLane now fails the
// build here until it is given a label, instead of silently falling through
// to "Publisher unknown".
const PUBLISHER_LANE_LABEL: Record<PublisherLane, string> = {
  pipeline: "Pipeline",
  manual: "Posted by hand",
  unknown: "Publisher unknown",
};

function laneLabel(lane: PublishKitPiece["lane"]): string {
  return PUBLISHER_LANE_LABEL[lane];
}

// Record, not a chain of ternaries: adding a member to ArtifactControlState
// now fails the build here until it is given a label, instead of silently
// falling through to "Download locked" -- the failure mode that let a
// signing failure mislabel as a permission decision between rounds 2 and 3.
// "download" is excluded: that state renders a working anchor, not a
// disabled button with a label.
const ARTIFACT_CONTROL_LABEL: Record<ArtifactControlState, string> = {
  no_file: "No stored file for this artifact.",
  other_version: "Different version",
  retracted: "Retracted",
  unapproved: "Not approved",
  locked: "Download locked",
  unsigned: "Link unavailable, refresh",
  // Defensive only, and deliberately not Exclude<..., "download">.
  // artifactControlState returns "unsigned" whenever signedUrl is falsy, so
  // "download" cannot reach the disabled branch today. Keeping the key makes
  // the lookup total and removes the cast that was the one hole in this
  // Record's whole purpose: without it, a change dropping the `&& signedUrl`
  // conjunct below would render a button labelled `undefined` -- no build
  // error, in a file vitest never collects.
  download: "Link unavailable, refresh",
};

function artifactTypeLabel(artifactType: string): string {
  return artifactType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback below
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function PublishKit({ view, firmId }: Props) {
  const router = useRouter();
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [publisherFilter, setPublisherFilter] = useState<PublisherFilter>("any");
  const [toast, setToast] = useState<string | null>(null);
  // Typed as `number`, not ReturnType<typeof setTimeout>: this file's ambient
  // setTimeout resolves to Node's overload (via @types/node) even though the
  // call below is window.setTimeout, which returns a number in the browser.
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(message: string) {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 2200);
  }

  async function handleCopy(text: string, label: string) {
    const ok = await copyToClipboard(text);
    showToast(ok ? `${label} copied` : "Clipboard blocked. Select the text and copy manually.");
  }

  async function handleCopyManifest() {
    const manifest = toAgentManifest(view);
    const ok = await copyToClipboard(JSON.stringify(manifest, null, 2));
    showToast(ok ? "Week manifest copied" : "Clipboard blocked. Select the text and copy manually.");
  }

  // "all" / "any" are the component's own sentinel values for "no filter on
  // this dimension"; the pure layer speaks null instead, so the mapping
  // happens here at the boundary rather than leaking sentinels into
  // publish-kit-pure.ts.
  const pieceFilter = {
    channel: channelFilter === "all" ? null : channelFilter,
    lane: publisherFilter === "any" ? null : publisherFilter,
  };

  const visibleGroups = view.groups
    .map((group) => ({ ...group, pieces: group.pieces.filter((p) => pieceMatchesFilter(p, pieceFilter)) }))
    .filter((group) => group.pieces.length > 0);

  const nothingMatches = visibleGroups.length === 0 && view.groups.length > 0;

  // The pieces actually rendered below, which is the set the banner's claim
  // must be about -- evaluating it over the whole period would describe
  // material the filter is hiding.
  const visiblePieces = visibleGroups.flatMap((group) => group.pieces);

  // The header chips and the blocked banner must describe what is actually
  // visible below, not the whole period's totals -- otherwise, with a filter
  // active, the header can read "14 total / 2 blocked" while the list shows
  // 3 pieces and neither blocked one, and the banner's "shown on each piece
  // below" becomes a lie. filteredTotals's isFiltered gates the "(filtered)"
  // suffix so these numbers are never mistaken for the period's real totals.
  const displayedTotals = filteredTotals(view, pieceFilter);

  return (
    <div className="space-y-6 pb-16">
      <header className="bg-white border border-border-brand p-5 sm:p-6">
        <Link
          href={`/portal/${firmId}/deliverables`}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-border-brand text-navy hover:bg-parchment-2 mb-4"
        >
          {/* aria-hidden: the arrow is decoration, the label already says where this goes. */}
          <span aria-hidden="true">&larr;</span>
          Back to deliverables
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-black/40">
              {formatDate(view.startsOn)} to {formatDate(view.endsOn)} &middot;{" "}
              {view.firmName ?? "Unnamed firm"}
            </p>
            <h1 className="text-xl font-bold text-navy mt-1">{view.periodTitle ?? "Publish Kit"}</h1>
          </div>
          <div className="flex gap-2 flex-none">
            <button
              type="button"
              onClick={handleCopyManifest}
              className="text-xs font-semibold uppercase tracking-wider px-3 py-2 border border-navy bg-navy text-white hover:bg-navy/90"
            >
              Copy week manifest
            </button>
            <button
              type="button"
              onClick={() => router.refresh()}
              title="Download links expire; refresh this page to get new ones"
              className="text-xs font-semibold uppercase tracking-wider px-3 py-2 border border-border-brand text-navy hover:bg-parchment-2"
            >
              Refresh download links
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <HeaderChip
            label={`${displayedTotals.total} total${displayedTotals.isFiltered ? " (filtered)" : ""}`}
          />
          <HeaderChip label={`${displayedTotals.publishable} publishable`} tone="ok" />
          {displayedTotals.blocked > 0 && (
            <HeaderChip label={`${displayedTotals.blocked} blocked`} tone="warn" />
          )}
        </div>
      </header>

      {displayedTotals.blocked > 0 && (
        <div className="bg-highlight border border-border-brand p-4 text-sm text-black/70">
          <p className="font-semibold text-navy">
            {displayedTotals.blocked} piece{displayedTotals.blocked === 1 ? "" : "s"} cannot go out
            yet.
          </p>
          <p className="mt-1">
            {/*
              No "until each clears": a blocked piece's bound artifacts can
              include retracted rows, and approving the piece never makes a
              retracted artifact publishable (see artifactControlState, which
              orders `retracted` ahead of `unapproved` for exactly that
              reason). Stating the withholding without promising when it ends
              is true for both.
            */}
            {blockedPiecesAreFullyWithheld(visiblePieces)
              ? "Their downloads are withheld and their copy controls are locked. The reason is shown on each piece below."
              : "The reason is shown on each piece below."}
          </p>
        </div>
      )}

      {view.bundleWarnings.length > 0 && (
        <div className="bg-highlight border border-border-brand p-4 text-sm text-black/70">
          <p className="font-semibold text-navy">Data completeness</p>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {view.bundleWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={channelFilter}
          onChange={setChannelFilter}
          options={[
            { value: "all", label: "All" },
            { value: "firm_website", label: "Website" },
            { value: "linkedin", label: "LinkedIn" },
            { value: "google_business_profile", label: "Google Business" },
          ]}
        />
        <Segmented
          value={publisherFilter}
          onChange={setPublisherFilter}
          options={[
            { value: "any", label: "Any publisher" },
            { value: "manual", label: "Posted by hand" },
            { value: "pipeline", label: "Pipeline" },
          ]}
        />
      </div>

      {view.groups.length === 0 && (
        <div className="bg-white border border-border-brand p-6 text-sm text-black/55">
          No deliverables in this content week yet.
        </div>
      )}

      {/*
        "the current filters", not "both filters": either segmented control can
        be left on its sentinel, so this line is reachable with only one filter
        actually narrowing anything.
      */}
      {nothingMatches && <p className="text-sm text-black/50">Nothing matches the current filters.</p>}

      {visibleGroups.map((group) => (
        <section key={group.date || "undated"} className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-black/50 border-b border-border-brand pb-2">
            {group.date ? formatDate(group.date) : "No publication date recorded"}
          </h2>
          <div className="space-y-4">
            {group.pieces.map((piece) => (
              <PieceCard key={piece.id} piece={piece} firmId={firmId} onCopy={handleCopy} />
            ))}
          </div>
        </section>
      ))}

      {toast && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 bg-navy text-white text-xs font-semibold px-4 py-2.5 z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Header chip ──────────────────────────────────────────────────────────────

function HeaderChip({ label, tone }: { label: string; tone?: "ok" | "warn" }) {
  const toneClass =
    tone === "ok"
      ? "bg-green-pass/10 text-green-pass border-green-pass/30"
      : tone === "warn"
        ? "bg-red-fail/10 text-red-fail border-red-fail/30"
        : "bg-parchment-2 text-navy border-border-brand";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 border ${toneClass}`}>
      {label}
    </span>
  );
}

// ─── Segmented filter control ─────────────────────────────────────────────────

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex border border-border-brand bg-white">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-2 ${
            i > 0 ? "border-l border-border-brand" : ""
          } ${value === opt.value ? "bg-navy text-white" : "text-black/60 hover:bg-parchment-2"}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Piece card ───────────────────────────────────────────────────────────────

function MiniChip({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border border-border-brand bg-parchment-2 text-navy ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </span>
  );
}

function ConstraintMeter({ reading }: { reading: ConstraintReading }) {
  const barColor =
    reading.state === "over" ? "bg-red-fail" : reading.state === "under" ? "bg-gold-on-light" : "bg-green-pass";
  const textColor =
    reading.state === "over"
      ? "text-red-fail"
      : reading.state === "under"
        ? "text-gold-on-light"
        : "text-black/45";
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 h-[3px] bg-parchment-2 overflow-hidden inline-block">
        <span className={`block h-full ${barColor}`} style={{ width: `${reading.pct}%` }} />
      </span>
      <span className={`font-mono font-semibold ${textColor}`}>{reading.value}</span>
      <span className="text-black/45">
        {reading.label} &middot; {reading.limitText}
      </span>
    </div>
  );
}

function PieceCard({
  piece,
  firmId,
  onCopy,
}: {
  piece: PublishKitPiece;
  firmId: string;
  onCopy: (text: string, label: string) => void;
}) {
  function handleCopyRecord() {
    const record = toAgentRecord(piece);
    onCopy(JSON.stringify(record, null, 2), "Publish record");
  }

  function handleDownloadTxt() {
    if (!piece.plainText) return;
    const blob = new Blob([piece.plainText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(piece.title)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // changeRequestedAt is a UTC instant; slicing it as text (below) is stable
  // but wrong by up to a day for a viewer west of UTC. Render the corrected
  // local date only after hydration, matching ArtifactBlock's expiry gate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const changeRequestedLocalDate = piece.changeRequestedAt
    ? new Date(piece.changeRequestedAt).toLocaleDateString("en-CA", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <article id={`dlv-${piece.id}`} className="bg-white border border-border-brand scroll-mt-4">
      <div className="flex items-start justify-between gap-4 flex-wrap px-5 py-4 border-b border-border-brand bg-parchment">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-navy">{piece.title}</h3>
          {piece.destinationPath && (
            <p className="text-[11px] font-mono text-black/45 mt-0.5 break-all">{piece.destinationPath}</p>
          )}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {piece.format && <MiniChip>{piece.format}</MiniChip>}
            {piece.locale && <MiniChip>{piece.locale}</MiniChip>}
            {piece.versionNumber !== null && <MiniChip mono>v{piece.versionNumber}</MiniChip>}
            <MiniChip>{laneLabel(piece.lane)}</MiniChip>
          </div>
        </div>
        <div className="text-right flex-none max-w-xs">
          {piece.mayPublish ? (
            <p className="text-xs font-semibold text-green-pass">Approved and current</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-amber-700">Cannot publish</p>
              {/*
                A deliberate hold outranks the mechanical reason. mayPublishReason
                is accurate but reads as a system fault -- it names a version UUID
                and the word "flagged" -- when what actually happened is that a
                colleague held this piece back on purpose. Show their reason and
                who they were; the mechanical text stays available in the publish
                record for anyone who needs the exact predicate output.
              */}
              {piece.individualReviewHold ? (
                <div className="mt-1 text-left border border-border-brand bg-parchment-2 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-700">
                    Held for individual review
                    {piece.individualReviewHold.setByName
                      ? ` by ${piece.individualReviewHold.setByName}`
                      : piece.individualReviewHold.setByRole
                        ? ` by the ${piece.individualReviewHold.setByRole}`
                        : ""}
                  </p>
                  <p className="text-[11px] text-black/70 mt-1">
                    {piece.individualReviewHold.reason ?? "No reason was recorded."}
                  </p>
                  <p className="text-[11px] text-black/45 mt-1.5">
                    A hold overrides standing publishing authorization. Clear the hold, or approve
                    this version individually, to release it.
                  </p>
                </div>
              ) : (
                piece.mayPublishReason && (
                  <p className="text-[11px] text-black/50 mt-0.5">{piece.mayPublishReason}</p>
                )
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_320px]">
        <div className="p-5 border-b md:border-b-0 md:border-r border-border-brand min-w-0">
          {piece.plainText ? (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-black/40">Copy</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!piece.mayPublish}
                    onClick={() => onCopy(piece.plainText, "Text")}
                    className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-navy bg-navy text-white hover:bg-navy/90 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-black/20 disabled:border-black/20"
                  >
                    {piece.mayPublish ? "Copy text" : "Copy locked"}
                  </button>
                  <button
                    type="button"
                    disabled={!piece.mayPublish}
                    onClick={handleDownloadTxt}
                    className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-border-brand text-navy hover:bg-parchment-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {piece.mayPublish ? "Download .txt" : "Download locked"}
                  </button>
                </div>
              </div>
              <div className="bg-off-white border border-border-brand p-3.5 text-[13px] leading-relaxed text-black/80 whitespace-pre-wrap select-text max-h-72 overflow-y-auto">
                {piece.plainText}
              </div>
              {piece.constraints.length > 0 && (
                <div className="flex flex-wrap gap-4 mt-2.5">
                  {piece.constraints.map((c) => (
                    <ConstraintMeter key={c.label} reading={c} />
                  ))}
                </div>
              )}
            </>
          ) : piece.unapprovedDraftText ? (
            <>
              {/*
                Shown, not withheld: this surface is operator-only and the same
                text is already one click away on the review page, so hiding it
                was friction rather than protection -- and it blocked a real
                workflow, since producing the email means pasting this copy
                into the GHL template. The draft is labelled on the header, on
                the button, and in the sentence below it, so it can never be
                mistaken for cleared copy.
              */}
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700">
                  Draft copy, not approved
                </span>
                <button
                  type="button"
                  onClick={() => onCopy(piece.unapprovedDraftText as string, "Draft text")}
                  className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-border-brand text-navy hover:bg-parchment-2"
                >
                  Copy draft text
                </button>
              </div>
              <div className="bg-off-white border border-border-brand p-3.5 text-[13px] leading-relaxed text-black/80 whitespace-pre-wrap select-text max-h-72 overflow-y-auto">
                {piece.unapprovedDraftText}
              </div>
              <p className="mt-2 text-[11px] text-black/50">
                No version of this piece is approved yet, so this text is not cleared to publish.
                Open the review page to approve it.
              </p>
            </>
          ) : (
            <p className="text-sm text-black/45">
              {
                {
                  file_delivery: "This piece is delivered as a file. See the artifacts panel.",
                  has_unapproved_copy:
                    "This piece has copy, but no version is currently approved. Open the review page to read the current draft.",
                  no_copy: "No approved copy for this piece yet.",
                }[copyColumnMessage(piece)]
              }
            </p>
          )}

          {piece.destinationPath && (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-black/40">
                  Call to action
                </span>
                <button
                  type="button"
                  disabled={!piece.mayPublish}
                  onClick={() => onCopy(piece.destinationPath as string, "Link")}
                  className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-navy bg-navy text-white hover:bg-navy/90 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-black/20 disabled:border-black/20"
                >
                  {piece.mayPublish ? "Copy link" : "Copy locked"}
                </button>
              </div>
              <div className="bg-off-white border border-border-brand p-3.5 text-[13px] font-mono text-black/80 break-all select-text">
                {piece.destinationPath}
              </div>
            </div>
          )}
        </div>

        <div className="p-5 bg-parchment/40 min-w-0 space-y-4">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-black/40 block">
            Artifacts
          </span>
          {piece.versionAsset && (
            <ArtifactBlock
              label="Version asset"
              filename={piece.versionAsset.name}
              mime={piece.versionAsset.mime}
              sizeBytes={piece.versionAsset.sizeBytes}
              sha256={piece.versionAsset.sha256}
              signedUrl={piece.versionAsset.signedUrl}
              signedUrlExpiresAt={piece.versionAsset.signedUrlExpiresAt}
              storagePath={piece.versionAsset.storagePath}
              publicUrl={null}
              validation={null}
              mayPublish={piece.mayPublish}
              versionId={piece.anchorVersionId}
              locale={null}
              destination={null}
              supersededAt={null}
              unapproved={piece.boundArtifactsAreUnapproved}
            />
          )}
          {piece.boundArtifactsAreUnapproved && piece.artifacts.length > 0 && (
            <p className="text-[11px] text-black/50">
              These belong to the current version, which is not approved. They cannot be downloaded
              here.
            </p>
          )}
          {piece.artifacts.map((artifact) => (
            <ArtifactBlock
              key={artifact.id}
              label={artifactTypeLabel(artifact.artifactType)}
              filename={artifact.filename}
              mime={artifact.mime}
              sizeBytes={artifact.sizeBytes}
              sha256={artifact.sha256}
              signedUrl={artifact.signedUrl}
              signedUrlExpiresAt={artifact.signedUrlExpiresAt}
              storagePath={artifact.storagePath}
              publicUrl={artifact.publicUrl}
              validation={artifact.validation}
              mayPublish={piece.mayPublish}
              versionId={artifact.versionId}
              locale={artifact.locale}
              destination={artifact.destination}
              unapproved={piece.boundArtifactsAreUnapproved}
              supersededAt={artifact.supersededAt}
            />
          ))}
          {!piece.hasAnyArtifactToShow && (
            <p className="text-xs text-black/45">No artifacts registered for this piece yet.</p>
          )}
          {piece.otherVersionArtifacts.length > 0 && (
            <details className="border border-border-brand bg-white">
              <summary className="text-[11px] font-semibold uppercase tracking-wider text-navy/70 cursor-pointer px-3.5 py-2.5">
                Artifacts from other versions ({piece.otherVersionArtifacts.length})
              </summary>
              <div className="px-3.5 pb-3.5 space-y-3">
                <p className="text-[11px] text-black/50">
                  These were cut for a different version of this piece and are not evidence for the
                  version shown above. They cannot be downloaded here.
                </p>
                {piece.otherVersionArtifacts.map((artifact) => (
                  <ArtifactBlock
                    key={artifact.id}
                    label={artifactTypeLabel(artifact.artifactType)}
                    filename={artifact.filename}
                    mime={artifact.mime}
                    sizeBytes={artifact.sizeBytes}
                    sha256={artifact.sha256}
                    signedUrl={artifact.signedUrl}
                    signedUrlExpiresAt={artifact.signedUrlExpiresAt}
                    storagePath={artifact.storagePath}
                    publicUrl={artifact.publicUrl}
                    validation={artifact.validation}
                    mayPublish={piece.mayPublish}
                    versionId={artifact.versionId}
                    locale={artifact.locale}
                    destination={artifact.destination}
                    supersededAt={artifact.supersededAt}
                    locked
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-border-brand bg-parchment flex items-center justify-between gap-3 flex-wrap text-[11px] text-black/50">
        <div className="space-y-0.5">
          {piece.unresolvedCommentCount > 0 && (
            <p>
              {piece.unresolvedCommentCount} unresolved comment
              {piece.unresolvedCommentCount === 1 ? "" : "s"}
            </p>
          )}
          {piece.changeRequestedAt && mounted && <p>Changes requested {changeRequestedLocalDate}</p>}
          {piece.warnings.map((w, i) => (
            // Index, not the warning text, as the key: warning strings are not
            // guaranteed unique (two identical signing-failure sentences would
            // collide on React's duplicate-key check), and this list is static
            // per server render, so index keys are safe here.
            <p key={`${piece.id}-warning-${i}`}>{w}</p>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-none">
          <button
            type="button"
            onClick={handleCopyRecord}
            className="font-semibold uppercase tracking-wider text-navy/70 hover:text-navy"
          >
            Copy publish record
          </button>
          <Link
            href={`/portal/${firmId}/deliverables/${piece.id}`}
            className="font-semibold uppercase tracking-wider text-navy/70 hover:text-navy"
          >
            Open review page
          </Link>
        </div>
      </div>
    </article>
  );
}

// ─── Artifact block ───────────────────────────────────────────────────────────

function ArtifactBlock({
  label,
  filename,
  mime,
  sizeBytes,
  sha256,
  signedUrl,
  signedUrlExpiresAt,
  storagePath,
  publicUrl,
  validation,
  mayPublish,
  locked,
  supersededAt,
  unapproved,
  versionId,
  locale,
  destination,
}: {
  label: string;
  filename: string | null;
  mime: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  signedUrl: string | null;
  signedUrlExpiresAt: string | null;
  storagePath: string | null;
  publicUrl: string | null;
  validation: { validator: string; result: string; created_at: string } | null;
  mayPublish: boolean;
  /**
   * True for an artifact bound to a version other than the one displayed.
   * A crop cut for another version is not evidence for this one: the
   * download is always disabled regardless of mayPublish/signedUrl, and
   * public_url is never rendered, so a live link to unapproved material is
   * never printed as if it belonged to the piece on screen.
   */
  locked?: boolean;
  /**
   * Non-null when this artifact has been retracted. A unique partial index
   * enforces at most one active artifact per slot, and the database rejects
   * a publication receipt that references a superseded one, so this beats
   * mayPublish/unapproved regardless of the piece's own state: retraction
   * does not go away on approval.
   */
  supersededAt?: string | null;
  /**
   * True for a bound artifact whose piece has PublishKitPiece.boundArtifactsAreUnapproved
   * set -- this artifact belongs to the current version, it is simply not
   * approved. Distinct from `locked`: this is THIS piece's real artifact,
   * not another version's.
   */
  unapproved?: boolean;
  /** The version this artifact is bound to, shown in provenance so a locked artifact can be identified. */
  versionId?: string | null;
  locale?: string | null;
  destination?: string | null;
}) {
  const controlState = artifactControlState({
    storagePath,
    locked: Boolean(locked),
    supersededAt: supersededAt ?? null,
    unapproved: Boolean(unapproved),
    mayPublish,
    signedUrl,
  });
  const canDownload = controlState === "download";

  // Only render the signed-url expiry and the validation date after
  // hydration: both are UTC instants, so formatting them during server
  // render (host timezone) and client render (viewer's timezone) would
  // produce different strings and trip a hydration mismatch. These lines
  // are conveniences; omitting them from the server HTML costs nothing.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const validationLocalDate = validation
    ? new Date(validation.created_at).toLocaleDateString("en-CA", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="border border-border-brand bg-white p-3.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-navy">{label}</p>
        {(locale || destination) && (
          <span className="flex gap-1.5">
            {locale && <MiniChip mono>{locale}</MiniChip>}
            {destination && <MiniChip>{destination}</MiniChip>}
          </span>
        )}
      </div>
      {filename && <p className="text-[11px] font-mono text-black/60 mt-1 break-all">{filename}</p>}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mt-2 text-[11px]">
        {mime && (
          <>
            <dt className="text-black/40 uppercase tracking-wider">Type</dt>
            <dd className="text-black/60">{mime}</dd>
          </>
        )}
        {sizeBytes !== null && (
          <>
            <dt className="text-black/40 uppercase tracking-wider">Size</dt>
            <dd className="text-black/60">{formatByteCount(sizeBytes)}</dd>
          </>
        )}
        {sha256 && (
          <>
            <dt className="text-black/40 uppercase tracking-wider">SHA-256</dt>
            <dd className="text-black/60 font-mono break-all">{sha256}</dd>
          </>
        )}
      </dl>

      <div className="mt-2.5">
        {/*
          The label and the element are both derived from a single decision,
          artifactControlState (publish-kit-pure.ts), so this branch can never
          drift out of sync with itself the way the old inline boolean checks
          did between rounds 2 and 3. aria-disabled, not the disabled
          attribute, on every non-anchor state: disabled removes an element
          from the tab order in every browser, so a keyboard or screen-reader
          operator would never learn a locked download exists at all.
          aria-disabled keeps it focusable and announced as disabled, while
          the absence of an onClick makes it inert.
        */}
        {controlState === "download" && signedUrl ? (
          <a
            href={signedUrl}
            download
            rel="noreferrer"
            className="inline-block text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-navy bg-navy text-white hover:bg-navy/90"
          >
            Download
          </a>
        ) : (
          <button
            type="button"
            aria-disabled="true"
            className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 border border-black/20 bg-black/10 text-black/40 cursor-not-allowed"
          >
            {ARTIFACT_CONTROL_LABEL[controlState]}
          </button>
        )}
        {canDownload && signedUrlExpiresAt && mounted && (
          <p className="text-[10px] text-black/40 mt-1">
            Link expires {new Date(signedUrlExpiresAt).toLocaleString("en-CA")}.
          </p>
        )}
      </div>

      {(versionId || storagePath || (!locked && publicUrl) || sha256 || validation) && (
        <details className="mt-2.5 border-t border-border-brand pt-2.5">
          <summary className="text-[10px] uppercase tracking-wider font-semibold text-navy/70 cursor-pointer">
            Provenance
          </summary>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-2 text-[11px]">
            {versionId && (
              <>
                <dt className="text-black/40 uppercase tracking-wider">Bound to version</dt>
                <dd className="text-black/60 font-mono break-all">{versionId}</dd>
              </>
            )}
            {storagePath && (
              <>
                <dt className="text-black/40 uppercase tracking-wider">Storage path</dt>
                <dd className="text-black/60 font-mono break-all">{storagePath}</dd>
              </>
            )}
            {!locked && publicUrl && (
              <>
                <dt className="text-black/40 uppercase tracking-wider">Public URL</dt>
                <dd className="text-black/60 break-all">{publicUrl}</dd>
              </>
            )}
            {sha256 && (
              <>
                <dt className="text-black/40 uppercase tracking-wider">SHA-256</dt>
                <dd className="text-black/60 font-mono break-all">{sha256}</dd>
              </>
            )}
            {validation && mounted && (
              <>
                <dt className="text-black/40 uppercase tracking-wider">Validation</dt>
                <dd className="text-black/60">
                  {validation.validator}: {validation.result} ({validationLocalDate})
                </dd>
              </>
            )}
          </dl>
        </details>
      )}
    </div>
  );
}
