"use client";

import { useRef, useEffect, useLayoutEffect, useCallback, type RefObject } from "react";
import type { DeliverableAnnotation } from "@/lib/types";
import {
  applyHighlights,
  measureAnchors,
  setActiveHighlight,
  type HighlightItem,
} from "@/lib/highlight-dom";
import type { AnnotationPosition } from "./DRGArticleFrame";
import "./social-post-frame.css";

/**
 * Compact review shell for short-copy social deliverables (Google Business
 * Profile posts, LinkedIn posts). Uses the exact same annotation mechanics as
 * DRGArticleFrame (imperative body innerHTML + applyHighlights so marks
 * survive re-render, text-offset selection comments, click-to-comment hero,
 * click-to-comment title) but with typography and layout sized for a few
 * short paragraphs instead of a 700px-wide journal article.
 *
 * Built 2026-07-07 to fix short GBP/LinkedIn copy getting force-rendered
 * through DRGArticleFrame's journal shell (tight h1/h2 line-heights sized for
 * long-form articles, clipping the top of short posts). Counsel Notes and
 * Clause in the Margin pieces keep DRGArticleFrame; this is GBP + LinkedIn
 * only, selected by deliverable.format in ContentViewer.
 *
 * CSS namespace `.cls-social-post` keeps these rules from leaking into the
 * portal Tailwind chrome or the DRG article frame.
 */

export function SocialPostFrame({
  title,
  excerpt,
  format,
  heroImageUrl,
  bodyHtml,
  onAnnotate,
  highlights,
  elementAnchors,
  measureRef,
  onAnchors,
  activeHighlightId = null,
  onHighlightClick,
}: {
  title: string;
  excerpt: string | null;
  format: string | null;
  heroImageUrl: string | null;
  bodyHtml: string;
  onAnnotate: (annotation: DeliverableAnnotation, position: AnnotationPosition) => void;
  highlights?: HighlightItem[];
  elementAnchors?: { id: string; kind: "title" | "excerpt" | "hero" }[];
  measureRef?: RefObject<HTMLElement | null>;
  onAnchors?: (anchors: Map<string, number>) => void;
  activeHighlightId?: string | null;
  onHighlightClick?: (commentId: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const heroImgRef = useRef<HTMLImageElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const leadRef = useRef<HTMLParagraphElement>(null);

  const highlightsKey = (highlights ?? [])
    .map((h) => `${h.id}:${h.start}:${h.end}:${h.num}`)
    .join("|");
  const elementAnchorsKey = (elementAnchors ?? [])
    .map((e) => `${e.id}:${e.kind}`)
    .join("|");
  const commentedKinds = new Set((elementAnchors ?? []).map((e) => e.kind));

  const measureAndReport = useCallback(() => {
    const body = bodyRef.current;
    const ref = measureRef?.current;
    if (!body || !ref || !onAnchors) return;
    const refTop = ref.getBoundingClientRect().top;
    const ids = (highlights ?? []).map((h) => h.id);
    const map = measureAnchors(body, refTop, ids);
    for (const ea of elementAnchors ?? []) {
      const el =
        ea.kind === "title"
          ? titleRef.current
          : ea.kind === "excerpt"
            ? leadRef.current
            : heroImgRef.current;
      if (el) map.set(ea.id, el.getBoundingClientRect().top - refTop);
    }
    onAnchors(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureRef, onAnchors, highlightsKey, elementAnchorsKey]);

  function onFieldMouseUp(field: "title" | "excerpt", e: React.MouseEvent<HTMLElement>) {
    const el = e.currentTarget;
    const sel = window.getSelection();
    let quote = "";
    let rect: DOMRect;
    if (
      sel &&
      sel.rangeCount > 0 &&
      !sel.isCollapsed &&
      el.contains(sel.getRangeAt(0).commonAncestorContainer)
    ) {
      quote = sel.toString().trim();
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } else {
      quote = (el.textContent ?? "").trim();
      rect = el.getBoundingClientRect();
    }
    if (!quote) return;
    onAnnotate(
      { type: "field", field, quote },
      { top: rect.top, left: rect.left + rect.width / 2 },
    );
  }

  // Body content set imperatively so React never reconciles (and wipes) the
  // injected highlight marks. Same reasoning as DRGArticleFrame.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    applyHighlights(body, bodyHtml, highlights ?? []);
    setActiveHighlight(body, activeHighlightId);
    measureAndReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHtml, highlightsKey, elementAnchorsKey]);

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
    const rect = range.getBoundingClientRect();
    const position: AnnotationPosition = {
      top: rect.top,
      left: rect.left + rect.width / 2,
    };
    onAnnotate({ type: "text", start, end: start + quote.length, quote }, position);
  }

  function onBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
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
    onAnnotate({ type: "image", src: img.src, alt: img.alt || undefined }, position);
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
    <div className="cls-social-post">
      <div className="sp-preview-band">
        {format ? `${format} · Draft preview` : "Draft preview"}
      </div>

      <div className="sp-main">
        <h2
          ref={titleRef}
          className={`sp-title${commentedKinds.has("title") ? " is-commented" : ""}`}
          onMouseUp={(e) => onFieldMouseUp("title", e)}
          title="Select or click to comment on the title"
        >
          {title}
        </h2>
        {excerpt && (
          <p
            ref={leadRef}
            className={`sp-lead${commentedKinds.has("excerpt") ? " is-commented" : ""}`}
            onMouseUp={(e) => onFieldMouseUp("excerpt", e)}
            title="Select or click to comment on the lead"
          >
            {excerpt}
          </p>
        )}
      </div>

      <div
        className={`sp-hero-frame${heroImageUrl ? "" : " is-empty"}${
          commentedKinds.has("hero") ? " is-commented" : ""
        }`}
      >
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

      <div className="sp-body-wrap">
        <div ref={bodyRef} className="sp-body" onMouseUp={onTextMouseUp} onClick={onBodyClick} />
      </div>
    </div>
  );
}
