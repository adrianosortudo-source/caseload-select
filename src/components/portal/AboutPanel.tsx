"use client";

import { useState } from "react";

/**
 * Standing "About this content" panel, rendered above the deliverables list on
 * /portal/[firmId]/deliverables. bodyHtml is already sanitised server-side
 * (sanitizeExplainerHtml allowlist). Collapsed to a preview when the body runs
 * long; "Read more" expands it. Read once, stays available.
 */
export default function AboutPanel({ bodyHtml }: { bodyHtml: string }) {
  const wordCount = bodyHtml
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const longBody = wordCount > 120;
  const [expanded, setExpanded] = useState(false);
  const collapsed = longBody && !expanded;

  return (
    <section className="bg-white border border-border-brand rounded p-5">
      <h2 className="text-sm font-bold text-navy uppercase tracking-wider mb-3">
        About this content
      </h2>
      <div style={{ position: "relative" }}>
        <div
          className="cls-about-body text-sm text-black/75"
          style={collapsed ? { maxHeight: "150px", overflow: "hidden" } : undefined}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
        {collapsed ? (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "48px",
              background: "linear-gradient(to bottom, rgba(255,255,255,0), #FFFFFF)",
            }}
          />
        ) : null}
      </div>
      {longBody ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-semibold uppercase tracking-wider text-navy hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
      <style>{`
        .cls-about-body p { margin: 0 0 0.75rem; line-height: 1.6; }
        .cls-about-body p:last-child { margin-bottom: 0; }
        .cls-about-body ol, .cls-about-body ul { margin: 0 0 0.75rem; padding-left: 1.3rem; }
        .cls-about-body ol { list-style: decimal; }
        .cls-about-body ul { list-style: disc; }
        .cls-about-body li { margin: 0 0 0.4rem; line-height: 1.55; }
        .cls-about-body strong, .cls-about-body b { font-weight: 700; color: #1E2F58; }
        .cls-about-body a { color: #1E2F58; text-decoration: underline; }
        .cls-about-body h2, .cls-about-body h3, .cls-about-body h4 { color: #1E2F58; font-weight: 700; margin: 1rem 0 0.5rem; }
        .cls-about-body blockquote { border-left: 3px solid #C4B49A; margin: 0 0 0.75rem; padding-left: 0.9rem; color: #4a5a72; }
      `}</style>
    </section>
  );
}
