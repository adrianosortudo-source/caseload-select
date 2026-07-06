import type { Metadata } from "next";
import Image from "next/image";
import MarketingNav from "../../components/MarketingNav";

export const metadata: Metadata = {
  title: "DRG Law Case Study | CaseLoad Select",
  description:
    "How a solo Toronto corporate and real estate practice replaced a Wix site and an unqualified booking form with a new brand system, a screened intake path, and a live voice channel in a 90-day pilot.",
};

export default function DRGLawCaseStudyPage() {
  return (
    <>
      <MarketingNav />

      {/* ── Hero ─────────────────────────────────────────── */}
      <header className="cs-hero">
        <div className="cs-hero-inner">
          <div className="cs-eyebrow-row">
            <span className="cs-eyebrow">Case Study</span>
            <span className="cs-eyebrow-sep" aria-hidden="true" />
            <span className="cs-eyebrow">DRG Law Professional Corporation</span>
          </div>
          <h1 className="cs-headline">
            New site, intake filter, and a voice agent in one pilot<span className="cs-ts" />
          </h1>
          <p className="cs-lead">
            DRG Law is a solo corporate and real estate practice in Toronto.
            Damaris Regina Guimaraes called to the Ontario bar in 2024 and
            dual-qualified in Brazil since 2016. The firm had a Wix site, a
            booking form with no qualification, and no intake filter.
            This documents what was built in the first 90 days.
          </p>
          <div className="cs-meta-row">
            <div className="cs-meta-item">
              <span className="cs-meta-label">Pilot start</span>
              <span className="cs-meta-value">May 2026</span>
            </div>
            <div className="cs-meta-item">
              <span className="cs-meta-label">Engagement</span>
              <span className="cs-meta-value">90-day pilot</span>
            </div>
            <div className="cs-meta-item">
              <span className="cs-meta-label">Market</span>
              <span className="cs-meta-value">Toronto · Ontario</span>
            </div>
            <div className="cs-meta-item">
              <span className="cs-meta-label">Practice areas</span>
              <span className="cs-meta-value">Corporate · Real Estate · Wills</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── The Situation ─────────────────────────────────── */}
      <section className="cs-section cs-parchment">
        <div className="cs-inner">
          <div className="cs-section-head">
            <span className="cs-section-eyebrow">Before</span>
            <h2 className="cs-section-title">What the audit found</h2>
            <p className="cs-section-lead">
              A diagnostic ran against the firm&apos;s digital presence before any
              work began. Eight problems were documented.
            </p>
          </div>

          <div className="cs-findings-grid">
            <div className="cs-finding">
              <span className="cs-finding-num">01</span>
              <div>
                <h3 className="cs-finding-title">Employer mismatch on LinkedIn</h3>
                <p className="cs-finding-body">
                  Damaris&apos;s LinkedIn profile listed LexTransact Law, not DRG
                  Law. Every referred prospect who searched her name saw a
                  different firm.
                </p>
              </div>
            </div>
            <div className="cs-finding">
              <span className="cs-finding-num">02</span>
              <div>
                <h3 className="cs-finding-title">GBP linked to the wrong domain</h3>
                <p className="cs-finding-body">
                  The Google Business Profile pointed to drglegalservices.com,
                  not drglaw.ca. Anyone clicking the GBP website link could land
                  on an inactive domain.
                </p>
              </div>
            </div>
            <div className="cs-finding">
              <span className="cs-finding-num">03</span>
              <div>
                <h3 className="cs-finding-title">Phone number missing from GBP</h3>
                <p className="cs-finding-body">
                  No phone number in the Google Business Profile. The
                  &ldquo;Add place&apos;s phone number&rdquo; prompt was visible on the
                  profile page.
                </p>
              </div>
            </div>
            <div className="cs-finding">
              <span className="cs-finding-num">04</span>
              <div>
                <h3 className="cs-finding-title">Invisible on six of eight target queries</h3>
                <p className="cs-finding-body">
                  DRG Law did not appear in any niche, geographic, or
                  practice-area search. Visible only on branded queries. The
                  Brazil-Canada corporate niche had no corporate lawyer in any
                  Google result at all.
                </p>
              </div>
            </div>
            <div className="cs-finding">
              <span className="cs-finding-num">05</span>
              <div>
                <h3 className="cs-finding-title">Three reviews against a 100-plus-review Maps Pack</h3>
                <p className="cs-finding-body">
                  Competitors in the local pack carried 100 to 1,700 reviews.
                  At three reviews, DRG Law was invisible to any client
                  comparing options on Maps.
                </p>
              </div>
            </div>
            <div className="cs-finding">
              <span className="cs-finding-num">06</span>
              <div>
                <h3 className="cs-finding-title">No intake screening</h3>
                <p className="cs-finding-body">
                  A Wix booking form with no qualification. Every inquiry
                  reached Damaris&apos;s calendar directly, regardless of case
                  merit, fit, or practice area.
                </p>
              </div>
            </div>
            <div className="cs-finding">
              <span className="cs-finding-num">07</span>
              <div>
                <h3 className="cs-finding-title">No LinkedIn company page</h3>
                <p className="cs-finding-body">
                  DRG Law Professional Corporation had no company page. The last
                  personal post was nine months earlier, announcing a position at
                  a different firm.
                </p>
              </div>
            </div>
            <div className="cs-finding">
              <span className="cs-finding-num">08</span>
              <div>
                <h3 className="cs-finding-title">Title tag typo on the niche keyword</h3>
                <p className="cs-finding-body">
                  The site&apos;s title tag read &ldquo;Portugues speaking lawyer&rdquo;
                  (missing the e). The one niche keyword the old site was
                  targeting had a spelling error in the metadata.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Before screenshots ───────────────────────────── */}
      <section className="cs-section cs-navy">
        <div className="cs-inner">
          <div className="cs-section-head cs-section-head-light">
            <span className="cs-section-eyebrow cs-eyebrow-light">Before · May 2026</span>
            <h2 className="cs-section-title cs-title-light">The old site</h2>
            <p className="cs-section-lead cs-lead-light">
              Screenshots captured on 2026-05-01, the day before any work
              began. The site ran on Wix.
            </p>
          </div>

          <div className="cs-screenshots-before">
            <figure className="cs-screenshot-fig">
              <div className="cs-screenshot-frame cs-screenshot-mobile">
                <Image
                  src="/portfolio/drg/homepage_before.jpg"
                  alt="DRG Law old Wix homepage, May 2026"
                  width={390}
                  height={844}
                  style={{ width: "100%", height: "auto" }}
                />
              </div>
              <figcaption className="cs-fig-caption">Homepage · May 2026</figcaption>
            </figure>
            <figure className="cs-screenshot-fig">
              <div className="cs-screenshot-frame cs-screenshot-mobile">
                <Image
                  src="/portfolio/drg/booking_before.jpg"
                  alt="DRG Law old Wix booking form with no intake qualification, May 2026"
                  width={390}
                  height={844}
                  style={{ width: "100%", height: "auto" }}
                />
              </div>
              <figcaption className="cs-fig-caption">Booking form · unqualified, May 2026</figcaption>
            </figure>
            <figure className="cs-screenshot-fig">
              <div className="cs-screenshot-frame cs-screenshot-mobile">
                <Image
                  src="/portfolio/drg/practice_before.jpg"
                  alt="DRG Law old practice areas page with generic copy, May 2026"
                  width={390}
                  height={844}
                  style={{ width: "100%", height: "auto" }}
                />
              </div>
              <figcaption className="cs-fig-caption">Practice areas · generic copy, May 2026</figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ── The Build ────────────────────────────────────── */}
      <section className="cs-section cs-parchment">
        <div className="cs-inner">
          <div className="cs-section-head">
            <span className="cs-section-eyebrow">What was built</span>
            <h2 className="cs-section-title">ACTS System · Phase by phase</h2>
            <p className="cs-section-lead">
              The work ran across all four ACTS pillars in parallel. Authority
              work started Day 1. The intake filter went live in Week 2.
            </p>
          </div>

          <div className="cs-timeline">
            <div className="cs-timeline-item">
              <div className="cs-timeline-pillar cs-pillar-a">A</div>
              <div className="cs-timeline-content">
                <h3 className="cs-timeline-title">Authority</h3>
                <ul className="cs-timeline-list">
                  <li>Full brand system built from scratch (DRG Law Brand Book v13, locked)</li>
                  <li>18-page Next.js website replacing the Wix site at drglaw.ca</li>
                  <li>Journal hub with seven practice-area content clusters, SEO-structured</li>
                  <li>Four interactive tools (Business Readiness Score, Closing Clarity Map, LTT calculator, estate check)</li>
                  <li>Four pillar pages and three service-line pages, each following a 14-section or 7-section template</li>
                  <li>ContentStrategy v3 for each pillar: citable stat lead, FAQPage JSON-LD, tool reference, 900-1500 word clusters</li>
                </ul>
              </div>
            </div>

            <div className="cs-timeline-item">
              <div className="cs-timeline-pillar cs-pillar-c">C</div>
              <div className="cs-timeline-content">
                <h3 className="cs-timeline-title">Capture</h3>
                <ul className="cs-timeline-list">
                  <li>GBP claimed and corrected: domain updated to drglaw.ca, phone number added, category confirmed</li>
                  <li>Wave 1 citations submitted: LSO directory, GBP, Bing Places, Apple Business Connect, Canadian Law List, Yellow Pages Canada</li>
                  <li>NAP locked across all surfaces: 647-598-2537 and drglaw.ca everywhere</li>
                  <li>Full schema markup: LegalService JSON-LD on every practice page, FAQPage schema on FAQ sections, BreadcrumbList on inner pages</li>
                  <li>Metadata audit: all title tags corrected, descriptions written to query intent, canonical tags added</li>
                </ul>
              </div>
            </div>

            <div className="cs-timeline-item">
              <div className="cs-timeline-pillar cs-pillar-t">T</div>
              <div className="cs-timeline-content">
                <h3 className="cs-timeline-title">Target</h3>
                <ul className="cs-timeline-list">
                  <li>
                    Google Ads account structure designed for Phase 2{" "}
                    <span className="cs-status-label cs-status-scheduled">
                      Scheduled, pending client budget approval
                    </span>
                  </li>
                  <li>Landing page slots identified per practice area for future campaign targeting</li>
                  <li>Target keyword set built from practice-area query research (29 tracked terms)</li>
                </ul>
              </div>
            </div>

            <div className="cs-timeline-item">
              <div className="cs-timeline-pillar cs-pillar-s">S</div>
              <div className="cs-timeline-content">
                <h3 className="cs-timeline-title">Screen</h3>
                <ul className="cs-timeline-list">
                  <li>CaseLoad Screen widget embedded at the contact route, replacing the Wix booking form</li>
                  <li>AI intake engine: auto-detects 29 practice areas, extracts 21 data points, scores each inquiry on a 0-100 Case Priority Index</li>
                  <li>Lawyer triage portal: Damaris reads each brief, decides Take or Pass from a single screen</li>
                  <li>Voice intake channel: GHL Voice AI agent live at 647-584-0998, post-call transcripts screened and scored by the same engine</li>
                  <li>Seven inbound channels active: web widget, WhatsApp, SMS, Instagram DM, Facebook Messenger, Google Business Profile, and voice</li>
                  <li>Post-OTP matter system: client portal, matter threads, document hub, review automation</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── After screenshots ─────────────────────────────── */}
      <section className="cs-section cs-dark">
        <div className="cs-inner">
          <div className="cs-section-head cs-section-head-light">
            <span className="cs-section-eyebrow cs-eyebrow-light">After · June 2026</span>
            <h2 className="cs-section-title cs-title-light">The new site</h2>
            <p className="cs-section-lead cs-lead-light">
              Screenshots from drglaw.ca captured June 2026. The Wix site is
              gone. The intake Screen is the contact path. See it live at{" "}
              <a href="https://drglaw.ca" className="cs-inline-link" target="_blank" rel="noopener noreferrer">
                drglaw.ca
              </a>.
            </p>
          </div>

          <div className="cs-screenshots-after">
            <figure className="cs-screenshot-fig-wide">
              <div className="cs-screenshot-frame cs-screenshot-desktop">
                <Image
                  src="/portfolio/drg/homepage_after.jpg"
                  alt="DRG Law new branded homepage, June 2026, with ACTS system navigation and CaseLoad Screen intake"
                  width={1440}
                  height={900}
                  style={{ width: "100%", height: "auto" }}
                />
              </div>
              <figcaption className="cs-fig-caption cs-fig-caption-light">
                Homepage · new brand system, June 2026
              </figcaption>
            </figure>

            <div className="cs-screenshots-after-row">
              <figure className="cs-screenshot-fig">
                <div className="cs-screenshot-frame cs-screenshot-desktop">
                  <Image
                    src="/portfolio/drg/contact_after.jpg"
                    alt="DRG Law contact page with embedded CaseLoad Screen intake widget"
                    width={1440}
                    height={900}
                    style={{ width: "100%", height: "auto" }}
                  />
                </div>
                <figcaption className="cs-fig-caption cs-fig-caption-light">
                  Contact · CaseLoad Screen replaces the booking form
                </figcaption>
              </figure>
              <figure className="cs-screenshot-fig">
                <div className="cs-screenshot-frame cs-screenshot-desktop">
                  <Image
                    src="/portfolio/drg/about_after.jpg"
                    alt="DRG Law about page with Damaris biography and credential block"
                    width={1440}
                    height={900}
                    style={{ width: "100%", height: "auto" }}
                  />
                </div>
                <figcaption className="cs-fig-caption cs-fig-caption-light">
                  About · Damaris credential block and positioning
                </figcaption>
              </figure>
              <figure className="cs-screenshot-fig">
                <div className="cs-screenshot-frame cs-screenshot-desktop">
                  <Image
                    src="/portfolio/drg/journal_after.jpg"
                    alt="DRG Law journal hub with practice-area content clusters"
                    width={1440}
                    height={900}
                    style={{ width: "100%", height: "auto" }}
                  />
                </div>
                <figcaption className="cs-fig-caption cs-fig-caption-light">
                  Journal · content hub indexed by practice area
                </figcaption>
              </figure>
            </div>
          </div>
        </div>
      </section>

      {/* ── Results ──────────────────────────────────────── */}
      <section className="cs-section cs-parchment">
        <div className="cs-inner">
          <div className="cs-section-head">
            <span className="cs-section-eyebrow">Results</span>
            <h2 className="cs-section-title">Pilot in progress</h2>
          </div>

          <div className="cs-results-block">
            <p className="cs-results-note">
              The engagement started May 2026. Search authority, citation
              signals, and intake volume compound over 90 to 180 days. This
              page will be updated with ranked positions, screened inquiry
              counts, and signed case data when the pilot closes in August 2026.
            </p>
            <div className="cs-results-grid">
              <div className="cs-result-card">
                <span className="cs-result-num">8</span>
                <span className="cs-result-label">Diagnostic findings fixed before launch</span>
              </div>
              <div className="cs-result-card">
                <span className="cs-result-num">29</span>
                <span className="cs-result-label">Practice-area matter types in the intake engine</span>
              </div>
              <div className="cs-result-card">
                <span className="cs-result-num">7</span>
                <span className="cs-result-label">Inbound channels live (web, voice, WhatsApp, Instagram, Messenger, SMS, GBP)</span>
              </div>
              <div className="cs-result-card">
                <span className="cs-result-num">18</span>
                <span className="cs-result-label">Public routes on the new site (replacing the 1-page Wix template)</span>
              </div>
            </div>
            <p className="cs-results-update">Results update expected August 2026.</p>
          </div>
        </div>
      </section>

      {/* ── CTA strip ────────────────────────────────────── */}
      <section className="cs-cta">
        <div className="cs-cta-inner">
          <p className="cs-cta-label">Your firm&apos;s pilot</p>
          <h2 className="cs-cta-headline">
            A 30-minute call. We walk through your intake and decide
            if CaseLoad Select fits<span className="cs-ts" />
          </h2>
          <div className="cs-cta-actions">
            <a
              href="/next-steps"
              className="cs-btn-primary"
            >
              Book a Strategy Call
            </a>
            <a href="/screen-demo" className="cs-btn-ghost">Try the Screen first</a>
          </div>
        </div>
      </section>

      <style jsx>{`
        /* ── Tokens ──────────────────────────────────────── */
        .cs-ts {
          display: inline-block;
          width: 0.22em;
          height: 0.22em;
          background: #C4B49A;
          margin-left: 4px;
          vertical-align: middle;
          position: relative;
          top: -2px;
        }

        /* ── Hero ────────────────────────────────────────── */
        .cs-hero {
          background: #1E2F58;
          padding: 140px 60px 80px;
          position: relative;
          overflow: hidden;
        }
        .cs-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at 30% 50%, rgba(196,180,154,0.06) 0%, transparent 65%);
          pointer-events: none;
        }
        .cs-hero-inner {
          max-width: 860px;
          margin: 0 auto;
          position: relative;
        }
        .cs-eyebrow-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 28px;
        }
        .cs-eyebrow {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #C4B49A;
        }
        .cs-eyebrow-sep {
          display: inline-block;
          width: 4px;
          height: 4px;
          background: rgba(196,180,154,0.5);
          border-radius: 50%;
        }
        .cs-headline {
          font-family: var(--font-body, 'Manrope', sans-serif);
          font-size: clamp(32px, 4vw, 52px);
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.1;
          margin-bottom: 28px;
          letter-spacing: -0.5px;
        }
        .cs-lead {
          font-size: 18px;
          color: rgba(255,255,255,0.72);
          line-height: 1.75;
          margin-bottom: 40px;
          max-width: 700px;
        }
        .cs-meta-row {
          display: flex;
          gap: 40px;
          flex-wrap: wrap;
          border-top: 1px solid rgba(196,180,154,0.2);
          padding-top: 28px;
        }
        .cs-meta-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cs-meta-label {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          color: rgba(196,180,154,0.6);
        }
        .cs-meta-value {
          font-size: 14px;
          font-weight: 600;
          color: rgba(255,255,255,0.85);
        }

        /* ── Section scaffolding ─────────────────────────── */
        .cs-section { padding: 96px 60px; }
        .cs-parchment { background: #F4F3EF; }
        .cs-navy { background: #1E2F58; }
        .cs-dark { background: #0D1520; }

        .cs-inner { max-width: 1100px; margin: 0 auto; }

        .cs-section-head { margin-bottom: 56px; }
        .cs-section-eyebrow {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #C4B49A;
          display: block;
          margin-bottom: 12px;
        }
        .cs-eyebrow-light { color: rgba(196,180,154,0.8); }
        .cs-section-title {
          font-family: var(--font-body, 'Manrope', sans-serif);
          font-size: clamp(26px, 3vw, 38px);
          font-weight: 800;
          color: #1E2F58;
          line-height: 1.2;
          margin-bottom: 16px;
        }
        .cs-title-light { color: #FFFFFF; }
        .cs-section-lead {
          font-size: 17px;
          color: #5A6470;
          line-height: 1.75;
          max-width: 680px;
        }
        .cs-lead-light { color: rgba(255,255,255,0.65); }
        .cs-inline-link {
          color: #C4B49A;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .cs-inline-link:hover { color: #D8CAAE; }

        /* ── Before findings ─────────────────────────────── */
        .cs-findings-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }
        .cs-finding {
          display: flex;
          gap: 20px;
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(196,180,154,0.35);
          border-radius: 4px;
          padding: 28px 24px;
        }
        .cs-finding-num {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 11px;
          font-weight: 700;
          color: #C4B49A;
          min-width: 28px;
          padding-top: 2px;
        }
        .cs-finding-title {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 14px;
          font-weight: 800;
          color: #1E2F58;
          margin-bottom: 8px;
          line-height: 1.3;
        }
        .cs-finding-body {
          font-size: 14px;
          color: #5A6470;
          line-height: 1.7;
        }

        /* ── Before screenshots ──────────────────────────── */
        .cs-screenshots-before {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
          max-width: 700px;
          margin: 0 auto;
        }
        .cs-screenshot-frame {
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }
        .cs-screenshot-mobile { max-width: 220px; margin: 0 auto; }
        .cs-screenshot-desktop { width: 100%; }
        .cs-screenshot-fig { display: flex; flex-direction: column; gap: 10px; }
        .cs-screenshot-fig-wide { margin-bottom: 20px; }
        .cs-fig-caption {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: rgba(255,255,255,0.45);
          text-align: center;
        }
        .cs-fig-caption-light { color: rgba(255,255,255,0.45); }

        /* ── ACTS timeline ───────────────────────────────── */
        .cs-timeline {
          display: flex;
          flex-direction: column;
          gap: 0;
          border-left: 2px solid rgba(196,180,154,0.3);
          padding-left: 0;
          margin-left: 20px;
        }
        .cs-timeline-item {
          display: flex;
          gap: 32px;
          padding: 0 0 48px 40px;
          position: relative;
        }
        .cs-timeline-item:last-child { padding-bottom: 0; }
        .cs-timeline-pillar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 16px;
          font-weight: 800;
          flex-shrink: 0;
          margin-top: -2px;
          margin-left: -61px;
          position: relative;
          z-index: 1;
        }
        .cs-pillar-a { background: #1E2F58; color: #FFFFFF; }
        .cs-pillar-c { background: #C4B49A; color: #0D1520; }
        .cs-pillar-t { background: #0D1520; color: #FFFFFF; }
        .cs-pillar-s { background: #2E4A7A; color: #FFFFFF; }
        .cs-timeline-content { flex: 1; padding-top: 6px; }
        .cs-timeline-title {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 18px;
          font-weight: 800;
          color: #1E2F58;
          margin-bottom: 14px;
        }
        .cs-timeline-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cs-timeline-list li {
          font-size: 15px;
          color: #4A5568;
          line-height: 1.65;
          padding-left: 18px;
          position: relative;
        }
        .cs-timeline-list li::before {
          content: '';
          position: absolute;
          left: 0;
          top: 9px;
          width: 5px;
          height: 5px;
          background: #C4B49A;
          border-radius: 50%;
        }
        .cs-status-label {
          display: inline-block;
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 3px;
          vertical-align: middle;
          margin-left: 2px;
        }
        .cs-status-scheduled {
          color: #8A6D1F;
          background: rgba(196,180,154,0.28);
          border: 1px solid rgba(196,180,154,0.5);
        }

        /* ── After screenshots ───────────────────────────── */
        .cs-screenshots-after-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }

        /* ── Results ─────────────────────────────────────── */
        .cs-results-block { max-width: 900px; }
        .cs-results-note {
          font-size: 17px;
          color: #4A5568;
          line-height: 1.75;
          margin-bottom: 40px;
          padding: 24px 28px;
          background: rgba(196,180,154,0.12);
          border: 1px solid #C4B49A;
          border-radius: 4px;
        }
        .cs-results-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
          margin-bottom: 28px;
        }
        .cs-result-card {
          background: rgba(255,255,255,0.8);
          border: 1px solid rgba(196,180,154,0.35);
          border-radius: 4px;
          padding: 28px 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cs-result-num {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 44px;
          font-weight: 800;
          color: #1E2F58;
          line-height: 1;
        }
        .cs-result-label {
          font-size: 13px;
          color: #5A6470;
          line-height: 1.5;
        }
        .cs-results-update {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: #C4B49A;
        }

        /* ── CTA strip ───────────────────────────────────── */
        .cs-cta {
          background: #1E2F58;
          padding: 96px 60px;
          text-align: center;
        }
        .cs-cta-inner { max-width: 680px; margin: 0 auto; }
        .cs-cta-label {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: rgba(196,180,154,0.6);
          margin-bottom: 20px;
        }
        .cs-cta-headline {
          font-family: var(--font-body, 'Manrope', sans-serif);
          font-size: clamp(24px, 3vw, 36px);
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.2;
          margin-bottom: 40px;
        }
        .cs-cta-actions {
          display: flex;
          gap: 16px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .cs-btn-primary {
          font-family: var(--font-body, 'Manrope', sans-serif);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #0D1520;
          background: #C4B49A;
          padding: 14px 32px;
          border-radius: 3px;
          text-decoration: none;
          transition: background 0.2s, transform 0.2s;
          display: inline-block;
        }
        .cs-btn-primary:hover { background: #D8CAAE; transform: translateY(-1px); }
        .cs-btn-ghost {
          font-family: var(--font-body, 'Manrope', sans-serif);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: rgba(255,255,255,0.7);
          border: 1px solid rgba(255,255,255,0.25);
          padding: 14px 32px;
          border-radius: 3px;
          text-decoration: none;
          transition: border-color 0.2s, color 0.2s;
          display: inline-block;
        }
        .cs-btn-ghost:hover { border-color: rgba(255,255,255,0.5); color: #FFFFFF; }

        /* ── Mobile ──────────────────────────────────────── */
        @media (max-width: 900px) {
          .cs-hero { padding: 120px 24px 60px; }
          .cs-section { padding: 64px 24px; }
          .cs-cta { padding: 64px 24px; }
          .cs-findings-grid { grid-template-columns: 1fr; }
          .cs-results-grid { grid-template-columns: repeat(2, 1fr); }
          .cs-screenshots-before { max-width: 100%; }
          .cs-screenshots-after-row { grid-template-columns: 1fr; }
          .cs-meta-row { gap: 20px; }
          .cs-timeline { margin-left: 10px; }
          .cs-timeline-item { padding-left: 28px; gap: 20px; }
          .cs-timeline-pillar { margin-left: -49px; width: 36px; height: 36px; font-size: 13px; }
        }
        @media (max-width: 600px) {
          .cs-results-grid { grid-template-columns: 1fr; }
          .cs-screenshots-before { grid-template-columns: 1fr; }
          .cs-cta-actions { flex-direction: column; align-items: center; }
        }
      `}</style>
    </>
  );
}
