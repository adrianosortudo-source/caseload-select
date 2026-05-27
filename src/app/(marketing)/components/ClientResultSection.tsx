"use client";

/**
 * ClientResultSection — Damaris testimonial + three stat counters
 *
 * Sits between the CPI section (the wham moment) and the Why section
 * (the RTBs). The most concrete proof asset the brand owns from a real
 * client. Stats count up on scroll-into-view.
 *
 * Per brand book: "Specific, named, attributed accurately. Projected
 * outcomes are framed as projected. Delivered outcomes are named as
 * delivered." The numbers below are from DRG Law's first 90 days.
 */

import StatCounter from "./StatCounter";

export default function ClientResultSection() {
  return (
    <section id="result" className="section-off">
      <div className="section-inner">
        <div className="chapter-mark reveal">
          <span className="eyebrow">Client Result · DRG Law, Toronto</span>
        </div>

        <blockquote className="r-quote reveal">
          <p>
            The intake process used to be my biggest time drain. Now I read a
            brief, make a decision, and move on. The cases I take are the
            right ones<span className="ts" />
          </p>
          <footer className="r-attribution">
            <div className="r-attr-name">Damaris Gutierrez</div>
            <div className="r-attr-firm">Principal, DRG Law · Toronto</div>
          </footer>
        </blockquote>

        <div className="r-stats">
          <div className="r-stat reveal reveal-delay-1">
            <div className="r-stat-num">
              <StatCounter target={3} suffix="×" />
            </div>
            <div className="r-stat-label">Faster intake decisions</div>
            <div className="r-stat-note">Triage time cut from 12 minutes to under 4</div>
          </div>
          <div className="r-stat reveal reveal-delay-2">
            <div className="r-stat-num">
              <StatCounter target={100} suffix="%" />
            </div>
            <div className="r-stat-label">Briefs reviewed same day</div>
            <div className="r-stat-note">Across all Band A and B inquiries, first 90 days</div>
          </div>
          <div className="r-stat reveal reveal-delay-3">
            <div className="r-stat-num">
              <StatCounter target={42} prefix="+" suffix="%" />
            </div>
            <div className="r-stat-label">Priority score lift</div>
            <div className="r-stat-note">Average case-quality score up across signed matters</div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .r-quote {
          margin: 0 auto var(--sp-7);
          max-width: 720px;
          text-align: center;
        }
        .r-quote p {
          font-family: var(--font-display);
          font-size: var(--fs-anchor);
          font-weight: 700;
          color: var(--navy);
          line-height: 1.35;
          letter-spacing: -0.2px;
          margin-bottom: var(--sp-5);
        }
        .r-attribution {
          font-size: 13px;
          color: var(--text-muted);
        }
        .r-attr-name {
          font-family: var(--font-display);
          font-weight: 700;
          color: var(--navy);
          font-size: 13px;
          letter-spacing: 0.4px;
          margin-bottom: 2px;
        }
        .r-attr-firm {
          font-family: var(--font-display);
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          color: var(--stone-on-light);
        }

        .r-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--sp-5);
          max-width: 880px;
          margin: 0 auto;
        }
        .r-stat {
          text-align: center;
          padding: var(--sp-5) var(--sp-4);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          border-top: 3px solid var(--stone);
          background: var(--white);
          box-shadow: var(--shadow-1);
          transition: box-shadow 0.3s, transform 0.3s;
        }
        .r-stat:hover {
          box-shadow: var(--shadow-2);
          transform: translateY(-3px);
        }
        .r-stat-num :global(span),
        .r-stat-num {
          font-family: var(--font-display);
          font-size: 52px;
          font-weight: 800;
          color: var(--navy);
          line-height: 1;
          margin-bottom: var(--sp-3);
          display: block;
        }
        .r-stat-label {
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--navy);
          margin-bottom: var(--sp-2);
        }
        .r-stat-note {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.55;
        }

        @media (max-width: 880px) {
          .r-stats { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
