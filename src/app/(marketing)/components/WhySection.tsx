"use client";

/**
 * WhySection — four RTB (reasons-to-believe) cards on warm parchment
 *
 * LSO-Fluent · Operator-Led · System-First · Toronto-Native
 *
 * Each card is one defensible differentiator. Sage register: name what we
 * are, not what we promise. The four together are the answer to "why this
 * operator instead of an agency, a US tool, or a generalist."
 */

import type { ReactNode } from "react";

function IconShieldCheck() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true">
      <path d="M24 4L8 10v14c0 9 7.5 16.5 16 20 8.5-3.5 16-11 16-20V10L24 4Z"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <path d="M24 10L14 14v10c0 5.5 4.5 10.5 10 13 5.5-2.5 10-7.5 10-13V14L24 10Z"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" />
      <path d="M17 24l4 4 10-10" stroke="#C4B49A" strokeWidth="2.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconOperator() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true">
      {/* Single central node, accountable */}
      <circle cx="24" cy="24" r="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="24" cy="24" r="2" fill="currentColor" />
      {/* Four spokes — every phase reports to the centre */}
      <line x1="24" y1="6"  x2="24" y2="18" stroke="currentColor" strokeWidth="1.6" opacity="0.7" />
      <line x1="24" y1="30" x2="24" y2="42" stroke="currentColor" strokeWidth="1.6" opacity="0.7" />
      <line x1="6"  y1="24" x2="18" y2="24" stroke="currentColor" strokeWidth="1.6" opacity="0.7" />
      <line x1="30" y1="24" x2="42" y2="24" stroke="currentColor" strokeWidth="1.6" opacity="0.7" />
      {/* Four phase nodes at the ends */}
      <circle cx="24" cy="6"  r="2.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="24" cy="42" r="2.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6"  cy="24" r="2.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="42" cy="24" r="2.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconSystem() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true">
      {/* Six interconnected nodes — system of parts */}
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" opacity="0.85" />
      <circle cx="36" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" opacity="0.85" />
      <circle cx="24" cy="24" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="36" r="3" stroke="currentColor" strokeWidth="1.8" opacity="0.85" />
      <circle cx="36" cy="36" r="3" stroke="currentColor" strokeWidth="1.8" opacity="0.85" />
      {/* Connecting lines */}
      <line x1="14" y1="14" x2="21" y2="22" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <line x1="34" y1="14" x2="27" y2="22" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <line x1="14" y1="34" x2="21" y2="27" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <line x1="34" y1="34" x2="27" y2="27" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <line x1="12" y1="15" x2="12" y2="33" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      <line x1="36" y1="15" x2="36" y2="33" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      {/* Centre dot */}
      <circle cx="24" cy="24" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IconToronto() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true">
      {/* Outer light ring — local radius */}
      <circle cx="24" cy="22" r="18" stroke="currentColor" strokeWidth="1.4"
              strokeDasharray="3 5" opacity="0.35" />
      {/* Map pin */}
      <path d="M24 8C18 8 13.5 12.5 13.5 18C13.5 25 24 38 24 38C24 38 34.5 25 34.5 18C34.5 12.5 30 8 24 8Z"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="18" r="4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="24" cy="18" r="1.6" fill="currentColor" />
      {/* CN tower silhouette hint, suggestive only */}
      <line x1="24" y1="40" x2="24" y2="44" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <line x1="18" y1="44" x2="30" y2="44" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  );
}

interface RtbCardProps {
  icon: ReactNode;
  tag: string;
  title: string;
  body: string;
  delay: 1 | 2 | 3 | 4;
}

function RtbCard({ icon, tag, title, body, delay }: RtbCardProps) {
  return (
    <article className={`w-card reveal reveal-delay-${delay}`}>
      <div className="w-icon">{icon}</div>
      <span className="w-tag">{tag}</span>
      <h3 className="w-title">{title}</h3>
      <p className="w-body">{body}</p>
    </article>
  );
}

export default function WhySection() {
  return (
    <section id="why" className="section-parchment-warm">
      <div className="section-inner">
        <div className="chapter-mark reveal">
          <span className="eyebrow">Why CaseLoad Select</span>
        </div>
        <h2 className="section-headline reveal" style={{ maxWidth: 780 }}>
          Built by one operator with fourteen years of marketing infrastructure work<span className="ts" />
        </h2>
        <p className="section-sub reveal" style={{ marginBottom: "var(--sp-7)" }}>
          Not an agency. Not a software vendor. Not a US tool retrofitted for
          Canada. One named operator running every phase of your firm&apos;s
          marketing, accountable to one signed-case scorecard.
        </p>

        <p className="section-sub reveal" style={{ marginBottom: "var(--sp-7)" }}>
          Clear on what we do. Equally clear on what we don&apos;t.{" "}
          <a href="/what-we-dont-do" style={{ color: "var(--stone-on-light, #9E9070)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "3px" }}>
            Read the scope
          </a>.
        </p>

        <div className="w-grid">
          <RtbCard
            icon={<IconShieldCheck />}
            tag="LSO-Fluent"
            title="Built to the Rules of Professional Conduct"
            body="Every piece of marketing complies with Ontario LSO Rule 4.2-1. No outcome promises, no specialist language, no unverifiable superlatives. The work is something you can stand behind."
            delay={1}
          />
          <RtbCard
            icon={<IconOperator />}
            tag="Operator-Led"
            title="One name on the work"
            body="Adriano runs every engagement. Not a junior coordinator, not a templated playbook handed to a generalist. One operator, named, accountable, and available."
            delay={2}
          />
          <RtbCard
            icon={<IconSystem />}
            tag="System-First"
            title="The four phases run as one engine"
            body="Authority, Capture, Target, and Screen are not a service menu. They are connected components. Miss one and the case falls apart. Together, they compound."
            delay={3}
          />
          <RtbCard
            icon={<IconToronto />}
            tag="Toronto-Native"
            title="Built for the GTA market"
            body="Local SEO tuned for Ontario practice areas. Google Business Profile, BrightLocal citations, and Voice AI agents trained on the legal terms your clients actually use in Toronto, Mississauga, and the GTA."
            delay={4}
          />
        </div>
      </div>

      <style jsx>{`
        .w-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: var(--sp-5);
        }

        .w-card {
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(196, 180, 154, 0.4);
          border-radius: var(--r-card);
          padding: 32px 26px;
          box-shadow: var(--shadow-1);
          transition: box-shadow 0.3s, transform 0.3s;
          color: var(--navy);
        }
        .w-card:hover {
          box-shadow: 0 14px 44px rgba(30, 47, 88, 0.12);
          transform: translateY(-4px);
        }

        .w-icon {
          color: var(--navy);
          margin-bottom: var(--sp-4);
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .w-tag {
          font-family: var(--font-display);
          font-size: var(--fs-eyebrow);
          font-weight: 700;
          letter-spacing: var(--ls-label);
          text-transform: uppercase;
          color: var(--stone-on-light);
          margin-bottom: var(--sp-2);
          display: block;
        }

        .w-title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 800;
          color: var(--navy);
          line-height: 1.3;
          margin-bottom: var(--sp-3);
        }

        .w-body {
          font-size: var(--fs-body-sm);
          color: var(--text-muted);
          line-height: 1.7;
        }

        @media (max-width: 1024px) {
          .w-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .w-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
