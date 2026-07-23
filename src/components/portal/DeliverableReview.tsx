"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type PointerEvent as ReactPointerEvent,
  type FormEvent,
  type ChangeEvent,
  type RefObject,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  ContentDeliverable,
  DeliverableVersion,
  DeliverableComment,
  ApprovalRecord,
  DeliverableAnnotation,
  DeliverableAttachment,
} from "@/lib/types";
import { DRGArticleFrame, type AnnotationPosition } from "./DRGArticleFrame";
import {
  STATUS_LABELS,
  CONTENT_KIND_LABELS,
  annotationLabel,
  versionOptionLabel,
  type ClientNotificationChoice,
} from "@/lib/deliverables-pure";
import { stackCards, stackBottom } from "@/lib/margin-stack";
import type { HighlightItem } from "@/lib/highlight-dom";
import { formatTimestamp } from "@/lib/firm-timezone";
import { SUPPORT_PREVIEW_READ_ONLY_MESSAGE } from "@/lib/support-preview-copy";
import PlacementsTrackingPanel from "./PlacementsTrackingPanel";
import HeroImageControl from "./HeroImageControl";
import { shouldShowHeroImageControl } from "./hero-image-control-pure";

interface Detail {
  deliverable: ContentDeliverable;
  versions: DeliverableVersion[];
  comments: DeliverableComment[];
  approvals: ApprovalRecord[];
}

