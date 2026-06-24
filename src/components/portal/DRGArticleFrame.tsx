"use client";

import { useRef, useEffect, useLayoutEffect, useCallback, type RefObject } from "react";
import type { DeliverableAnnotation } from "@/lib/types";
import {
  applyHighlights,
  measureAnchors,
  setActiveHighlight,
  type HighlightItem,
} from "@/lib/highlight-dom";
import "./drg-article-frame.css";

/**
 * DRG-faithful article shell for the deliverable review render.
 *
 * Mirrors drglaw.ca/journal/[slug] structure: chip row (topic, date, byline,
 * read time), display title, lead paragraph, hero image, body. Body is
 * already sanitized (`sanitizeExplainerHtml` server-side at addVersion);
 * we render it inside a Source Serif 4 / oxblood / cream wrapper that
 * matches the live site.
 *
 * Annotation triggers (Google-Docs-style floating popover):
 *  - Text mouseup with a non-collapsed selection fires onAnnotate with a
 *    text annotation + the bounding-rect viewport position so the parent
 *    can anchor a floating comment composer near the selection.
 *  - Click on any <img> inside the body fires onAnnotate with an image
 *    annotation + position centered above that image.
 *  - Click on the hero image fires onAnnotate with an image annotation.
 *
 * CSS namespace `.cls-drg-article` keeps the DRG variables and rules from
 * leaking into the portal Tailwind chrome.
 */

export type AnnotationPosition = { top: number; left: number };

