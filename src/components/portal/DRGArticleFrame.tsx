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
  elementAnchors,
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
  /**
   * Whole-element comments anchored to the header title, the lead, or the hero
   * image. These cannot be inline-marked (React owns those nodes), so the
   * margin card is anchored to the element's measured top instead.
   */
  elementAnchors?: { id: string; kind: "title" | "excerpt" | "hero" }[];
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
  const titleRef = useRef<HTMLHeadingElement>(null);
  const leadRef = useRef<HTMLParagraphElement>(null);

  const highlightsKey = (highlights ?? [])
    .map((h) => `${h.id}:${h.start}:${h.end}:${h.num}`)
    .join("|");
  const elementAnchorsKey = (elementAnchors ?? [])
    .map((e) => `${e.id}:${e.kind}`)
    .join("|");
  const commentedKinds = new Set((elementAnchors ?? []).map((e) => e.kind));
  const isLandingPage = isLeadMagnetLanding(title, bodyHtml);
  const publicTitle = cleanLandingTitle(title);

  const measureAndReport = useCallback(() => {
    const body = bodyRef.current;
    const ref = measureRef?.current;
    if (!body || !ref || !onAnchors) return;
    const refTop = ref.getBoundingClientRect().top;
    const ids = (highlights ?? []).map((h) => h.id);
    const map = measureAnchors(body, refTop, ids);
    // Add the header-element comments, anchored to the element's top.
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

  // Select text in (or click) the title or lead to comment on it. The header is
  // React-owned, so this produces a whole-element "field" annotation rather than
  // an inline-highlighted passage.
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

  // The body content is rendered IMPERATIVELY here, not via React's
  // dangerouslySetInnerHTML. React must not own the body's inner DOM: when the
  // margin reports anchors and the parent re-renders, React would reconcile a
  // dangerouslySetInnerHTML node and wipe the <mark> highlights we inject. By
  // owning innerHTML ourselves, the highlights survive every re-render.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    applyHighlights(body, bodyHtml, highlights ?? []);
    setActiveHighlight(body, activeHighlightId);
    measureAndReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHtml, highlightsKey, elementAnchorsKey]);

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

  if (isLandingPage) {
    return (
      <div className="cls-drg-article is-landing-page">
        <div className="drg-preview-band">Draft preview</div>
        <PublicSiteHeader />

        <section className="drg-landing-hero">
          <div className="drg-landing-inner">
            <div className="drg-landing-copy">
              <div className="drg-landing-kicker">
                {topic || "From the Journal - Checklist - Ontario commercial leases"}
              </div>
              <h1
                ref={titleRef}
                className={`drg-landing-title${commentedKinds.has("title") ? " is-commented" : ""}`}
                onMouseUp={(e) => onFieldMouseUp("title", e)}
                title="Select or click to comment on the title"
              >
                {publicTitle}
              </h1>
              {excerpt && (
                <p
                  ref={leadRef}
                  className={`drg-landing-lead${commentedKinds.has("excerpt") ? " is-commented" : ""}`}
                  onMouseUp={(e) => onFieldMouseUp("excerpt", e)}
                  title="Select or click to comment on the lead"
                >
                  {excerpt}
                </p>
              )}
              <ChecklistSummary />
            </div>
            <LeadMagnetFormCard />
          </div>
        </section>

        <LegalNotice />
        <TrustStrip />

        <div className="drg-body-wrap drg-landing-body-wrap">
          <div
            ref={bodyRef}
            className="drg-body drg-landing-body"
            onMouseUp={onTextMouseUp}
            onClick={onBodyClick}
          />
        </div>

        <LegalNotice />
        <PublicSiteFooter />
      </div>
    );
  }

  return (
    <div className="cls-drg-article">
      <div className="drg-preview-band">
        Draft preview
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
          <h1
            ref={titleRef}
            className={`drg-display${commentedKinds.has("title") ? " is-commented" : ""}`}
            onMouseUp={(e) => onFieldMouseUp("title", e)}
            title="Select or click to comment on the title"
          >
            {title}
          </h1>
          {excerpt && (
            <p
              ref={leadRef}
              className={`drg-lead${commentedKinds.has("excerpt") ? " is-commented" : ""}`}
              onMouseUp={(e) => onFieldMouseUp("excerpt", e)}
              title="Select or click to comment on the lead"
            >
              {excerpt}
            </p>
          )}
        </div>
      </div>

      <div
        className={`drg-hero-frame${heroImageUrl ? "" : " is-empty"}${
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

      <div className="drg-body-wrap">
        {/* Content is set imperatively in the layout effect above so React
            never reconciles (and wipes) the injected highlight marks. */}
        <div
          ref={bodyRef}
          className="drg-body"
          onMouseUp={onTextMouseUp}
          onClick={onBodyClick}
        />
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

function isLeadMagnetLanding(title: string, bodyHtml: string): boolean {
  return /\blead magnet\b|\blanding page\b/i.test(title) || /send me the checklist/i.test(bodyHtml);
}

function cleanLandingTitle(title: string): string {
  return title.replace(/^\s*\[?lead magnet\s*[·.-]\s*landing page\]?\s*/i, "").trim();
}

function PublicSiteHeader() {
  return (
    <header className="drg-public-header" aria-label="DRG Law public site header preview">
      <div className="drg-logo-lockup">
        <span className="drg-logo-rule" aria-hidden="true" />
        <span className="drg-logo-main">DRG Law</span>
        <span className="drg-logo-sub">Professional Corporation</span>
      </div>
      <nav className="drg-public-nav" aria-label="Public site navigation preview">
        <span>Practice</span>
        <span>Method</span>
        <span>Pricing</span>
        <span>Resources</span>
        <span>About</span>
        <span>Contact</span>
      </nav>
      <div className="drg-public-actions">
        <span>EN | PT</span>
        <span>Call 647-584-0998</span>
        <span className="drg-question-btn">Send your question</span>
      </div>
    </header>
  );
}

function ChecklistSummary() {
  const items = [
    ["01", "A signed note from Damaris.", "Why DRG built this checklist and how to use it before your next negotiation."],
    ["02", "The standard clause annotated.", "Five short phrases that decide your exposure, marked and explained."],
    ["03", "The negotiated alternative annotated.", "The same clause rewritten for the tenant, with five fixes called out."],
    ["04", "Three negotiable terms with sample clause language.", "Substitute-space parameters, cost coverage, right to refuse. Each with a checklist and the exact phrasing to ask for."],
    ["05", "Walk-away math and five questions.", "Put a number on the exposure, then five questions to ask any lawyer reviewing the lease."],
  ];
  return (
    <div className="drg-checklist-summary">
      <div className="drg-section-label">What is inside</div>
      {items.map(([num, heading, body]) => (
        <div className="drg-checklist-row" key={num}>
          <span>{num}</span>
          <p><strong>{heading}</strong> {body}</p>
        </div>
      ))}
    </div>
  );
}

function LeadMagnetFormCard() {
  return (
    <aside className="drg-optin-card" aria-label="Lead magnet form preview">
      <div className="drg-section-label">Send me the checklist</div>
      <h2>Damaris will email it to you and show it on the next page.</h2>
      <p>No charge. No phone call required. The PDF arrives in your inbox and shows on screen as soon as you submit.</p>
      <label>First name<span /></label>
      <label>Email<span /></label>
      <label>Where are you in the deal? <em>optional</em><span className="select">Choose one</span></label>
      <button type="button">Send me the checklist -&gt;</button>
      <p className="drg-privacy-note">We email you the weekly Journal so you receive future checklists in the same series. You can unsubscribe anytime. We do not share your information.</p>
    </aside>
  );
}

function LegalNotice() {
  return (
    <div className="drg-legal-notice">
      <strong>Legal information, not legal advice.</strong> What you read on this website is general information about the law. It is not legal advice for your situation. Sending an intake does not make DRG Law your lawyer. That only happens after DRG Law checks for conflicts and both sides sign a written agreement.
    </div>
  );
}

function TrustStrip() {
  const items = [
    ["Ontario licensed", "LSO Reg. 910221"],
    ["Toronto office", "Real estate and corporate practice"],
    ["English and Portuguese", "Bilingual representation"],
    ["Plain language", "Owner-readable legal writing"],
  ];
  return (
    <div className="drg-trust-strip">
      {items.map(([heading, body]) => (
        <div key={heading}>
          <strong>{heading}</strong>
          <span>{body}</span>
        </div>
      ))}
    </div>
  );
}

function PublicSiteFooter() {
  return (
    <footer className="drg-public-footer">
      <div className="drg-footer-grid">
        <div>
          <div className="drg-logo-lockup">
            <span className="drg-logo-rule" aria-hidden="true" />
            <span className="drg-logo-main">DRG Law</span>
            <span className="drg-logo-sub">Professional Corporation</span>
          </div>
          <p>Decisions framed in legal clarity. DRG Law Professional Corporation. LSO Reg. 910221. English or Portuguese. Remote-first, serving Ontario.</p>
        </div>
        <div><strong>Practice</strong><span>Business Law</span><span>Real Estate</span><span>Wills & estates</span><span>Employment Law</span></div>
        <div><strong>Other matters</strong><span>Ongoing counsel</span><span>Notary and Sworn Statements</span></div>
        <div><strong>Read</strong><span>Resources</span><span>Common questions</span><span>How DRG Law works</span><span>About Damaris</span></div>
        <div><strong>Contact</strong><span>Call 647-584-0998</span><span>WhatsApp 555-629-8048</span><span>info@drglaw.ca</span></div>
      </div>
      <div className="drg-copyright">Copyright 2026 DRG Law Professional Corporation - Toronto, Ontario - LSO Reg. 910221</div>
    </footer>
  );
}