function cssEscapeId(id: string): string {
  if (typeof window !== "undefined" && window.CSS && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/["\\]/g, "\\$&");
}

function sameMap(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

function scrollMarkIntoView(rowEl: HTMLElement | null, id: string) {
  const mark = rowEl?.querySelector(
    `mark.drg-hl[data-hl-id="${cssEscapeId(id)}"]`,
  ) as HTMLElement | null;
  mark?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export default function DeliverableReview({
  firmId,
  viewerRole,
  signerName,
  signerEmail,
  approvalAttestation,
  changesAttestation,
  initialDetail,
  supportPreview = false,
}: {
  firmId: string;
  viewerRole: "operator" | "lawyer";
  signerName: string | null;
  signerEmail: string | null;
  approvalAttestation: string;
  changesAttestation: string;
  initialDetail: Detail;
  supportPreview?: boolean;
}) {
  const [detail, setDetail] = useState<Detail>(initialDetail);
  const { deliverable, versions, comments, approvals } = detail;
  const deliverableId = deliverable.id;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    deliverable.current_version_id ?? versions[0]?.id ?? null,
  );
  const [pendingAnnotation, setPendingAnnotation] = useState<DeliverableAnnotation | null>(null);
  const [pendingPosition, setPendingPosition] = useState<AnnotationPosition | null>(null);
  const [showVersionComposer, setShowVersionComposer] = useState(versions.length === 0);

  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? null;
  const isCurrent = selectedVersionId === deliverable.current_version_id;
  // Defensive: a deliverable with versions but no current-version pointer is a
  // broken state a DB trigger now prevents (migration
  // 20260707_deliverable_current_version_invariant). If one ever recurs, the
  // sign-off panel says so explicitly instead of hiding the button silently.
  const currentVersionMissing = !deliverable.current_version_id && versions.length > 0;
  // Newest changes_requested record (approvals load newest-first), used to
  // quote the open request in the version composer and to resolve the
  // addressed-by relationship once a version answers it.
  const latestChangesRequestedApproval =
    approvals.find((a) => a.decision === "changes_requested") ?? null;
  // Replies threaded under a change-request record are not passage comments;
  // they render in ApprovalHistory, never in the passage margin.
  const versionComments = comments.filter(
    (c) => c.version_id === selectedVersionId && !c.approval_record_id,
  );

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const json = await res.json();
    if (json.ok) {
      setDetail({
        deliverable: json.deliverable,
        versions: json.versions,
        comments: json.comments,
        approvals: json.approvals,
      });
    }
  }, [firmId, deliverableId]);

  // Google-Docs margin: the content+comment row is the shared coordinate
  // origin. The article frame reports each highlight's top relative to it so
  // the comment cards can sit beside their passage.
  const rowRef = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Map<string, number>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleAnchors = useCallback((m: Map<string, number>) => {
    setAnchors((prev) => (sameMap(prev, m) ? prev : m));
  }, []);

  // Card click: focus and scroll its highlight into view.
  const focusFromCard = useCallback((id: string) => {
    setActiveId(id);
    scrollMarkIntoView(rowRef.current, id);
  }, []);

  // Highlight click: focus; the margin scrolls the card into view itself.
  const focusFromHighlight = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  // Deep link from CaseLoad Connect: ?comment=<id> opens this deliverable
  // focused on that comment. Select the comment's version, mark it active
  // (the margin scrolls its card into view), and scroll its passage highlight
  // into view once the version's content has rendered. One-shot.
  const searchParams = useSearchParams();
  const didAutoFocusRef = useRef(false);
  useEffect(() => {
    if (didAutoFocusRef.current) return;
    const target = searchParams.get("comment");
    if (!target) return;
    const c = comments.find((x) => x.id === target);
    if (!c) return;
    didAutoFocusRef.current = true;
    setSelectedVersionId(c.version_id);
    setActiveId(c.id);
    const t = setTimeout(() => scrollMarkIntoView(rowRef.current, c.id), 400);
    return () => clearTimeout(t);
  }, [searchParams, comments]);

  // Number positional comments so markers and the sidebar align.
  const numberByCommentId = new Map<string, number>();
  let n = 0;
  for (const c of versionComments) {
    if (c.annotation) numberByCommentId.set(c.id, ++n);
  }

  // Stored text ranges to keep highlighted in the body and to align cards to.
  const textHighlights: HighlightItem[] = [];
  for (const c of versionComments) {
    if (c.annotation && c.annotation.type === "text") {
      textHighlights.push({
        id: c.id,
        start: c.annotation.start,
        end: c.annotation.end,
        quote: c.annotation.quote,
        num: numberByCommentId.get(c.id) ?? 0,
      });
    }
  }
  // Whole-element comments on the header title / lead / hero image, anchored to
  // the element (not inline-marked).
  const elementAnchors: { id: string; kind: "title" | "excerpt" | "hero" }[] = [];
  for (const c of versionComments) {
    if (c.annotation?.type === "field") {
      elementAnchors.push({
        id: c.id,
        kind: c.annotation.field === "title" ? "title" : "excerpt",
      });
    } else if (
      c.annotation?.type === "image" &&
      deliverable.hero_image_url &&
      c.annotation.src === deliverable.hero_image_url
    ) {
      elementAnchors.push({ id: c.id, kind: "hero" });
    }
  }
  const isDrgText =
    deliverable.content_kind === "text" && deliverable.firm_id === DRG_FIRM_ID;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/portal/${firmId}/deliverables`}
          className="text-xs text-black/50 hover:text-navy"
        >
          ← All deliverables
        </Link>
        <div className="flex items-start justify-between gap-3 mt-2 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-black/40">
              {CONTENT_KIND_LABELS[deliverable.content_kind]}
            </p>
            <h1 className="text-2xl font-bold text-navy leading-tight">
              {deliverable.kicker ? `${deliverable.kicker} · ` : ""}{deliverable.title}
            </h1>
            {deliverable.description && (
              <p className="text-sm text-black/55 mt-1">{deliverable.description}</p>
            )}
          </div>
          <StatusPill status={deliverable.status} />
        </div>
      </div>

      {/* Version-mismatch banner: prevents the client landing on an old version
          and getting silently blocked from signing off. Only rendered when the
          selected version is not the current version and a current version exists
          to switch to. Uses the CaseLoad top-strip pattern (no left border). */}
      {!isCurrent && deliverable.current_version_id && (
        <div className="bg-amber-50 border-t-4 border-amber-500 p-4 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              You are viewing an earlier version
            </p>
            <p className="text-xs text-amber-800 mt-1">
              {selectedVersion
                ? `You are on v${selectedVersion.version_number}. `
                : ""}
              Switch to the current version to sign off or request changes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedVersionId(deliverable.current_version_id);
              setPendingAnnotation(null);
              setPendingPosition(null);
              setActiveId(null);
            }}
            className="text-xs font-semibold uppercase tracking-wider px-3 py-1.5 border border-amber-700 bg-white text-amber-900 hover:bg-amber-700 hover:text-white transition-colors whitespace-nowrap flex-shrink-0"
          >
            Switch to current
          </button>
        </div>
      )}

      {/* Review action bar: version controls + sign-off live above the article
          so the right margin is dedicated to passage-aligned comments. */}
      <div className="bg-white border border-border-brand p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <VersionSelector
            versions={versions}
            deliverable={deliverable}
            approvals={approvals}
            selectedVersionId={selectedVersionId}
            onSelect={(id) => {
              setSelectedVersionId(id);
              setPendingAnnotation(null);
              setPendingPosition(null);
              setActiveId(null);
            }}
          />
          <button
            onClick={() => setShowVersionComposer((s) => !s)}
            disabled={supportPreview}
            className="text-xs font-semibold uppercase tracking-wider px-3 py-1.5 border border-navy text-navy hover:bg-navy hover:text-white transition-colors disabled:opacity-50"
          >
            {showVersionComposer ? "Close" : "Post new version"}
          </button>
        </div>

        {supportPreview && (
          <p className="text-xs text-black/55">{SUPPORT_PREVIEW_READ_ONLY_MESSAGE}</p>
        )}

        {showVersionComposer && !supportPreview && (
          <VersionComposer
            firmId={firmId}
            deliverableId={deliverableId}
            contentKind={deliverable.content_kind}
            respondsToApproval={
              deliverable.status === "changes_requested" ? latestChangesRequestedApproval : null
            }
            onPosted={async () => {
              setShowVersionComposer(false);
              await refetch();
            }}
            onSelectNew={(id) => setSelectedVersionId(id)}
          />
        )}

        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr] items-start">
          <SignOffPanel
            firmId={firmId}
            deliverableId={deliverableId}
            viewerRole={viewerRole}
            signerName={signerName}
            signerEmail={signerEmail}
            approvalAttestation={approvalAttestation}
            changesAttestation={changesAttestation}
            selectedVersion={selectedVersion}
            isCurrentVersion={isCurrent}
            currentVersionMissing={currentVersionMissing}
            status={deliverable.status}
            onSigned={refetch}
            supportPreview={supportPreview}
          />
          <div className="space-y-3">
            <ApprovalHistory
              firmId={firmId}
              deliverableId={deliverableId}
              viewerRole={viewerRole}
              approvals={approvals}
              comments={comments}
              versions={versions}
              deliverable={deliverable}
              onSwitchVersion={(id) => {
                setSelectedVersionId(id);
                setPendingAnnotation(null);
                setPendingPosition(null);
                setActiveId(null);
              }}
              onChanged={refetch}
              supportPreview={supportPreview}
            />
            <ArchiveControl
              firmId={firmId}
              deliverableId={deliverableId}
              status={deliverable.status}
              onArchived={refetch}
            />
          </div>
        </div>
      </div>

      {/* Article (left) + passage-aligned comment margin (right). The row is
          the shared coordinate origin for highlight + card alignment. */}
      <div
        ref={rowRef}
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px] items-start"
      >
        <div className="space-y-4">
          {selectedVersion ? (
            <ContentViewer
              version={selectedVersion}
              deliverable={deliverable}
              comments={versionComments}
              numberByCommentId={numberByCommentId}
              onAnnotate={(a, pos) => {
                setPendingAnnotation(a);
                setPendingPosition(pos ?? null);
              }}
              highlights={isDrgText ? textHighlights : undefined}
              elementAnchors={isDrgText ? elementAnchors : undefined}
              measureRef={rowRef}
              onAnchors={handleAnchors}
              activeHighlightId={activeId}
              onHighlightClick={focusFromHighlight}
            />
          ) : (
            <div className="bg-white border border-border-brand px-6 py-10 text-center text-sm text-black/55">
              No version posted yet.
            </div>
          )}

          {shouldShowHeroImageControl(selectedVersion?.id ?? null, viewerRole) && (
            <HeroImageControl
              firmId={firmId}
              deliverableId={deliverableId}
              deliverableTitle={deliverable.title}
              hasHero={Boolean(deliverable.hero_image_url)}
              onSaved={refetch}
            />
          )}

          {selectedVersion && (
            <CommentComposer
              firmId={firmId}
              deliverableId={deliverableId}
              versionId={selectedVersion.id}
              pendingAnnotation={pendingPosition ? null : pendingAnnotation}
              onClearAnnotation={() => {
                setPendingAnnotation(null);
                setPendingPosition(null);
              }}
              viewerRole={viewerRole}
              onPosted={refetch}
              supportPreview={supportPreview}
            />
          )}

          {pendingAnnotation && pendingPosition && selectedVersion && (
            <FloatingAnnotationPopover
              annotation={pendingAnnotation}
              position={pendingPosition}
              firmId={firmId}
              deliverableId={deliverableId}
              versionId={selectedVersion.id}
              viewerRole={viewerRole}
              supportPreview={supportPreview}
              onDismiss={() => {
                setPendingAnnotation(null);
                setPendingPosition(null);
              }}
              onPosted={async () => {
                setPendingAnnotation(null);
                setPendingPosition(null);
                await refetch();
              }}
            />
          )}
        </div>

        {selectedVersion && (
          <MarginComments
            firmId={firmId}
            deliverableId={deliverableId}
            viewerRole={viewerRole}
            comments={versionComments}
            numberByCommentId={numberByCommentId}
            anchors={anchors}
            activeId={activeId}
            onActivate={focusFromCard}
            onChanged={refetch}
            supportPreview={supportPreview}
          />
        )}
      </div>

      {viewerRole === "operator" && (
        <div className="border-t border-black/8 pt-5">
          <h2 className="text-sm font-semibold text-navy mb-2">Placements &amp; tracked links</h2>
          <p className="text-xs text-black/50 mb-3">
            Use the tracking parameters below when publishing each placement, so a resulting
            enquiry can be linked back to it in Content Performance.
          </p>
          <PlacementsTrackingPanel firmId={firmId} deliverableId={deliverableId} />
        </div>
      )}
    </div>
  );
}

// ─── Status + version chrome ─────────────────────────────────────────────────

function StatusPill({ status }: { status: ContentDeliverable["status"] }) {
  const styles: Record<string, string> = {
    draft: "bg-parchment-2 text-muted border-border-brand",
    in_review: "bg-navy/10 text-navy border-navy/20",
    changes_requested: "bg-amber-50 text-amber-800 border-amber-200",
    approved: "bg-green-pass/10 text-green-pass border-green-pass/30",
    archived: "bg-parchment-2 text-muted border-border-brand",
  };
  return (
    <span
      className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 border whitespace-nowrap ${styles[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function versionOptionText(
  version: DeliverableVersion,
  deliverable: ContentDeliverable,
  approvals: ApprovalRecord[],
): string {
  const state = versionOptionLabel(version, deliverable, approvals);
  const date = state.approvalCreatedAt
    ? formatTimestamp(state.approvalCreatedAt, undefined, { dateStyle: "medium" })
    : "";
  if (state.tag === "awaiting_review") return `v${version.version_number} (current, awaiting review)`;
  if (state.tag === "approved") {
    return `v${version.version_number} (${state.isCurrent ? "current, " : ""}approved ${date})`;
  }
  if (state.tag === "changes_requested") {
    return `v${version.version_number} (${state.isCurrent ? "current, " : ""}changes requested ${date})`;
  }
  return `v${version.version_number}${state.isCurrent ? " (current)" : ""}`;
}

function VersionSelector({
  versions,
  deliverable,
  approvals,
  selectedVersionId,
  onSelect,
}: {
  versions: DeliverableVersion[];
  deliverable: ContentDeliverable;
  approvals: ApprovalRecord[];
  selectedVersionId: string | null;
  onSelect: (id: string) => void;
}) {
  if (versions.length === 0) return <span className="text-xs text-black/40">No versions</span>;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-black/50">Version</span>
      <select
        value={selectedVersionId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="text-xs border border-border-brand px-2 py-1 bg-white"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {versionOptionText(v, deliverable, approvals)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Content viewer (text / image / pdf) ─────────────────────────────────────

// DRG firm id. When the deliverable belongs to DRG, text articles render in
// the brand-faithful DRGArticleFrame instead of the generic TextViewer so
// Damaris sees the draft close to how readers will see it on drglaw.ca.
const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

function ContentViewer({
  version,
  deliverable,
  comments,
  numberByCommentId,
  onAnnotate,
  highlights,
  elementAnchors,
  measureRef,
  onAnchors,
  activeHighlightId,
  onHighlightClick,
}: {
  version: DeliverableVersion;
  deliverable: ContentDeliverable;
  comments: DeliverableComment[];
  numberByCommentId: Map<string, number>;
  onAnnotate: (a: DeliverableAnnotation, pos?: AnnotationPosition) => void;
  highlights?: HighlightItem[];
  elementAnchors?: { id: string; kind: "title" | "excerpt" | "hero" }[];
  measureRef?: RefObject<HTMLElement | null>;
  onAnchors?: (anchors: Map<string, number>) => void;
  activeHighlightId?: string | null;
  onHighlightClick?: (commentId: string) => void;
}) {
  const contentKind = deliverable.content_kind;
  if (contentKind === "text") {
    if (deliverable.firm_id === DRG_FIRM_ID) {
      return (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-navy bg-parchment-2 border border-border-brand px-3 py-2">
            <span aria-hidden="true" className="font-bold">“ ”</span>
            Select any passage, the title, or the lead to comment on it, the same
            way you would in Google Docs. Click the hero or any inline image to
            comment on that image.
          </p>
          <DRGArticleFrame
            title={deliverable.title}
            excerpt={deliverable.excerpt}
            topic={deliverable.topic}
            byline={deliverable.byline}
            publishDate={deliverable.publish_date}
            readTime={deliverable.read_time}
            heroImageUrl={deliverable.hero_image_url}
            bodyHtml={version.body_html ?? ""}
            onAnnotate={onAnnotate}
            highlights={highlights}
            elementAnchors={elementAnchors}
            measureRef={measureRef}
            onAnchors={onAnchors}
            activeHighlightId={activeHighlightId}
            onHighlightClick={onHighlightClick}
          />
        </div>
      );
    }
    return <TextViewer version={version} onAnnotate={(a) => onAnnotate(a)} />;
  }
  if (contentKind === "image") {
    return (
      <ImageViewer
        version={version}
        comments={comments}
        numberByCommentId={numberByCommentId}
        onAnnotate={onAnnotate}
      />
    );
  }
  return <PdfViewer version={version} onAnnotate={onAnnotate} />;
}

function TextViewer({
  version,
  onAnnotate,
}: {
  version: DeliverableVersion;
  onAnnotate: (a: DeliverableAnnotation) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onMouseUp() {
    const container = ref.current;
    if (!container) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const pre = range.cloneRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const quote = range.toString().trim();
    if (!quote) return;
    onAnnotate({ type: "text", start, end: start + quote.length, quote });
  }

  return (
    <div className="bg-white border border-border-brand p-5">
      <p className="text-[11px] text-black/40 mb-3">
        Select any passage to comment on it.
      </p>
      <div
        ref={ref}
        onMouseUp={onMouseUp}
        className="prose-deliverable text-[15px] leading-relaxed text-black/85 [&_h2]:text-navy [&_h2]:font-bold [&_h2]:text-lg [&_h2]:mt-4 [&_h3]:font-bold [&_h3]:text-navy [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-navy [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[color:var(--portal-accent)] [&_blockquote]:pl-3 [&_blockquote]:text-black/60"
        dangerouslySetInnerHTML={{ __html: version.body_html ?? "" }}
      />
    </div>
  );
}

function ImageViewer({
  version,
  comments,
  numberByCommentId,
  onAnnotate,
}: {
  version: DeliverableVersion;
  comments: DeliverableComment[];
  numberByCommentId: Map<string, number>;
  onAnnotate: (a: DeliverableAnnotation) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  function norm(e: ReactPointerEvent) {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function onDown(e: ReactPointerEvent) {
    const p = norm(e);
    dragStart.current = p;
    setDragRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  function onMove(e: ReactPointerEvent) {
    if (!dragStart.current) return;
    const p = norm(e);
    const s = dragStart.current;
    setDragRect({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  }
  function onUp() {
    const rect = dragRect;
    const s = dragStart.current;
    dragStart.current = null;
    setDragRect(null);
    if (!rect || !s) return;
    if (rect.w < 0.02 && rect.h < 0.02) {
      onAnnotate({ type: "pin", x: s.x, y: s.y });
    } else {
      onAnnotate({ type: "region", x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }
  }

  return (
    <div className="bg-white border border-border-brand p-3">
      <p className="text-[11px] text-black/40 mb-2">
        Click to drop a pin, or drag to mark a region.
      </p>
      <div
        ref={wrapRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="relative select-none touch-none cursor-crosshair inline-block max-w-full"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={version.signed_url ?? ""}
          alt={version.asset_name ?? "deliverable"}
          className="max-w-full block"
          draggable={false}
        />
        {comments.map((c) => {
          const num = numberByCommentId.get(c.id);
          if (!c.annotation || !num) return null;
          if (c.annotation.type === "pin") {
            return (
              <Marker key={c.id} num={num} left={c.annotation.x} top={c.annotation.y} />
            );
          }
          if (c.annotation.type === "region") {
            const a = c.annotation;
            return (
              <div
                key={c.id}
                className="absolute border-2 border-navy/80 bg-navy/10"
                style={{
                  left: `${a.x * 100}%`,
                  top: `${a.y * 100}%`,
                  width: `${a.w * 100}%`,
                  height: `${a.h * 100}%`,
                }}
              >
                <span className="absolute -top-2 -left-2 bg-navy text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center">
                  {num}
                </span>
              </div>
            );
          }
          return null;
        })}
        {dragRect && (
          <div
            className="absolute border-2 border-border-brand bg-parchment-2 pointer-events-none"
            style={{
              left: `${dragRect.x * 100}%`,
              top: `${dragRect.y * 100}%`,
              width: `${dragRect.w * 100}%`,
              height: `${dragRect.h * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

function Marker({ num, left, top }: { num: number; left: number; top: number }) {
  return (
    <span
      className="absolute -translate-x-1/2 -translate-y-1/2 bg-navy text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center ring-2 ring-white"
      style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
    >
      {num}
    </span>
  );
}

function PdfViewer({
  version,
  onAnnotate,
}: {
  version: DeliverableVersion;
  onAnnotate: (a: DeliverableAnnotation) => void;
}) {
  const [page, setPage] = useState("");
  return (
    <div className="bg-white border border-border-brand p-3 space-y-2">
      {version.signed_url ? (
        <iframe
          src={version.signed_url}
          title={version.asset_name ?? "PDF"}
          className="w-full h-[600px] border border-border-brand"
        />
      ) : (
        <p className="text-sm text-black/55 py-8 text-center">PDF could not be loaded.</p>
      )}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-black/50">Tag a comment to a page:</span>
        <input
          value={page}
          onChange={(e) => setPage(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="page #"
          className="w-20 border border-border-brand px-2 py-1"
        />
        <button
          type="button"
          onClick={() => {
            const num = parseInt(page, 10);
            if (Number.isFinite(num) && num > 0) onAnnotate({ type: "page", page: num });
          }}
          disabled={!page}
          className="px-2 py-1 border border-navy text-navy disabled:opacity-40"
        >
          Tag page
        </button>
      </div>
    </div>
  );
}

// ─── Floating annotation popover (Google-Docs style) ─────────────────────────

const POPOVER_W = 288;
const POPOVER_H = 152; // approximate height to decide above/below
const POPOVER_MARGIN = 8; // minimum distance from viewport edge

function FloatingAnnotationPopover({
  annotation,
  position,
  firmId,
  deliverableId,
  versionId,
  viewerRole,
  onDismiss,
  onPosted,
  supportPreview = false,
}: {
  annotation: DeliverableAnnotation;
  position: AnnotationPosition;
  firmId: string;
  deliverableId: string;
  versionId: string;
  viewerRole: "operator" | "lawyer";
  onDismiss: () => void;
  onPosted: () => Promise<void>;
  supportPreview?: boolean;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea when popover opens
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  // Esc to dismiss
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Click outside to dismiss. Delayed 120ms so the same mouseup that opened
  // the popover does not immediately close it.
  useEffect(() => {
    function attach() {
      document.addEventListener("mousedown", handleOutside);
    }
    function handleOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    const timer = setTimeout(attach, 120);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [onDismiss]);

  // Clamp to viewport. Use position: fixed so viewport coords are direct.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const OFFSET = 10;
  const clampedLeft = Math.min(
    Math.max(POPOVER_MARGIN, position.left - POPOVER_W / 2),
    vw - POPOVER_W - POPOVER_MARGIN,
  );
  // Prefer above the anchor; fall back to below when there is not enough room.
  const showAbove = position.top - POPOVER_H - OFFSET > 20;
  const top = showAbove
    ? Math.max(POPOVER_MARGIN, position.top - POPOVER_H - OFFSET)
    : Math.min(vh - POPOVER_H - POPOVER_MARGIN, position.top + OFFSET + 20);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/${firmId}/deliverables/${deliverableId}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version_id: versionId, body: body.trim(), annotation }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not post.");
      } else {
        await onPosted();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      ref={wrapRef}
      style={{
        position: "fixed",
        top,
        left: clampedLeft,
        width: POPOVER_W,
        zIndex: 1200,
      }}
      className="bg-white border border-border-brand"
    >
      <div className="px-3 py-2 border-b border-border-brand bg-parchment">
        <p className="text-[10px] text-black/50 truncate leading-tight">
          {annotationChip(annotation)}
        </p>
      </div>
      <form onSubmit={onSubmit} className="p-3 space-y-2">
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={
            viewerRole === "lawyer"
              ? "Add a comment for the operator..."
              : "Add a note for the firm..."
          }
          className="w-full border border-border-brand px-2 py-1.5 text-sm resize-none"
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter submits
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {error && <p className="text-[11px] text-red-fail">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={supportPreview || sending || !body.trim()}
            className="px-3 py-1.5 text-xs font-semibold bg-navy text-white disabled:opacity-50 whitespace-nowrap"
          >
            {sending ? "Posting..." : "Comment"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-black/45 hover:text-black"
          >
            Cancel
          </button>
          <span className="ml-auto text-[10px] text-black/30">
            {typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl"}+↵
          </span>
        </div>
      </form>
    </div>
  );
}

// ─── Comment composer ────────────────────────────────────────────────────────

function annotationChip(a: DeliverableAnnotation): string {
  switch (a.type) {
    case "text":
      return `On passage: "${a.quote.slice(0, 60)}${a.quote.length > 60 ? "..." : ""}"`;
    case "pin":
      return "Pinned on the image";
    case "region":
      return "On a marked region";
    case "page":
      return `On page ${a.page}`;
    case "image":
      return a.alt ? `On image: ${a.alt.slice(0, 50)}` : "On an inline image";
    case "field": {
      const where = a.field === "title" ? "title" : "lead";
      return `On the ${where}: "${a.quote.slice(0, 50)}${a.quote.length > 50 ? "..." : ""}"`;
    }
  }
}

function CommentComposer({
  firmId,
  deliverableId,
  versionId,
  pendingAnnotation,
  onClearAnnotation,
  viewerRole,
  onPosted,
  supportPreview = false,
}: {
  firmId: string;
  deliverableId: string;
  versionId: string;
  pendingAnnotation: DeliverableAnnotation | null;
  onClearAnnotation: () => void;
  viewerRole: "operator" | "lawyer";
  onPosted: () => Promise<void> | void;
  supportPreview?: boolean;
}) {
  const [body, setBody] = useState("");
  const [notify, setNotify] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifyWarning, setNotifyWarning] = useState<string | null>(null);
  const isOperator = viewerRole === "operator";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: versionId,
          body: body.trim(),
          annotation: pendingAnnotation,
          client_notification_choice: isOperator && notify ? "notify_now" : "silent",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not post.");
      } else {
        setBody("");
        setNotify(false);
        onClearAnnotation();
        if (isOperator && json.notification?.status === "failed") {
          setNotifyWarning("The comment was posted, but the notification email could not be sent.");
        } else {
          setNotifyWarning(null);
        }
        await onPosted();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-border-brand p-3 space-y-2">
      {pendingAnnotation && (
        <div className="flex items-center gap-2 text-xs bg-parchment-2 border border-border-brand px-2 py-1">
          <span className="text-navy">{annotationChip(pendingAnnotation)}</span>
          <button
            type="button"
            onClick={onClearAnnotation}
            className="ml-auto text-black/50 hover:text-black"
          >
            clear
          </button>
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder={
          viewerRole === "lawyer"
            ? "Add a comment for the operator..."
            : "Add a note for the firm..."
        }
        className="w-full border border-border-brand px-2 py-1.5 text-sm resize-y"
      />
      {isOperator && (
        <label className="flex items-center gap-2 text-xs text-black/70">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          Notify the client by email
        </label>
      )}
      {isOperator && (
        <p className="text-xs text-black/50">
          {notify
            ? "The comment will be posted and the client will receive an email."
            : "The comment will be posted without sending an email."}
        </p>
      )}
      {error && <p className="text-xs text-red-fail">{error}</p>}
      {notifyWarning && <p className="text-xs text-amber-800">{notifyWarning}</p>}
      {supportPreview && (
        <p className="text-xs text-black/55">{SUPPORT_PREVIEW_READ_ONLY_MESSAGE}</p>
      )}
      <button
        type="submit"
        disabled={supportPreview || sending || !body.trim()}
        className="px-3 py-1.5 text-sm font-semibold bg-navy text-white disabled:opacity-50"
      >
        {sending
          ? "Posting..."
          : `${pendingAnnotation ? "Comment on selection" : "Add comment"}${
              isOperator && notify ? " and notify" : ""
            }`}
      </button>
    </form>
  );
}

// ─── Comment margin (Google-Docs style) ──────────────────────────────────────

/**
 * Comment cards aligned to their passage. On wide screens each anchored card
 * floats at its highlight's height (collision-pushed down when crowded);
 * general / image comments stack below. Below `lg` it degrades to a plain
 * stacked list.
 */
function MarginComments({
  firmId,
  deliverableId,
  comments,
  numberByCommentId,
  viewerRole,
  anchors,
  activeId,
  onActivate,
  onChanged,
  supportPreview = false,
}: {
  firmId: string;
  deliverableId: string;
  comments: DeliverableComment[];
  numberByCommentId: Map<string, number>;
  viewerRole: "operator" | "lawyer";
  anchors: Map<string, number>;
  activeId: string | null;
  onActivate: (id: string) => void;
  onChanged: () => Promise<void> | void;
  supportPreview?: boolean;
}) {
  const [isWide, setIsWide] = useState(false);
  const [tops, setTops] = useState<Map<string, number>>(new Map());
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setIsWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const roots = comments.filter((c) => !c.parent_comment_id);
  const repliesByParent = new Map<string, DeliverableComment[]>();
  for (const c of comments) {
    if (c.parent_comment_id) {
      const list = repliesByParent.get(c.parent_comment_id) ?? [];
      list.push(c);
      repliesByParent.set(c.parent_comment_id, list);
    }
  }
  const anchoredRoots = roots.filter((c) => anchors.has(c.id));
  const unanchoredRoots = roots.filter((c) => !anchors.has(c.id));

  // Resolve card tops from anchors + measured heights (wide only).
  useLayoutEffect(() => {
    if (!isWide) return;
    const heights = new Map<string, number>();
    for (const c of roots) {
      heights.set(c.id, cardRefs.current.get(c.id)?.offsetHeight ?? 96);
    }
    const stacked = stackCards(
      anchoredRoots.map((c) => ({
        id: c.id,
        anchor: anchors.get(c.id) ?? 0,
        height: heights.get(c.id) ?? 96,
      })),
      12,
    );
    let cursor = stackBottom(stacked, heights, 12);
    for (const c of unanchoredRoots) {
      stacked.set(c.id, cursor);
      cursor += (heights.get(c.id) ?? 96) + 12;
    }
    setTops((prev) => (sameMap(prev, stacked) ? prev : stacked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWide, anchors, comments]);

  // Bring the focused card into view.
  useEffect(() => {
    if (!activeId) return;
    cardRefs.current.get(activeId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  if (comments.length === 0) {
    return (
      <div className="bg-white border border-border-brand p-4">
        <h3 className="text-sm font-bold text-navy mb-1">Comments</h3>
        <p className="text-xs text-black/45">
          No comments yet. Select any passage in the article to start one.
        </p>
      </div>
    );
  }

  const group = (c: DeliverableComment, positioned: boolean) => {
    const replies = repliesByParent.get(c.id) ?? [];
    const active = activeId === c.id;
    return (
      <div
        key={c.id}
        ref={(el) => {
          if (el) cardRefs.current.set(c.id, el);
          else cardRefs.current.delete(c.id);
        }}
        onClick={() => onActivate(c.id)}
        style={
          positioned
            ? {
                position: "absolute",
                top: tops.get(c.id) ?? anchors.get(c.id) ?? 0,
                left: 0,
                right: 0,
              }
            : undefined
        }
        className={`bg-white border p-3 cursor-pointer transition-shadow ${
          active ? "border-navy ring-1 ring-navy/30 shadow-sm" : "border-border-brand"
        }`}
      >
        <CommentCard
          firmId={firmId}
          deliverableId={deliverableId}
          comment={c}
          num={numberByCommentId.get(c.id)}
          viewerRole={viewerRole}
          onChanged={onChanged}
          supportPreview={supportPreview}
        />
        {replies.map((r) => (
          <div key={r.id} className="ml-3 mt-2 pl-2 border-l-2 border-border-brand">
            <CommentCard
              firmId={firmId}
              deliverableId={deliverableId}
              comment={r}
              num={numberByCommentId.get(r.id)}
              viewerRole={viewerRole}
              onChanged={onChanged}
              supportPreview={supportPreview}
            />
          </div>
        ))}
      </div>
    );
  };

  if (!isWide) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-navy">
          Comments <span className="text-black/40 font-normal">({comments.length})</span>
        </h3>
        {roots.map((c) => group(c, false))}
      </div>
    );
  }

  let laneHeight = 0;
  for (const c of roots) {
    const top = tops.get(c.id) ?? anchors.get(c.id) ?? 0;
    laneHeight = Math.max(laneHeight, top + (cardRefs.current.get(c.id)?.offsetHeight ?? 96) + 12);
  }
  return (
    <div className="relative" style={{ minHeight: laneHeight }}>
      {roots.map((c) => group(c, true))}
    </div>
  );
}

function CommentCard({
  firmId,
  deliverableId,
  comment,
  num,
  viewerRole,
  onChanged,
  supportPreview = false,
}: {
  firmId: string;
  deliverableId: string;
  comment: DeliverableComment;
  num: number | undefined;
  viewerRole: "operator" | "lawyer";
  onChanged: () => Promise<void> | void;
  supportPreview?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function toggleResolved() {
    setBusy(true);
    try {
      await fetch(
        `/api/portal/${firmId}/deliverables/${deliverableId}/comments/${comment.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolved: !comment.resolved }),
        },
      );
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={comment.resolved ? "opacity-55" : ""}>
      <div className="flex items-center gap-2 text-[11px] text-black/50">
        {num && (
          <span className="bg-navy text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center">
            {num}
          </span>
        )}
        <span className="font-semibold text-navy/80">
          {comment.author_role === "lawyer" ? comment.author_name ?? "Lawyer" : "Operator"}
        </span>
        <span>·</span>
        <span>{formatTimestamp(comment.created_at, undefined, { dateStyle: "short", timeStyle: "short" })}</span>
        {comment.resolved && (
          <span className="ml-auto text-green-pass font-semibold uppercase tracking-wider text-[9px]">
            Resolved
          </span>
        )}
      </div>
      <p className="text-[10px] uppercase tracking-wider text-black/35 mt-0.5">
        {annotationLabel(comment.annotation)}
      </p>
      {comment.annotation?.type === "text" && (
        <p className="text-xs text-black/55 mt-1 border-l-2 border-[color:var(--portal-accent)] pl-2">
          “{comment.annotation.quote.slice(0, 120)}”
        </p>
      )}
      <p className="text-sm text-black/85 mt-1 whitespace-pre-wrap">{comment.body}</p>
      <button
        onClick={toggleResolved}
        disabled={supportPreview || busy}
        className="text-[11px] font-semibold text-navy/70 hover:text-navy mt-1 disabled:opacity-50"
      >
        {comment.resolved ? "Reopen" : "Resolve"}
      </button>
    </div>
  );
}

// ─── Sign-off panel ──────────────────────────────────────────────────────────

function SignOffPanel({
  firmId,
  deliverableId,
  viewerRole,
  signerName,
  signerEmail,
  approvalAttestation,
  changesAttestation,
  selectedVersion,
  isCurrentVersion,
  currentVersionMissing,
  status,
  onSigned,
  supportPreview = false,
}: {
  firmId: string;
  deliverableId: string;
  viewerRole: "operator" | "lawyer";
  signerName: string | null;
  signerEmail: string | null;
  approvalAttestation: string;
  changesAttestation: string;
  selectedVersion: DeliverableVersion | null;
  isCurrentVersion: boolean;
  currentVersionMissing: boolean;
  status: ContentDeliverable["status"];
  onSigned: () => Promise<void> | void;
  supportPreview?: boolean;
}) {
  const [decision, setDecision] = useState<"approved" | "changes_requested">("approved");
  const [agreed, setAgreed] = useState(false);
  const [note, setNote] = useState("");
  const [attachments, setAttachments] = useState<DeliverableAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (viewerRole !== "lawyer") {
    return (
      <div className="bg-white border border-border-brand p-4">
        <h3 className="text-sm font-bold text-navy mb-1">Sign-off</h3>
        <p className="text-xs text-black/55">
          The firm&apos;s responsible lawyer completes the sign-off. The operator
          cannot sign on the licensee&apos;s behalf.
        </p>
      </div>
    );
  }

  const attestation = decision === "approved" ? approvalAttestation : changesAttestation;

  async function submit() {
    if (!selectedVersion) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: selectedVersion.id,
          decision,
          agreed,
          note: note.trim() || null,
          attachments,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not sign.");
      } else {
        setAgreed(false);
        setNote("");
        setAttachments([]);
        await onSigned();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white border-2 border-navy/15 p-4">
      <h3 className="text-sm font-bold text-navy mb-1">Sign-off</h3>
      {status === "approved" && (
        <p className="text-xs text-green-pass font-semibold mb-2">
          The current version is approved. Posting a new version reopens review.
        </p>
      )}
      {!selectedVersion ? (
        <p className="text-xs text-black/55">No version to sign yet.</p>
      ) : currentVersionMissing ? (
        <p className="text-xs text-amber-800">
          This deliverable has no current version on record, so it cannot be
          signed yet. Ask the operator to repost the latest version. This is a
          system state, not something you did.
        </p>
      ) : !isCurrentVersion ? (
        <p className="text-xs text-black/55">
          You are viewing an earlier version. Switch to the current version to sign.
        </p>
      ) : !signerEmail ? (
        <p className="text-xs text-amber-800">
          An email for you must be on file before you can sign. Ask the operator
          to add it on the access page.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDecision("approved");
                setAgreed(false);
                setAttachments([]);
              }}
              className={`flex-1 px-2 py-1.5 text-xs font-semibold border ${
                decision === "approved"
                  ? "border-green-pass/30 bg-green-pass/10 text-green-pass"
                  : "border-border-brand text-black/60"
              }`}
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => {
                setDecision("changes_requested");
                setAgreed(false);
              }}
              className={`flex-1 px-2 py-1.5 text-xs font-semibold border ${
                decision === "changes_requested"
                  ? "border-amber-600 bg-amber-50 text-amber-800"
                  : "border-border-brand text-black/60"
              }`}
            >
              Request changes
            </button>
          </div>

          {decision === "changes_requested" && (
            <div className="space-y-1.5">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What needs to change (optional)"
                className="w-full border border-border-brand px-2 py-1.5 text-sm"
              />
              <p className="text-[11px] text-black/50">
                Attach a screenshot if it helps explain the change (PNG, JPG, or PDF, up to 25 MB).
              </p>
              <AttachmentPicker
                firmId={firmId}
                deliverableId={deliverableId}
                attachments={attachments}
                onChange={setAttachments}
                supportPreview={supportPreview}
              />
            </div>
          )}

          <p className="text-[11px] text-black/60 leading-relaxed bg-parchment p-2 border border-border-brand">
            {attestation}
          </p>

          <label className="flex items-start gap-2 text-xs text-black/75">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I confirm the statement above. Signing as {signerName ?? "the firm"} ({signerEmail}) on
              version v{selectedVersion.version_number}.
            </span>
          </label>

          {error && <p className="text-xs text-red-fail">{error}</p>}

          {supportPreview && (
            <p className="text-xs text-black/55">{SUPPORT_PREVIEW_READ_ONLY_MESSAGE}</p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={supportPreview || !agreed || submitting}
            className={`w-full px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              decision === "approved" ? "bg-green-pass" : "bg-amber-700"
            }`}
          >
            {submitting
              ? "Recording..."
              : decision === "approved"
                ? "Sign and approve this version"
                : "Record requested changes"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Approval history ────────────────────────────────────────────────────────

/** Read-only attachment chips: filename links to the signed URL in a new tab. */
function AttachmentChips({ attachments }: { attachments: DeliverableAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {attachments.map((a, i) => (
        <a
          key={i}
          href={a.signed_url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-parchment-2 border border-border-brand text-[11px] text-navy hover:underline"
        >
          {a.name}
        </a>
      ))}
    </div>
  );
}

/** Upload-immediately-on-selection picker, mirrors the matter-messages ComposeForm pattern. */
function AttachmentPicker({
  firmId,
  deliverableId,
  attachments,
  onChange,
  supportPreview = false,
}: {
  firmId: string;
  deliverableId: string;
  attachments: DeliverableAttachment[];
  onChange: (next: DeliverableAttachment[]) => void;
  supportPreview?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = "";
    setError(null);
    setUploading(true);
    try {
      let next = attachments;
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}/attachments`, {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Upload failed.");
        } else {
          next = [...next, json.attachment as DeliverableAttachment];
          onChange(next);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-parchment-2 border border-border-brand text-[11px] text-navy"
            >
              {a.name}
              <button
                type="button"
                onClick={() => onChange(attachments.filter((_, j) => j !== i))}
                className="text-black/40 hover:text-black leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={supportPreview || uploading}
        className="text-[11px] font-semibold uppercase tracking-wider px-2 py-1 border border-border-brand text-black/60 hover:bg-parchment-2 disabled:opacity-50"
      >
        {uploading ? "Uploading..." : "Attach screenshot or PDF"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
        onChange={onFileChange}
        className="hidden"
      />
      {error && <p className="text-[11px] text-red-fail">{error}</p>}
    </div>
  );
}

/** Reply composer for one change-request thread. Posts a comment anchored to the record. */
function ReplyComposer({
  firmId,
  deliverableId,
  approvalRecordId,
  versionId,
  viewerRole,
  onPosted,
  onCancel,
  supportPreview = false,
}: {
  firmId: string;
  deliverableId: string;
  approvalRecordId: string;
  versionId: string;
  viewerRole: "operator" | "lawyer";
  onPosted: () => Promise<void> | void;
  onCancel: () => void;
  supportPreview?: boolean;
}) {
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<DeliverableAttachment[]>([]);
  const [notify, setNotify] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifyWarning, setNotifyWarning] = useState<string | null>(null);
  const isOperator = viewerRole === "operator";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && attachments.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: versionId,
          body: body.trim() || "(attachment)",
          approval_record_id: approvalRecordId,
          attachments,
          client_notification_choice: isOperator && notify ? "notify_now" : "silent",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not post.");
      } else {
        setBody("");
        setAttachments([]);
        setNotify(false);
        if (isOperator && json.notification?.status === "failed") {
          setNotifyWarning("The reply was posted, but the notification email could not be sent.");
        } else {
          setNotifyWarning(null);
        }
        await onPosted();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-2 bg-parchment-2 border border-border-brand p-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder={viewerRole === "lawyer" ? "Reply to the operator..." : "Reply to the firm..."}
        className="w-full border border-border-brand px-2 py-1.5 text-sm resize-y bg-white"
      />
      <AttachmentPicker
        firmId={firmId}
        deliverableId={deliverableId}
        attachments={attachments}
        onChange={setAttachments}
        supportPreview={supportPreview}
      />
      {isOperator && (
        <label className="flex items-center gap-2 text-xs text-black/70">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          Notify the client by email
        </label>
      )}
      {isOperator && (
        <p className="text-xs text-black/50">
          {notify
            ? "The comment will be posted and the client will receive an email."
            : "The comment will be posted without sending an email."}
        </p>
      )}
      {error && <p className="text-xs text-red-fail">{error}</p>}
      {notifyWarning && <p className="text-xs text-amber-800">{notifyWarning}</p>}
      {supportPreview && (
        <p className="text-xs text-black/55">{SUPPORT_PREVIEW_READ_ONLY_MESSAGE}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={supportPreview || sending || (!body.trim() && attachments.length === 0)}
          className="px-3 py-1.5 text-xs font-semibold bg-navy text-white disabled:opacity-50"
        >
          {sending ? "Posting..." : isOperator && notify ? "Post reply and notify" : "Post reply"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-semibold border border-border-brand text-black/60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface ResolutionLine {
  versionId: string;
  versionNumber: number;
  suffix: string;
}

/**
 * Whether a version was posted in direct answer to this changes_requested
 * record, and if so what happened to that version since (still current and
 * awaiting re-review, or itself since approved). Null when no version has
 * answered the record yet, which is the dead-end state this feature replaces.
 */
function resolutionLineFor(
  record: ApprovalRecord,
  versions: DeliverableVersion[],
  approvals: ApprovalRecord[],
  deliverable: ContentDeliverable,
): ResolutionLine | null {
  const v = versions.find((x) => x.responds_to_approval_id === record.id);
  if (!v) return null;
  const approvedRecord = approvals.find((a) => a.version_id === v.id && a.decision === "approved");
  if (approvedRecord) {
    const approvedDate = formatTimestamp(approvedRecord.created_at, undefined, { dateStyle: "medium" });
    return { versionId: v.id, versionNumber: v.version_number, suffix: `. Approved ${approvedDate}.` };
  }
  const postedDate = formatTimestamp(v.created_at, undefined, { dateStyle: "medium" });
  if (v.id === deliverable.current_version_id) {
    return {
      versionId: v.id,
      versionNumber: v.version_number,
      suffix: `, posted ${postedDate}. Awaiting re-review.`,
    };
  }
  return { versionId: v.id, versionNumber: v.version_number, suffix: `, posted ${postedDate}.` };
}

function ApprovalHistory({
  firmId,
  deliverableId,
  viewerRole,
  approvals,
  comments,
  versions,
  deliverable,
  onSwitchVersion,
  onChanged,
  supportPreview = false,
}: {
  firmId: string;
  deliverableId: string;
  viewerRole: "operator" | "lawyer";
  approvals: ApprovalRecord[];
  comments: DeliverableComment[];
  versions: DeliverableVersion[];
  deliverable: ContentDeliverable;
  onSwitchVersion: (versionId: string) => void;
  onChanged: () => Promise<void> | void;
  supportPreview?: boolean;
}) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  if (approvals.length === 0) return null;
  return (
    <div className="bg-white border border-border-brand p-4">
      <h3 className="text-sm font-bold text-navy mb-3">Approval record</h3>
      <ul className="space-y-4">
        {approvals.map((a) => {
          const replies = comments
            .filter((c) => c.approval_record_id === a.id)
            .sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0));
          const resolution =
            a.decision === "changes_requested"
              ? resolutionLineFor(a, versions, approvals, deliverable)
              : null;
          return (
            <li key={a.id} className="text-xs border-l-2 pl-2 border-border-brand">
              <div className="flex items-center gap-2">
                <span
                  className={`uppercase tracking-wider font-bold text-[10px] ${
                    a.decision === "approved" ? "text-green-pass" : "text-amber-700"
                  }`}
                >
                  {a.decision === "approved" ? "Approved" : "Changes requested"}
                </span>
                <span className="text-black/40">v{a.version_number}</span>
              </div>
              <p className="text-black/70 mt-0.5">
                {a.signer_name} ({a.signer_email})
              </p>
              <p className="text-black/40">
                {formatTimestamp(a.created_at, undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
              {a.note && <p className="text-black/60 mt-1">{a.note}</p>}
              <AttachmentChips attachments={a.attachments} />

              {resolution && (
                <p className="text-navy mt-1.5">
                  Addressed in{" "}
                  <button
                    type="button"
                    onClick={() => onSwitchVersion(resolution.versionId)}
                    className="font-semibold underline hover:no-underline"
                  >
                    v{resolution.versionNumber}
                  </button>
                  {resolution.suffix}
                </p>
              )}

              {a.decision === "changes_requested" && (
                <div className="mt-2 space-y-2">
                  {replies.map((r) => (
                    <div key={r.id} className="ml-2 pl-2 border-l border-border-brand/60">
                      <p className="text-black/70">
                        <span className="font-semibold">
                          {r.author_name ?? (r.author_role === "operator" ? "Operator" : "The firm")}
                        </span>
                        {" · "}
                        {formatTimestamp(r.created_at, undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                      <p className="text-black/70 mt-0.5">{r.body}</p>
                      <AttachmentChips attachments={r.attachments} />
                    </div>
                  ))}

                  {replyingTo === a.id ? (
                    <ReplyComposer
                      firmId={firmId}
                      deliverableId={deliverableId}
                      approvalRecordId={a.id}
                      versionId={a.version_id}
                      viewerRole={viewerRole}
                      supportPreview={supportPreview}
                      onCancel={() => setReplyingTo(null)}
                      onPosted={async () => {
                        setReplyingTo(null);
                        await onChanged();
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReplyingTo(a.id)}
                      className="text-[11px] font-semibold uppercase tracking-wider text-navy hover:underline"
                    >
                      Reply
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Version composer ────────────────────────────────────────────────────────

/**
 * Confirmation modal shown before a version is posted. Silent is always
 * preselected and there is no way to carry a prior choice forward: this
 * component is unmounted (not just hidden) whenever it is closed, so the
 * next open always starts from a fresh "silent" default.
 */
function PostVersionConfirmModal({
  posting,
  onCancel,
  onConfirm,
}: {
  posting: boolean;
  onCancel: () => void;
  onConfirm: (choice: ClientNotificationChoice) => void;
}) {
  const [choice, setChoice] = useState<ClientNotificationChoice>("silent");

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
      <div className="bg-white max-w-lg w-full border border-black/10 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-black/8">
          <h2 className="text-lg font-bold text-navy">Post this version</h2>
          <p className="mt-1 text-sm text-black/60">
            The updated content will become the current version. Choose whether the client
            should receive an email about this update.
          </p>
        </div>
        <div className="px-6 py-4 space-y-2">
          <label className="flex items-start gap-3 border border-border-brand px-3 py-2.5 cursor-pointer has-[:checked]:border-navy has-[:checked]:bg-parchment-2">
            <input
              type="radio"
              name="version-notify-choice"
              checked={choice === "silent"}
              onChange={() => setChoice("silent")}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-semibold text-navy">Save without notifying</span>
              <span className="block text-xs text-black/60 mt-0.5">
                Create the version and make it available in the portal without sending an email.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 border border-border-brand px-3 py-2.5 cursor-pointer has-[:checked]:border-navy has-[:checked]:bg-parchment-2">
            <input
              type="radio"
              name="version-notify-choice"
              checked={choice === "notify_now"}
              onChange={() => setChoice("notify_now")}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-semibold text-navy">Save and notify the client now</span>
              <span className="block text-xs text-black/60 mt-0.5">
                Create the version and send one review-notification email after it is saved
                successfully.
              </span>
            </span>
          </label>
        </div>
        <div className="px-6 py-3 bg-parchment-2 border-t border-black/8">
          <p className="text-xs text-black/60 mb-2">
            {choice === "silent"
              ? "No email will be sent."
              : "The client will receive a notification email."}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={posting}
              className="text-sm font-semibold uppercase tracking-wider text-black/60 hover:text-navy px-3 py-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(choice)}
              disabled={posting}
              className="bg-navy text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-50"
            >
              {posting
                ? "Posting..."
                : choice === "silent"
                  ? "Post version without notifying"
                  : "Post version and notify"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VersionComposer({
  firmId,
  deliverableId,
  contentKind,
  respondsToApproval,
  onPosted,
  onSelectNew,
}: {
  firmId: string;
  deliverableId: string;
  contentKind: ContentDeliverable["content_kind"];
  /** The open changes_requested record this version answers, if any. */
  respondsToApproval: ApprovalRecord | null;
  onPosted: () => Promise<void> | void;
  onSelectNew: (id: string) => void;
}) {
  const [bodyHtml, setBodyHtml] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [notifyWarning, setNotifyWarning] = useState<string | null>(null);

  function openConfirm() {
    setError(null);
    if (contentKind !== "text" && !file) {
      setError("Choose a file.");
      return;
    }
    if (contentKind === "text" && !bodyHtml.trim()) {
      setError("Content is required.");
      return;
    }
    setNotifyWarning(null);
    setShowConfirm(true);
  }

  async function post(choice: ClientNotificationChoice) {
    setPosting(true);
    setError(null);
    try {
      let res: Response;
      if (contentKind === "text") {
        res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}/versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body_html: bodyHtml,
            note: note.trim() || null,
            responds_to_approval_id: respondsToApproval?.id ?? null,
            client_notification_choice: choice,
          }),
        });
      } else {
        if (!file) {
          setError("Choose a file.");
          setPosting(false);
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        if (note.trim()) fd.append("note", note.trim());
        if (respondsToApproval) fd.append("responds_to_approval_id", respondsToApproval.id);
        fd.append("client_notification_choice", choice);
        res = await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}/versions`, {
          method: "POST",
          body: fd,
        });
      }
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not post version.");
        setShowConfirm(false);
      } else {
        setBodyHtml("");
        setNote("");
        setFile(null);
        setShowConfirm(false);
        if (json.notification?.status === "failed") {
          setNotifyWarning("The version was posted, but the notification email could not be sent.");
        }
        if (json.version?.id) onSelectNew(json.version.id);
        await onPosted();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setShowConfirm(false);
    } finally {
      setPosting(false);
    }
  }

  const requestNote = respondsToApproval?.note ?? "";
  const requestNoteTruncated = requestNote.length > 400 && !noteExpanded;

  return (
    <div className="bg-parchment border border-border-brand p-3 space-y-2">
      <p className="text-xs font-semibold text-navy">Post a new version</p>

      {respondsToApproval && (
        <div className="bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
          <p className="uppercase tracking-wider font-bold text-amber-800 text-[10px]">
            Responding to changes requested
          </p>
          <p className="text-amber-900 mt-0.5">
            {respondsToApproval.signer_name}, v{respondsToApproval.version_number},{" "}
            {formatTimestamp(respondsToApproval.created_at, undefined, { dateStyle: "medium" })}
          </p>
          {requestNote && (
            <>
              <p className="text-amber-900/90 mt-1">
                {requestNoteTruncated ? `${requestNote.slice(0, 400)}...` : requestNote}
              </p>
              {requestNote.length > 400 && (
                <button
                  type="button"
                  onClick={() => setNoteExpanded((s) => !s)}
                  className="text-amber-800 underline hover:no-underline mt-0.5"
                >
                  {noteExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {contentKind === "text" ? (
        <>
          <textarea
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            rows={8}
            placeholder="Paste or write the content. Basic HTML is supported (headings, lists, links, bold)."
            className="w-full border border-border-brand px-2 py-1.5 text-sm font-mono resize-y"
          />
          {bodyHtml.trim() && (
            <details className="text-xs">
              <summary className="cursor-pointer text-black/55">Preview</summary>
              <div
                className="prose-deliverable mt-2 bg-white p-3 border border-border-brand text-sm [&_h2]:font-bold [&_h2]:text-navy [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            </details>
          )}
        </>
      ) : (
        <input
          type="file"
          accept={contentKind === "image" ? "image/*" : "application/pdf"}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
      )}
      <div>
        <label className="text-[11px] font-semibold text-black/60 uppercase tracking-wider">
          What changed in this version
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            respondsToApproval
              ? "Answer the request point by point. This note goes to the reviewer with the re-review notification."
              : "Optional"
          }
          className="w-full border border-border-brand px-2 py-1.5 text-sm mt-1"
        />
      </div>
      {error && <p className="text-xs text-red-fail">{error}</p>}
      {notifyWarning && <p className="text-xs text-amber-800">{notifyWarning}</p>}
      <button
        type="button"
        onClick={openConfirm}
        disabled={posting}
        className="px-3 py-1.5 text-sm font-semibold bg-navy text-white disabled:opacity-50"
      >
        Post version for review
      </button>
      {showConfirm && (
        <PostVersionConfirmModal
          posting={posting}
          onCancel={() => setShowConfirm(false)}
          onConfirm={post}
        />
      )}
    </div>
  );
}

// ─── Archive ─────────────────────────────────────────────────────────────────

function ArchiveControl({
  firmId,
  deliverableId,
  status,
  onArchived,
}: {
  firmId: string;
  deliverableId: string;
  status: ContentDeliverable["status"];
  onArchived: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  if (status === "archived") return null;
  async function archive() {
    if (!confirm("Archive this deliverable? It will be hidden from the active list.")) return;
    setBusy(true);
    try {
      await fetch(`/api/portal/${firmId}/deliverables/${deliverableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
      await onArchived();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={archive}
      disabled={busy}
      className="text-xs text-black/45 hover:text-red-fail disabled:opacity-50"
    >
      {busy ? "Archiving..." : "Archive deliverable"}
    </button>
  );
}
