"use client";

/**
 * ActsSystemSection — four expanded ACTS cards on a dot-grid white background
 *
 * Reuses the bespoke icons from ActsIcons. Each card carries the Sage-register
 * description from the audit document: name what the phase produces in the
 * lawyer's day, not what the methodology is.
 */

import type { ReactNode } from "react";
import { IconAuthority, IconCapture, IconTarget, IconScreen } from "./ActsIcons";

interface SystemCardProps {
  num: string;
  letter: "A" | "C" | "T" | "S";
  icon: ReactNode;
  title: string;
  body: string;
  delay: 1 | 2 | 3 | 4;
}

function SystemCard({ num, letter, icon, title, body, delay }: SystemCardProps) {
  return (
    <article className={`s-card reveal reveal-delay-${delay}`}>
      <div className="s-header">
        <span className="s-num">{num}</span>
        <span className="s-letter">{letter}</span>
      </div>
      <div className="s-icon">{icon}</div>
      <h3 className="s-title">{title}</h3>
      <p className="s-body">{body}</p>
    </article>
  );
}

export default function ActsSystemSection() {
  return (
    <section id="system" className="section-dot-grid">
      <div className="section-inner">
        <div className="chapter-mark reveal">
          <span className="eyebrow">The ACTS System</span>
        </div>
        <h2 className="section-headline reveal">
          One operator. Four phases.<br />One signed-case engine<span className="ts" />
        </h2>
        <p className="section-sub reveal" style={{ marginBottom: "var(--sp-7)" }}>
          Each phase runs continuously, in sequence. Authority compounds trust
          before a prospect ever calls. Capture puts you in the searches your
          best clients run. Target spends only against the matters you want
          more of. Screen ranks every inquiry before it reaches you.
        </p>

        <div className="s-grid">
          <SystemCard
            num="01 · Authority"
            letter="A"
            icon={<IconAuthority />}
            title="Trust compounds before the call"
            body="By the time a prospect finds your firm, they have already read what you publish, seen what others say about you, and decided you are the firm they want. Positioning, content, and review systems run continuously to make that the default outcome."
            delay={1}
          />
          <SystemCard
            num="02 · Capture"
            letter="C"
            icon={<IconCapture />}
            title="Your best clients find you first"
            body="The searches your best clients actually run, you rank for. Not the broad terms every firm fights over. The specific matter language the high-value cases type."
            delay={2}
          />
          <SystemCard
            num="03 · Target"
            letter="T"
            icon={<IconTarget />}
            title="Spend only against the matters you want"
            body="Ad budget goes against the case types that pay the bills. Not against volume, not against clicks, not against whatever bid strategy the platform recommends by default."
            delay={3}
          />
          <SystemCard
            num="04 · Screen"
            letter="S"
            icon={<IconScreen />}
            title="Every inquiry arrives ranked"
            body="Every inquiry is scored zero to one hundred before it reaches you. Band A is the case you call back inside the hour. Band E is the one you decline with one line. You open the file already knowing which band it sits in."
            delay={4}
          />
        </div>

        <div className="s-anchor reveal">
          <p>
            Run the four phases as one engagement, by one operator. <em>That is the system.</em>
          </p>
        </div>
      </div>

      <style jsx>{`
        .s-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: var(--sp-5);
          margin-bottom: var(--sp-7);
        }

        .s-card {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          border-top: 3px solid var(--navy);
          padding: 32px 26px;
          box-shadow: 0 4px 20px rgba(30, 47, 88, 0.07);
          transition: box-shadow 0.3s, transform 0.3s;
          color: var(--navy);
        }
        .s-card:hover {
          box-shadow: 0 16px 48px rgba(30, 47, 88, 0.13);
          transform: translateY(-4px);
        }

        .s-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--sp-4);
        }
        .s-num {
          font-family: var(--font-display);
          font-size: var(--fs-eyebrow);
          font-weight: 700;
          letter-spacing: var(--ls-label);
          text-transform: uppercase;
          color: var(--stone-on-light);
        }
        .s-letter {
          font-family: var(--font-display);
          font-size: 20px;
          font-weight: 800;
          color: var(--stone);
          line-height: 1;
        }

        .s-icon {
          color: var(--navy);
          margin-bottom: var(--sp-4);
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        :global(.s-icon svg) {
          width: 48px;
          height: 48px;
          stroke: currentColor;
        }

        .s-title {
          font-family: var(--font-display);
          font-size: 19px;
          font-weight: 800;
          color: var(--navy);
          line-height: 1.25;
          margin-bottom: var(--sp-3);
        }
        .s-body {
          font-size: var(--fs-body-sm);
          color: var(--text-muted);
          line-height: 1.65;
        }

        .s-anchor {
          text-align: center;
          padding-top: var(--sp-6);
        }
        .s-anchor p {
          font-family: var(--font-display);
          font-size: var(--fs-anchor);
          font-weight: 700;
          color: var(--navy);
          line-height: 1.3;
        }
        :global(.s-anchor p em) {
          font-style: normal;
          color: var(--stone);
        }

        @media (max-width: 1024px) {
          .s-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .s-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
