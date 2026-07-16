"use client";

/**
 * CpiSection: the "Wham Moment" component
 *
 * Brand book identifies CPI as "the single most concrete proof asset the
 * brand owns." This component is the section that converts a curious
 * visitor into someone who wants to see the engine run on their intake.
 *
 * Four priority-band tiles (A through D), matching the live Screen 2.0
 * engine exactly (screen-engine/band.ts). No score range is shown; the
 * live engine has no numeric CPI-to-band cutpoints. Horizontal on
 * desktop, stacked on mobile.
 */

interface BandProps {
  letter: "A" | "B" | "C" | "D";
  label: string;
  action: string;
  color: string;
  delay: 1 | 2 | 3 | 4;
}

// Matches the live engine's four bands exactly (screen-engine/band.ts).
const BANDS: BandProps[] = [
  {
    letter: "A",
    label: "High Priority",
    action: "Call first. Highest-fit, highest-value matter.",
    color: "#2E7D5B",
    delay: 1,
  },
  {
    letter: "B",
    label: "Mid Priority",
    action: "Standard callback. Strong matter, normal queue.",
    color: "#5A8A6E",
    delay: 1,
  },
  {
    letter: "C",
    label: "Low Priority",
    action: "Standard follow-up cadence. Ranked behind A and B.",
    color: "#B58D2E",
    delay: 2,
  },
  {
    letter: "D",
    label: "Refer-eligible",
    action: "Out of scope for this firm. Flagged for the lawyer to refer, take if misclassified, or pass. Nothing goes out under your name that you did not approve.",
    color: "#6B7280",
    delay: 3,
  },
];

function Band({ letter, label, action, color, delay }: BandProps) {
  return (
    <article className={`b-tile reveal reveal-delay-${delay}`} style={{ ["--band-color" as string]: color }}>
      <div className="b-head">
        <span className="b-letter">{letter}</span>
      </div>
      <h3 className="b-label">{label}</h3>
      <p className="b-action">{action}</p>
    </article>
  );
}

export default function CpiSection() {
  return (
    <section id="cpi" className="section-white">
      <div className="section-inner">
        <div className="chapter-mark reveal">
          <span className="eyebrow">The Wham Moment</span>
        </div>
        <h2 className="section-headline reveal">
          The Case Priority Index<span className="ts" />
        </h2>
        <p className="section-sub reveal" style={{ marginBottom: "var(--sp-7)" }}>
          Every inquiry is scored on value, simplicity, urgency, and readiness
          before a lawyer reads it. The score routes the brief into one of
          four bands. Each band has a predetermined action. You open the file
          already knowing which band it sits in, and what the system has
          done with it.
        </p>

        <div className="b-grid">
          {BANDS.map((b) => (
            <Band key={b.letter} {...b} />
          ))}
        </div>

        <div className="b-anchor reveal">
          <p>
            <em>The lawyer does not score the inquiry. The system does.</em>
            <br />
            What the lawyer does is decide.
          </p>
        </div>

        <div className="b-cta reveal">
          <div className="b-cta-text">
            <div className="b-cta-eyebrow">Interactive demonstration</div>
            <p className="b-cta-headline">
              See the Screen run on a sample inquiry<span className="ts" />
            </p>
            <p className="b-cta-sub">
              Five questions, two minutes, a real Screen report with your firm
              name on it. Three sample cases calibrated to Band A, B, and C
              outcomes. Or score a real inquiry your firm received recently.
            </p>
          </div>
          <a href="/screen-demo" className="b-cta-btn">
            Try the Screen
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <polyline points="12 5 19 12 12 19" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </a>
        </div>
      </div>

      <style jsx>{`
        .b-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: var(--sp-3);
          margin-bottom: var(--sp-7);
        }

        .b-tile {
          padding: 28px 22px 26px;
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          background: var(--white);
          box-shadow: var(--shadow-1);
          border-top: 4px solid var(--band-color);
          transition: box-shadow 0.3s, transform 0.3s;
        }
        .b-tile:hover {
          box-shadow: var(--shadow-2);
          transform: translateY(-3px);
        }

        .b-head {
          display: flex;
          align-items: baseline;
          margin-bottom: var(--sp-3);
        }
        .b-letter {
          font-family: var(--font-display);
          font-size: 36px;
          font-weight: 800;
          color: var(--band-color);
          line-height: 1;
        }
        .b-label {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--navy);
          margin-bottom: var(--sp-2);
        }
        .b-action {
          font-size: 12.5px;
          line-height: 1.55;
          color: var(--text-muted);
        }

        .b-anchor {
          text-align: center;
          padding-top: var(--sp-5);
        }
        .b-anchor p {
          font-family: var(--font-display);
          font-size: var(--fs-anchor);
          font-weight: 700;
          color: var(--navy);
          line-height: 1.4;
        }
        :global(.b-anchor p em) {
          font-style: normal;
          color: var(--stone);
        }

        .b-cta {
          margin-top: var(--sp-8);
          padding: var(--sp-6) var(--sp-6);
          background: var(--navy);
          border-radius: var(--r-card);
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--sp-5);
          align-items: center;
          box-shadow: var(--shadow-2);
          position: relative;
          overflow: hidden;
        }
        .b-cta::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -10%;
          width: 320px;
          height: 320px;
          background: radial-gradient(circle, rgba(196, 180, 154, 0.1) 0%, transparent 70%);
          pointer-events: none;
        }
        .b-cta-text {
          position: relative;
          z-index: 1;
        }
        .b-cta-eyebrow {
          font-family: var(--font-display);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 2.2px;
          text-transform: uppercase;
          color: var(--stone);
          margin-bottom: 6px;
        }
        .b-cta-headline {
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 800;
          color: var(--white);
          line-height: 1.3;
          margin: 0 0 8px;
        }
        .b-cta-sub {
          font-size: 13.5px;
          color: rgba(237, 234, 217, 0.7);
          line-height: 1.6;
          margin: 0;
          max-width: 520px;
        }
        .b-cta-btn {
          position: relative;
          z-index: 1;
          font-family: var(--font-body);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--navy-deep);
          background: var(--stone);
          padding: 15px 28px;
          border-radius: var(--r-tight);
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          transition: background 0.2s, transform 0.2s;
        }
        .b-cta-btn:hover {
          background: var(--stone-light);
          transform: translateY(-1px);
        }

        @media (max-width: 720px) {
          .b-cta { grid-template-columns: 1fr; gap: var(--sp-4); }
          .b-cta-btn { justify-content: center; }
        }

        @media (max-width: 1024px) {
          .b-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .b-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
