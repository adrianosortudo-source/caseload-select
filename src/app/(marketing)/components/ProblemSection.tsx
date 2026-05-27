"use client";

/**
 * ProblemSection — three cards on parchment background
 *
 * Volume Trap / Screening Gap / Capacity Cost.
 * Bespoke SVG icons, red-top-border intensifying on hover, reveal-on-scroll
 * with cascading delays.
 *
 * Copy is Sage register (name a pattern, name what it costs). No em dashes,
 * no banned vocabulary, no orphan words. Brand-book compliant.
 */

import type { ReactNode } from "react";

function IconVolumeTrap() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true">
      {/* Funnel filling with too much volume — generic, undifferentiated */}
      <path d="M8 10H40L30 24V36L18 40V24L8 10Z" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
      {/* Rain of identical drops above the funnel */}
      <circle cx="12" cy="4"  r="1.6" fill="currentColor" opacity="0.5" />
      <circle cx="20" cy="3"  r="1.6" fill="currentColor" opacity="0.7" />
      <circle cx="28" cy="4"  r="1.6" fill="currentColor" opacity="0.7" />
      <circle cx="36" cy="3"  r="1.6" fill="currentColor" opacity="0.5" />
      <line x1="12" y1="6"  x2="13" y2="10" stroke="currentColor" strokeWidth="1.4" opacity="0.4" />
      <line x1="20" y1="5"  x2="20" y2="10" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
      <line x1="28" y1="6"  x2="28" y2="10" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
      <line x1="36" y1="5"  x2="35" y2="10" stroke="currentColor" strokeWidth="1.4" opacity="0.4" />
      {/* Cross — the firm can't distinguish */}
      <line x1="36" y1="32" x2="44" y2="40" stroke="#C0392B" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
      <line x1="44" y1="32" x2="36" y2="40" stroke="#C0392B" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

function IconScreeningGap() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true">
      {/* Phone handset, half-faded — voicemail / no-show */}
      <path d="M14 8 L8 14 C8 26, 22 40, 34 40 L40 34 L32 28 L28 32 C24 30, 18 24, 16 20 L20 16 L14 8 Z"
            stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" opacity="0.6" />
      {/* Missed call mark */}
      <circle cx="40" cy="14" r="6" stroke="#C0392B" strokeWidth="2.2" opacity="0.85" />
      <line x1="36" y1="10" x2="44" y2="18" stroke="#C0392B" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

function IconCapacityCost() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true">
      {/* Hourglass — billing hours draining */}
      <path d="M12 6H36 L24 22 L36 38 H12 L24 22 L12 6 Z" stroke="currentColor" strokeWidth="1.8"
            strokeLinejoin="round" opacity="0.55" />
      {/* Sand drained on bottom */}
      <path d="M16 36 H32 L24 28 L16 36 Z" fill="currentColor" opacity="0.35" />
      {/* Falling grain in the middle */}
      <line x1="24" y1="23" x2="24" y2="27" stroke="currentColor" strokeWidth="1.4" opacity="0.7" />
      {/* Red downward arrow — the cost is unrecoverable */}
      <path d="M42 14 L42 28 M38 24 L42 28 L46 24" stroke="#C0392B" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

interface CardProps {
  icon: ReactNode;
  num: string;
  title: string;
  body: string;
  delay: 1 | 2 | 3;
}

function ProblemCard({ icon, num, title, body, delay }: CardProps) {
  return (
    <article className={`p-card reveal reveal-delay-${delay}`}>
      <div className="p-icon">{icon}</div>
      <div className="p-num">{num}</div>
      <h3 className="p-title">{title}</h3>
      <p className="p-body">{body}</p>
    </article>
  );
}

export default function ProblemSection() {
  return (
    <section id="problem" className="section-parchment">
      <div className="section-inner">
        <div className="chapter-mark reveal">
          <span className="eyebrow">Why most law firm marketing fails</span>
        </div>
        <h2 className="section-headline reveal">
          Form fills aren&apos;t signed cases<span className="ts" />
        </h2>
        <p className="section-sub reveal" style={{ marginBottom: "var(--sp-7)" }}>
          Leads come in. Most aren&apos;t worth taking. An intake process that
          can&apos;t tell the difference costs you the cases that actually matter.
        </p>

        <div className="p-grid">
          <ProblemCard
            icon={<IconVolumeTrap />}
            num="01 · The Volume Trap"
            title="Traffic isn't the problem"
            body="You have leads. The issue is that a form fill doesn't distinguish a $400 consultation from a $40,000 matter. Volume without a filter is just noise."
            delay={1}
          />
          <ProblemCard
            icon={<IconScreeningGap />}
            num="02 · The Screening Gap"
            title="Phone screening fails at volume"
            body="Manual intake is inconsistent and slow. One missed follow-up, one vague inquiry handled by feel, and a qualified case walks to the next firm on the list."
            delay={2}
          />
          <ProblemCard
            icon={<IconCapacityCost />}
            num="03 · The Capacity Cost"
            title="A bad case isn't free"
            body="Every file that shouldn't have opened ties up time, attention, and trust. Selection errors compound. The wrong case isn't neutral. It crowds out the right one."
            delay={3}
          />
        </div>

        <p className="p-closing reveal">
          Fix all three and the math changes completely<span className="ts" />
        </p>
      </div>

      <style jsx>{`
        .p-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--sp-5);
          margin-bottom: var(--sp-7);
        }

        .p-card {
          padding: 40px 32px;
          border: 1px solid rgba(196, 180, 154, 0.4);
          border-radius: var(--r-card);
          border-top: 3px solid rgba(192, 57, 43, 0.4);
          background: rgba(255, 255, 255, 0.7);
          box-shadow: var(--shadow-1);
          transition: border-top-color 0.3s, box-shadow 0.3s, transform 0.3s;
          color: var(--navy);
        }
        .p-card:hover {
          border-top-color: rgba(192, 57, 43, 0.8);
          box-shadow: var(--shadow-2);
          transform: translateY(-4px);
        }

        .p-icon {
          width: 44px;
          height: 44px;
          margin-bottom: var(--sp-4);
          color: var(--navy);
        }

        .p-num {
          font-family: var(--font-display);
          font-size: var(--fs-eyebrow);
          font-weight: 700;
          letter-spacing: var(--ls-label);
          text-transform: uppercase;
          color: var(--stone-on-light);
          margin-bottom: var(--sp-3);
        }

        .p-title {
          font-family: var(--font-display);
          font-size: 20px;
          font-weight: 800;
          color: var(--navy);
          line-height: 1.25;
          margin-bottom: var(--sp-3);
        }

        .p-body {
          font-size: var(--fs-body-sm);
          color: var(--text-muted);
          line-height: 1.65;
        }

        .p-closing {
          text-align: center;
          font-family: var(--font-display);
          font-size: 17px;
          font-weight: 700;
          color: var(--navy);
          letter-spacing: 0.3px;
        }

        @media (max-width: 880px) {
          .p-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
