"use client";

import { useRef } from "react";
import type { DeliverableAnnotation } from "@/lib/types";
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
 * Selection-to-comment works the same as the generic TextViewer: mouseup
 * with a non-collapsed selection inside the body fires onAnnotate with a
 * text annotation, and the parent component shows the comment composer.
 *
 * CSS namespace `.cls-drg-article` keeps the DRG variables and rules from
 * leaking into the portal Tailwind chrome.
 */
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
}: {
  title: string;
  excerpt: string | null;
  topic: string | null;
  byline: string | null;
  publishDate: string | null; // ISO date or null
  readTime: string | null;
  heroImageUrl: string | null;
  bodyHtml: string;
  onAnnotate: (annotation: DeliverableAnnotation) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  function onMouseUp() {
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
    onAnnotate({ type: "text", start, end: start + quote.length, quote });
  }

  return (
    <div className="cls-drg-article">
      <div className="drg-preview-band">Preview · how readers will see this on drglaw.ca</div>

      <div className="drg-article-header">
        <div className="drg-chip-row">
          {topic && <span className="drg-chip">{topic}</span>}
          <span className="drg-dot" aria-hidden="true">·</span>
          <span className={publishDate ? "" : "drg-chip is-draft"}>
            {publishDate ? formatDate(publishDate) : "Draft · not yet published"}
          </span>
          {byline && (
            <>
              <span className="drg-dot" aria-hidden="true">·</span>
              <span>{byline}</span>
            </>
          )}
          {readTime && (
            <>
              <span className="drg-dot" aria-hidden="true">·</span>
              <span>{readTime}</span>
            </>
          )}
        </div>
        <h1 className="drg-display">{title}</h1>
        {excerpt && <p className="drg-lead">{excerpt}</p>}
      </div>

      <div className={heroImageUrl ? "drg-hero-frame" : "drg-hero-frame is-empty"}>
        {heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroImageUrl} alt={title} />
        ) : (
          <span>Hero image not yet generated</span>
        )}
      </div>

      <div
        ref={bodyRef}
        className="drg-body"
        onMouseUp={onMouseUp}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />

      <div className="drg-footer">
        <strong>DRG Law Professional Corporation</strong> · Toronto, Ontario · Reviewed
        and approved by the responsible licensee before publication.
      </div>
    </div>
  );
}

function formatDate(isoDate: string): string {
  // Accept full ISO timestamps or bare YYYY-MM-DD
  const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00` : isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  const month = d.toLocaleString("en-CA", { month: "long" });
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
