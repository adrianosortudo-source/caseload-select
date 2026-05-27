import Image from "next/image";
import { IconAuthority, IconCapture, IconTarget, IconScreen } from "./ActsIcons";

/**
 * Hero
 *
 * Layered hero composite ported from CaseFlow_Website_v45.html, rebuilt for
 * the four-phase ACTS methodology. Background layers (bg + sweep + noise)
 * and choreographed entrance timing live in marketing.css. This component
 * owns the markup and the brand copy.
 */
export default function Hero() {
  return (
    <section className="hero">
      <div className="hero-bg" />
      <div className="hero-sweep" />
      <div className="hero-noise" />

      <div className="hero-content">
        <div className="hero-eyebrow">Built for Ontario law firms</div>

        <div className="hero-headline-wrap">
          <h1 className="hero-headline">
            Sign Better Cases<span className="ts" />
          </h1>
        </div>

        <p className="hero-sub">
          Most Ontario firms don&apos;t have a lead generation problem. They have a
          lead selection problem. Every case that reaches you arrives ranked.
          You know which ones to activate before you make a single call.
        </p>

        <div className="hero-pillars" aria-label="The ACTS System">
          <div className="pillar-connector" aria-hidden="true">
            <span className="connector-dot" />
            <span className="connector-dot" />
            <span className="connector-dot" />
            <span className="connector-dot" />
          </div>

          <div className="hero-pillar">
            <div className="pillar-icon-wrap"><IconAuthority /></div>
            <div className="pillar-label">Authority</div>
            <div className="pillar-letter">A</div>
          </div>
          <div className="hero-pillar">
            <div className="pillar-icon-wrap"><IconCapture /></div>
            <div className="pillar-label">Capture</div>
            <div className="pillar-letter">C</div>
          </div>
          <div className="hero-pillar">
            <div className="pillar-icon-wrap"><IconTarget /></div>
            <div className="pillar-label">Target</div>
            <div className="pillar-letter">T</div>
          </div>
          <div className="hero-pillar">
            <div className="pillar-icon-wrap"><IconScreen /></div>
            <div className="pillar-label">Screen</div>
            <div className="pillar-letter">S</div>
          </div>
        </div>

        <div className="hero-cta-row">
          <a href="#cta" className="btn-primary">Book a Strategy Call</a>
          <a href="/screen-demo" className="btn-ghost">
            See the Screen at work
            <svg viewBox="0 0 24 24">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
        </div>

        <div className="hero-operator">
          <Image
            src="/marketing/adriano-portrait.jpg"
            alt="Adriano Domingues"
            width={56}
            height={56}
            className="hero-operator-img"
            priority
          />
          <div className="hero-operator-text">
            <span className="hero-operator-name">Adriano Domingues</span>
            <span className="hero-operator-title">Senior Operator · CaseLoad Select</span>
            Fourteen years building marketing infrastructure for regulated industries.
            Latest deployment, DRG Law in Toronto: intake decisions cut to thirty seconds,
            every brief reviewed the day it arrived.
          </div>
        </div>
      </div>

      <div className="scroll-hint" aria-hidden="true">
        <span>Scroll</span>
        <div className="scroll-mouse">
          <div className="scroll-wheel" />
        </div>
      </div>
    </section>
  );
}