export function DRGArticleFrame({
  title,
  excerpt,
  topic,
  byline,
  publishDate,
  readTime,
  heroImageUrl,
  bodyHtml,
  onAnnotate,
  highlights,
  measureRef,
  onAnchors,
  activeHighlightId = null,
  onHighlightClick,
}: {
  title: string;
  excerpt: string | null;
  topic: string | null;
  byline: string | null;
  publishDate: string | null;
  readTime: string | null;
  heroImageUrl: string | null;
  bodyHtml: string;
  onAnnotate: (annotation: DeliverableAnnotation, position: AnnotationPosition) => void;
  /** Stored text-comment ranges to keep highlighted in the body. */
  highlights?: HighlightItem[];
  /** The shared row element; mark tops are reported relative to its top. */
  measureRef?: RefObject<HTMLElement | null>;
  /** Reports each highlight's row-relative top so the margin can align cards. */
  onAnchors?: (anchors: Map<string, number>) => void;
  /** The currently focused comment; its highlight gets stronger emphasis. */
  activeHighlightId?: string | null;
  /** Fires when a highlighted passage is clicked. */
  onHighlightClick?: (commentId: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const heroImgRef = useRef<HTMLImageElement>(null);

  const highlightsKey = (highlights ?? [])
    .map((h) => `${h.id}:${h.start}:${h.end}:${h.num}`)
    .join("|");

  const measureAndReport = useCallback(() => {
    const body = bodyRef.current;
    const ref = measureRef?.current;
    if (!body || !ref || !onAnchors) return;
    const refTop = ref.getBoundingClientRect().top;
    const ids = (highlights ?? []).map((h) => h.id);
    onAnchors(measureAnchors(body, refTop, ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureRef, onAnchors, highlightsKey]);

  // Apply (or refresh) the marks whenever the body or the comment set changes,
  // then report anchor positions to the parent.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || highlights === undefined) return;
    applyHighlights(body, bodyHtml, highlights);
    setActiveHighlight(body, activeHighlightId);
    measureAndReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHtml, highlightsKey]);

  // Re-measure on reflow (resize, image/font load) without re-wrapping.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || highlights === undefined) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureAndReport);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(body);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [measureAndReport, highlights]);

  // Reflect the active comment onto its highlight without re-wrapping.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || highlights === undefined) return;
    setActiveHighlight(body, activeHighlightId);
  }, [activeHighlightId, highlights]);

  function onTextMouseUp() {
    const container = bodyRef.current;
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

    // Viewport-relative rect of the selection; the floating popover uses
    // `position: fixed` so viewport coords are exactly what it needs.
    const rect = range.getBoundingClientRect();
    const position: AnnotationPosition = {
      top: rect.top,
      left: rect.left + rect.width / 2,
    };
    onAnnotate({ type: "text", start, end: start + quote.length, quote }, position);
  }

  // Event delegation: any <img> clicked inside the article body triggers an
  // image annotation. Inline images in body_html don't have React refs, so
  // delegation is the cleanest approach.
  function onBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    // A click on a highlighted passage focuses its comment card.
    const mark = target.closest?.("mark.drg-hl") as HTMLElement | null;
    if (mark && onHighlightClick) {
      const id = mark.dataset.hlId;
      if (id) {
        onHighlightClick(id);
        return;
      }
    }
    if (target.tagName !== "IMG") return;
    const img = target as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    const position: AnnotationPosition = {
      top: rect.top,
      left: rect.left + rect.width / 2,
    };
    onAnnotate(
      { type: "image", src: img.src, alt: img.alt || undefined },
      position,
    );
  }

  function onHeroClick() {
    const img = heroImgRef.current;
    if (!img || !heroImageUrl) return;
    const rect = img.getBoundingClientRect();
    const position: AnnotationPosition = {
      top: rect.top,
      left: rect.left + rect.width / 2,
    };
    onAnnotate({ type: "image", src: heroImageUrl, alt: title }, position);
  }

  return (
    <div className="cls-drg-article">
      <div className="drg-preview-band">
        Preview, how readers will see this on drglaw.ca
      </div>

      <div className="drg-topband">
        DRG Law
        <span className="drg-topband-sub">Decisions in legal clarity</span>
      </div>

      <div className="drg-main">
        <div className="drg-article-header">
          <div className="drg-chip-row">
            {topic && <span className="drg-chip">{topic}</span>}
            <span className="drg-dot" aria-hidden="true">·</span>
            <span className={publishDate ? "" : "drg-chip is-draft"}>
              {publishDate ? formatDate(publishDate) : "Draft, not yet published"}
            </span>
            {readTime && (
              <>
                <span className="drg-dot" aria-hidden="true">·</span>
                <span>{readTime}</span>
              </>
            )}
            {byline && (
              <>
                <span className="drg-dot" aria-hidden="true">·</span>
                <span>{byline}</span>
              </>
            )}
          </div>
          <h1 className="drg-display">{title}</h1>
          {excerpt && <p className="drg-lead">{excerpt}</p>}
        </div>
      </div>

      <div className={heroImageUrl ? "drg-hero-frame" : "drg-hero-frame is-empty"}>
        {heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={heroImgRef}
            src={heroImageUrl}
            alt={title}
            onClick={onHeroClick}
            style={{ cursor: "pointer" }}
            title="Click to comment on this image"
          />
        ) : (
          <span>Hero image not yet generated</span>
        )}
      </div>

      <div className="drg-body-wrap">
        <div
          ref={bodyRef}
          className="drg-body"
          onMouseUp={onTextMouseUp}
          onClick={onBodyClick}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>

      <div className="drg-final-cta">
        <div className="drg-final-cta-inner">
          <p className="drg-final-cta-eyebrow">Next step</p>
          <h2 className="drg-final-cta-title">
            Send the question before the decision hardens
          </h2>
          <p className="drg-final-cta-body">
            I read every message myself. If I can help, I write back with the
            plan. If your file fits another lawyer better, I tell you so and
            name one.
          </p>
          <div className="drg-final-cta-actions">
            <span className="drg-cta-btn">Send the question</span>
            <span className="drg-cta-btn is-ghost">Call 647 584 0998</span>
          </div>
        </div>
      </div>

      <div className="drg-op-footer">
        <strong>Preview chrome.</strong> The top band, hero placeholder, and
        bottom CTA are rendered locally to match drglaw.ca. The actual
        publish-time page is built from the firm site, not this preview.
      </div>
    </div>
  );
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00` : isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  const month = d.toLocaleString("en-CA", { month: "long" });
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
