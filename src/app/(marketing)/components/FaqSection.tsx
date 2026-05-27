"use client";

/**
 * FaqSection — six accordion items + FAQPage JSON-LD schema
 *
 * The JSON-LD schema renders inline so Google parses the questions. Each
 * accordion is one Q+A pair; click toggles `open`. Only one open at a time.
 *
 * Copy is Sage register, addressing the most common qualifying questions
 * a sole-practitioner / 2-lawyer firm would ask before booking a call.
 * Calibrated against LSO Rule 4.2-1: no outcome promises, no specialist
 * language, no unverifiable superlatives.
 */

import { useState } from "react";

interface FaqItem {
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    q: "What does CaseLoad Select actually do?",
    a: "We run the four phases of your firm's marketing as one connected engagement. Authority builds trust before a prospect calls. Capture puts you in the searches your best clients run. Target spends ad budget against the matter types that pay. Screen scores every inquiry and ranks it before it reaches you. One operator runs all four.",
  },
  {
    q: "How is this different from hiring a marketing agency?",
    a: "An agency sells services. SEO. Ads. A website. They manage the task and report on activity. CaseLoad Select replaces the disconnected vendor model with one system, one operator, and one flat retainer. Everything works together. The result compounds month over month instead of resetting.",
  },
  {
    q: "Do you handle LSO compliance?",
    a: "Yes. Every piece of marketing complies with Ontario LSO Rule 4.2-1. No outcome promises, no specialist or expert language, no unverifiable superlatives. The work is something the firm can stand behind. US-built tools cannot guarantee this; CaseLoad Select is built for Ontario from the start.",
  },
  {
    q: "What does the retainer cover?",
    a: "Strategy and execution across all four ACTS phases. Positioning, content, GBP and local SEO, Google Ads, CaseLoad Screen intake AI, voice AI agent, review automation, and weekly reporting. One flat monthly fee. We do not bill by the hour or invoice per deliverable.",
  },
  {
    q: "What happens in the first 30 days?",
    a: "Week one: brand and positioning audit, intake leak diagnosis, baseline metrics captured. Week two: CaseLoad Screen configured with the firm's practice areas, scoring weights, and decline templates. Week three: ad campaigns and content infrastructure live. Week four: first weekly report delivered with a cost-per-signed-case baseline. Every step is approved by you before it ships.",
  },
  {
    q: "Does the intake screen handle clients who don't speak English?",
    a: "Yes. The screen accepts intake in any language Gemini can handle. It detects the lead's language and continues the conversation in that language. The brief the lawyer reads is always in English. The Toronto market is the most multilingual in Canada; filtering intake by language at the door cuts the addressable market by 30 to 60 percent before legal merit is considered.",
  },
];

export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <section id="faq" className="section-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <div className="section-inner" style={{ maxWidth: 800 }}>
        <div className="chapter-mark reveal">
          <span className="eyebrow">Frequently asked</span>
        </div>
        <h2 className="section-headline reveal">
          Questions before the call<span className="ts" />
        </h2>
        <p className="section-sub reveal" style={{ marginBottom: "var(--sp-7)" }}>
          The questions sole practitioners ask before booking. If yours
          isn&apos;t here, raise it on the call.
        </p>

        <div className="f-wrap reveal">
          {FAQS.map((f, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={f.q} className={`f-item${isOpen ? " open" : ""}`}>
                <button
                  className="f-btn"
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                >
                  <span className="f-q">{f.q}</span>
                  <span className="f-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <line x1="6"  y1="12" x2="18" y2="12" />
                      <line className="f-icon-v" x1="12" y1="6"  x2="12" y2="18" />
                    </svg>
                  </span>
                </button>
                <div
                  id={`faq-panel-${i}`}
                  className="f-panel"
                  role="region"
                  aria-hidden={!isOpen}
                >
                  <p className="f-a">{f.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .f-wrap {
          border-top: 1px solid var(--border);
        }
        .f-item {
          border-bottom: 1px solid var(--border);
        }
        .f-btn {
          width: 100%;
          background: transparent;
          border: none;
          padding: 24px 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--sp-4);
          cursor: pointer;
          text-align: left;
          color: var(--navy);
          transition: color 0.2s;
        }
        .f-btn:hover { color: var(--stone-on-light); }
        .f-q {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 700;
          line-height: 1.4;
        }
        .f-icon {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--stone-on-light);
        }
        :global(.f-icon-v) {
          transform-origin: center;
          transition: transform 0.25s var(--ease-out-soft);
        }
        .f-item.open :global(.f-icon-v) {
          transform: rotate(90deg);
        }

        .f-panel {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.35s var(--ease-out-soft);
        }
        .f-item.open .f-panel {
          max-height: 400px;
        }
        .f-a {
          font-size: 14.5px;
          color: var(--text-muted);
          line-height: 1.7;
          padding: 0 0 24px;
          max-width: 70ch;
        }
      `}</style>
    </section>
  );
}
