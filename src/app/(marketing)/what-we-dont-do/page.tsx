"use client";

import MarketingNav from "../components/MarketingNav";

/**
 * What CaseLoad Select Doesn't Do
 *
 * Positioning article at /what-we-dont-do.
 * Sage register: name the pattern, name its cost, name what replaces it.
 * No hyperbole. Evidence-led. Every paragraph advances one idea.
 *
 * Copy is verbatim from operator brief (2026-05-28).
 * Layout: article hero (navy) + single-column prose (parchment) + CTA strip.
 */
export default function WhatWeDontDoPage() {
  return (
    <>
      <MarketingNav />

      {/* ── Article Hero ─────────────────────────────────────────────── */}
      <header className="wwd-hero">
        <div className="wwd-hero-inner">
          <div className="wwd-eyebrow-row">
            <span className="wwd-eyebrow">Scope</span>
          </div>
          <h1 className="wwd-headline">
            What CaseLoad Select doesn&apos;t do<span className="wwd-ts" />
          </h1>
          <p className="wwd-lead">
            Every system has a shape. The shape of this one is case selection.
            Anything that pulls energy away from that, or that another operator
            does better, stays out of scope.
          </p>
        </div>
      </header>

      {/* ── Article Body ─────────────────────────────────────────────── */}
      <main className="wwd-body">
        <article className="wwd-article">

          {/* ── Topic: Organic social ─────────────────────────────────── */}
          <h2 className="wwd-h2">Organic social media production</h2>

          <p className="wwd-p">
            The audience that follows a law firm on Instagram or LinkedIn is not
            in the market for legal services the day they see the post. They
            might be in six months. They might never be. Organic social earns
            attention from people who are not yet buyers, then attempts to
            maintain that attention over a long enough period that some of those
            people eventually become buyers. The conversion timeline is measured
            in years. The effort is continuous. The return per hour of marketing
            time invested is among the lowest of any channel available to a
            Toronto firm.
          </p>

          <p className="wwd-p">
            Organic reach on most platforms has collapsed. A post from a law
            firm business page without paid promotion reaches roughly 2 to 5
            percent of followers organically. The 95 percent that does not see
            the post requires a paid boost to reach, at which point the
            distinction between organic and paid social dissolves. The firm pays
            either way. Organic social is not free distribution. It is unpaid
            labour producing content for a platform that will throttle its
            distribution unless money is added.
          </p>

          <p className="wwd-p">
            Geographic dispersion is the third problem. A post on a public feed
            is visible globally. A Toronto immigration firm&apos;s content may be
            consumed by users in Vancouver, the United Kingdom, and the
            Philippines who have no practical path to becoming clients. LSO
            provincial licensing means the vast majority of that attention is
            legally unreachable as a client population. Attention from people
            who cannot hire the firm is waste.
          </p>

          <p className="wwd-p">
            The fourth problem is compliance transfer. LSO Rule 4.2-1 governs
            every statement a lawyer makes in a public communication. A social
            post about a court outcome, a case result, or a client experience
            requires care that most social media content workflows are not
            designed to provide. The faster the content production cycle, the
            higher the compliance risk per post. When an operator runs the
            content production, the compliance risk transfers to the operator.
            CaseLoad Select is not a compliance risk vehicle.
          </p>

          <p className="wwd-p">
            The best organic content a lawyer can produce is the lawyer&apos;s own
            voice. A practitioner who has something to say about a change in
            immigration policy, a procedural development in employment law, or a
            pattern they are seeing in client intake will generate content that
            no operator can replicate. That content belongs to the lawyer, not
            to a retainer scope. If a lawyer wants to build an organic social
            presence, the operator should stay out of the way.
          </p>

          {/* ── What we recommend instead ─────────────────────────────── */}
          <div className="wwd-recommend">
            <span className="wwd-recommend-label">What we recommend instead</span>
            <p className="wwd-p wwd-p-recommend">
              There are three paths that deliver more return per marketing dollar
              than organic social for a sole practitioner or two-lawyer firm.
              First, a junior writer hired in-house or on contract to maintain
              the Google Business Profile, respond to reviews, and keep the
              website content current. Second, a specialist contractor on a
              narrow brief, typically under C$1,500 per month, who handles one
              channel well rather than spreading across five channels poorly.
              Third, a pure paid acquisition model where budget goes entirely to
              Google Ads targeting in-market buyers with active legal intent, and
              organic is left to the lawyer&apos;s own discretion.
            </p>
            <p className="wwd-p wwd-p-recommend">
              The Screen qualifies cases before the lawyer sees them. That is the
              constraint on case volume worth solving. Adding organic social
              production to an intake problem is solving the wrong constraint.
            </p>
          </div>

          {/* ── Closing display line ──────────────────────────────────── */}
          <p className="wwd-closing">
            The signed cases come from the Screen. Every inbound matter is read,
            scored, and routed to the lawyer&apos;s desk. The feed is a vitrine. The
            Screen is the front door.
          </p>

        </article>
      </main>

      {/* ── CTA Strip ────────────────────────────────────────────────── */}
      <section className="wwd-cta">
        <div className="wwd-cta-inner">
          <p className="wwd-cta-label">See the Screen at work</p>
          <h2 className="wwd-cta-headline">
            Run a sample case through the qualifier<span className="wwd-ts wwd-ts-white" />
          </h2>
          <div className="wwd-cta-actions">
            <a href="/screen-demo" className="wwd-btn-primary">Try the Screen</a>
            <a href="/home#cta" className="wwd-btn-ghost">Book a Strategy Call</a>
          </div>
        </div>
      </section>

      <style jsx>{`
        /* ── Tokens (local to this page) ────────────────────────────── */
        :root {
          --wwd-navy: #1E2F58;
          --wwd-gold: #C4B49A;
          --wwd-parchment: #F4F3EF;
          --wwd-text: #2C3E55;
          --wwd-text-muted: #5A6A7A;
        }

        /* ── Hero ────────────────────────────────────────────────────── */
        .wwd-hero {
          background: var(--wwd-navy, #1E2F58);
          padding: 140px 60px 96px;
          position: relative;
          overflow: hidden;
        }
        .wwd-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 70% 60% at 50% 0%, rgba(196,180,154,0.08) 0%, transparent 65%),
            radial-gradient(ellipse 40% 40% at 10% 100%, rgba(196,180,154,0.04) 0%, transparent 55%);
          pointer-events: none;
        }
        .wwd-hero-inner {
          max-width: 760px;
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }
        .wwd-eyebrow-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }
        .wwd-eyebrow-row::before {
          content: '';
          width: 28px;
          height: 2px;
          background: #C4B49A;
          flex-shrink: 0;
        }
        .wwd-eyebrow {
          font-family: 'Oxanium', sans-serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: #C4B49A;
        }
        .wwd-headline {
          font-family: 'Manrope', sans-serif;
          font-size: clamp(36px, 5vw, 58px);
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.08;
          letter-spacing: -0.5px;
          margin: 0 0 28px;
        }
        .wwd-ts {
          display: inline-block;
          width: 0.22em;
          height: 0.22em;
          background: #C4B49A;
          margin-left: 0.12em;
          vertical-align: top;
          position: relative;
          top: 0.08em;
        }
        .wwd-ts-white {
          background: rgba(237, 234, 217, 0.6);
        }
        .wwd-lead {
          font-family: 'Manrope', sans-serif;
          font-size: 19px;
          font-weight: 400;
          color: rgba(237, 234, 217, 0.72);
          line-height: 1.65;
          max-width: 660px;
          margin: 0;
        }

        /* ── Body ────────────────────────────────────────────────────── */
        .wwd-body {
          background: #F4F3EF;
          padding: 80px 60px 96px;
        }
        .wwd-article {
          max-width: 680px;
          margin: 0 auto;
        }

        .wwd-h2 {
          font-family: 'Manrope', sans-serif;
          font-size: 28px;
          font-weight: 800;
          color: #1E2F58;
          line-height: 1.2;
          margin: 0 0 28px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(196, 180, 154, 0.4);
        }

        .wwd-p {
          font-family: 'Manrope', sans-serif;
          font-size: 17px;
          font-weight: 400;
          color: #3A4A5C;
          line-height: 1.75;
          margin: 0 0 22px;
        }

        /* ── Recommend block ─────────────────────────────────────────── */
        .wwd-recommend {
          margin: 48px 0 48px;
          padding: 32px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid #C4B49A;
          border-radius: 4px;
        }
        .wwd-recommend-label {
          font-family: 'Oxanium', sans-serif;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: #9E9070;
          display: block;
          margin-bottom: 16px;
        }
        .wwd-p-recommend {
          color: #4A5A6A;
          font-size: 16px;
        }
        .wwd-p-recommend:last-child {
          margin-bottom: 0;
        }

        /* ── Closing display line ────────────────────────────────────── */
        .wwd-closing {
          font-family: 'Manrope', sans-serif;
          font-size: 22px;
          font-weight: 700;
          color: #1E2F58;
          line-height: 1.45;
          margin: 0;
          padding-top: 48px;
          border-top: 1px solid rgba(196, 180, 154, 0.35);
        }

        /* ── CTA Strip ───────────────────────────────────────────────── */
        .wwd-cta {
          background: #1E2F58;
          padding: 80px 60px;
          position: relative;
          overflow: hidden;
        }
        .wwd-cta::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 70% 60% at 50% 0%, rgba(196,180,154,0.08) 0%, transparent 65%);
          pointer-events: none;
        }
        .wwd-cta-inner {
          max-width: 680px;
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }
        .wwd-cta-label {
          font-family: 'Oxanium', sans-serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: #C4B49A;
          margin: 0 0 16px;
        }
        .wwd-cta-headline {
          font-family: 'Manrope', sans-serif;
          font-size: clamp(26px, 3.5vw, 38px);
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.15;
          margin: 0 0 36px;
        }
        .wwd-cta-actions {
          display: flex;
          gap: 16px;
          align-items: center;
          flex-wrap: wrap;
        }

        .wwd-btn-primary {
          font-family: 'Manrope', sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: #0D1520;
          background: #C4B49A;
          padding: 15px 34px;
          border-radius: 3px;
          text-decoration: none;
          display: inline-block;
          transition: background 0.2s, transform 0.2s;
        }
        .wwd-btn-primary:hover {
          background: #D8CAAE;
          transform: translateY(-1px);
        }

        .wwd-btn-ghost {
          font-family: 'Manrope', sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.3px;
          color: rgba(237, 234, 217, 0.65);
          text-decoration: none;
          display: inline-block;
          transition: color 0.2s;
        }
        .wwd-btn-ghost:hover {
          color: #FFFFFF;
        }

        /* ── Responsive ──────────────────────────────────────────────── */
        @media (max-width: 768px) {
          .wwd-hero { padding: 120px 24px 72px; }
          .wwd-body { padding: 56px 24px 72px; }
          .wwd-cta  { padding: 64px 24px; }
          .wwd-h2   { font-size: 24px; }
          .wwd-p    { font-size: 16px; }
          .wwd-closing { font-size: 19px; }
          .wwd-recommend { padding: 24px 20px 24px 24px; }
        }
      `}</style>
    </>
  );
}
