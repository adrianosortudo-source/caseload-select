import type { Metadata } from "next";
import DemoNav from "./_components/DemoNav";
import CasePicker from "./_components/CasePicker";

export const metadata: Metadata = {
  title: "See the Screen at work · CaseLoad Select",
  description:
    "Walk through a sample inquiry. See the Screen score it, band it, and recommend the next action, the same report your firm would receive on a real intake.",
};

/**
 * /screen-demo · Entry page
 *
 * Hero framing → case picker (4 cards) → on click → /screen-demo/quiz/[id]
 *
 * Single-purpose flow. Minimal nav. No competing CTAs. The lawyer either
 * picks a case to run or exits via the small "Back to home" link in the nav.
 */
export default function ScreenDemoEntry() {
  return (
    <>
      <DemoNav />

      <main className="cls-demo-main">
        <section className="cls-demo-hero">
          <div className="cls-demo-eyebrow">Interactive · 5 minutes · Free</div>
          <h1 className="cls-demo-title">
            See the Screen at work<span className="ts" />
          </h1>
          <p className="cls-demo-sub">
            The Screen is the qualifier that runs between every inquiry and
            every minute of the lawyer&apos;s time. Walk through a sample case
            below. We&apos;ll produce the same Screen report your firm would
            receive if this prospect landed in your intake queue today.
          </p>

          <div className="cls-demo-stats">
            <div className="cls-demo-stat">
              <div className="cls-demo-stat-num">5</div>
              <div className="cls-demo-stat-label">Questions per inquiry</div>
            </div>
            <div className="cls-demo-stat">
              <div className="cls-demo-stat-num">3</div>
              <div className="cls-demo-stat-label">Sample cases to choose from</div>
            </div>
            <div className="cls-demo-stat">
              <div className="cls-demo-stat-num">1</div>
              <div className="cls-demo-stat-label">Branded report in your inbox</div>
            </div>
          </div>
        </section>

        <section className="cls-demo-picker">
          <div className="cls-demo-picker-header">
            <span className="eyebrow">Pick a starting point</span>
            <h2 className="cls-demo-picker-title">
              Three sample inquiries. Or score your own<span className="ts" />
            </h2>
            <p className="cls-demo-picker-sub">
              The three sample cases produce a Band A, Band B, and Band C
              outcome respectively, calibrated to show the Screen&apos;s range.
              Or pick the gold card to walk through with a real inquiry your
              firm received recently.
            </p>
          </div>

          <CasePicker />
        </section>

        <section className="cls-demo-disclaimer">
          <p>
            <strong>Demonstration tool.</strong> The report you receive at the
            end of this flow is a CaseLoad Select Screen <em>sample report</em>,
            marked clearly as such. It is not legal advice, not a real
            screening recommendation for any actual client, and not a
            substitute for the firm&apos;s own intake judgment.
          </p>
        </section>
      </main>

      <style>{`
        .cls-demo-main {
          background: var(--parchment);
          min-height: calc(100vh - 72px);
          padding: var(--sp-9) var(--section-pad-h) var(--sp-10);
        }
        .cls-demo-hero {
          max-width: 760px;
          margin: 0 auto var(--sp-9);
          text-align: center;
        }
        .cls-demo-eyebrow {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: var(--ls-eyebrow-l);
          text-transform: uppercase;
          color: var(--stone-on-light);
          margin-bottom: var(--sp-5);
        }
        .cls-demo-title {
          font-family: var(--font-display);
          font-size: var(--fs-hero);
          font-weight: 800;
          color: var(--navy);
          line-height: 1.05;
          letter-spacing: var(--ls-headline);
          margin: 0 0 var(--sp-5);
        }
        .cls-demo-sub {
          font-size: var(--fs-lead);
          color: var(--text-muted);
          line-height: 1.65;
          margin: 0 auto var(--sp-7);
          max-width: 620px;
        }
        .cls-demo-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--sp-5);
          max-width: 640px;
          margin: 0 auto;
        }
        .cls-demo-stat {
          padding: var(--sp-4) var(--sp-3);
          border-top: 2px solid var(--stone);
        }
        .cls-demo-stat-num {
          font-family: var(--font-display);
          font-size: 36px;
          font-weight: 800;
          color: var(--navy);
          line-height: 1;
          margin-bottom: var(--sp-2);
        }
        .cls-demo-stat-label {
          font-family: var(--font-display);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: var(--text-muted);
          line-height: 1.4;
        }

        .cls-demo-picker {
          max-width: 920px;
          margin: 0 auto var(--sp-9);
        }
        .cls-demo-picker-header {
          text-align: center;
          margin-bottom: var(--sp-7);
        }
        .cls-demo-picker-header :global(.eyebrow) {
          font-family: var(--font-display);
          font-size: var(--fs-eyebrow);
          font-weight: 700;
          letter-spacing: var(--ls-eyebrow);
          text-transform: uppercase;
          color: var(--stone);
          margin-bottom: var(--sp-3);
          display: block;
        }
        .cls-demo-picker-title {
          font-family: var(--font-display);
          font-size: var(--fs-h2);
          font-weight: 800;
          color: var(--navy);
          line-height: 1.1;
          margin: 0 0 var(--sp-4);
        }
        .cls-demo-picker-sub {
          font-size: 14.5px;
          color: var(--text-muted);
          line-height: 1.65;
          max-width: 580px;
          margin: 0 auto;
        }

        .cls-demo-disclaimer {
          max-width: 720px;
          margin: 0 auto;
          padding: var(--sp-5) var(--sp-5);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          background: var(--white);
        }
        .cls-demo-disclaimer p {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.65;
          margin: 0;
        }
        .cls-demo-disclaimer strong {
          color: var(--navy);
          font-weight: 700;
        }
        .cls-demo-disclaimer em {
          font-style: normal;
          color: var(--stone-on-light);
          font-weight: 600;
        }

        @media (max-width: 640px) {
          .cls-demo-main { padding: var(--sp-7) var(--sp-4) var(--sp-9); }
          .cls-demo-stats { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}
