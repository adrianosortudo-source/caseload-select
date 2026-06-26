"use client";

import Image from "next/image";

/**
 * CaseStudyTeaser
 *
 * Single card linking to /case-studies/drg-law. Positioned between
 * ClientResultSection and WhySection on the homepage. Dark background,
 * before/after image split, stat row, and read link.
 */
export default function CaseStudyTeaser() {
  return (
    <section className="cst-section">
      <div className="cst-inner">
        <div className="cst-chapter-mark">
          <span className="cst-eyebrow">In the field</span>
        </div>
        <h2 className="cst-headline reveal">
          One firm. 90 days. Everything in scope<span className="ts" />
        </h2>
        <p className="cst-sub reveal">
          DRG Law started with a Wix site, an unqualified booking form, and
          zero intake screening. This documents what was built.
        </p>

        <a href="/case-studies/drg-law" className="cst-card reveal">
          <div className="cst-card-images">
            <div className="cst-img-before">
              <Image
                src="/portfolio/drg/homepage_before.jpg"
                alt="DRG Law old Wix site before CaseLoad Select, May 2026"
                width={390}
                height={540}
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              />
              <span className="cst-badge">Before · May 2026</span>
            </div>
            <div className="cst-img-after">
              <Image
                src="/portfolio/drg/homepage_after.jpg"
                alt="DRG Law new branded site after CaseLoad Select, June 2026"
                width={1440}
                height={900}
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              />
              <span className="cst-badge cst-badge-after">After · June 2026</span>
            </div>
          </div>
          <div className="cst-card-body">
            <div className="cst-card-firm">
              <span className="cst-firm-label">DRG Law Professional Corporation</span>
              <span className="cst-firm-meta">Solo practice · Toronto · Corporate &amp; Real Estate</span>
            </div>
            <div className="cst-card-pillars">
              <span className="cst-pillar">Authority</span>
              <span className="cst-pillar">Capture</span>
              <span className="cst-pillar">Screen</span>
            </div>
            <div className="cst-card-stats">
              <div className="cst-stat">
                <span className="cst-stat-n">8</span>
                <span className="cst-stat-l">diagnostic fixes before launch</span>
              </div>
              <div className="cst-stat">
                <span className="cst-stat-n">7</span>
                <span className="cst-stat-l">intake channels live</span>
              </div>
              <div className="cst-stat">
                <span className="cst-stat-n">18</span>
                <span className="cst-stat-l">public routes replacing the Wix template</span>
              </div>
            </div>
            <span className="cst-read-link">Read the case study →</span>
          </div>
        </a>
      </div>

      <style jsx>{`
        .cst-section {
          background: #0D1520;
          padding: 96px 60px;
        }
        .cst-inner {
          max-width: 1100px;
          margin: 0 auto;
        }
        .cst-chapter-mark {
          margin-bottom: 20px;
        }
        .cst-eyebrow {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #C4B49A;
          display: inline-block;
        }
        .cst-headline {
          font-family: var(--font-body, 'Manrope', sans-serif);
          font-size: clamp(28px, 3vw, 42px);
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.15;
          margin-bottom: 20px;
        }
        .cst-sub {
          font-size: 17px;
          color: rgba(255,255,255,0.6);
          line-height: 1.7;
          margin-bottom: 52px;
          max-width: 560px;
        }

        .cst-card {
          display: grid;
          grid-template-columns: 480px 1fr;
          background: #1A2540;
          border: 1px solid rgba(196,180,154,0.15);
          border-radius: 6px;
          overflow: hidden;
          text-decoration: none;
          transition: border-color 0.3s, box-shadow 0.3s, transform 0.3s;
        }
        .cst-card:hover {
          border-color: rgba(196,180,154,0.4);
          box-shadow: 0 24px 60px rgba(0,0,0,0.5);
          transform: translateY(-3px);
        }

        .cst-card-images {
          display: grid;
          grid-template-columns: 1fr 1fr;
          height: 340px;
          overflow: hidden;
        }
        .cst-img-before,
        .cst-img-after {
          position: relative;
          overflow: hidden;
        }
        .cst-img-before { border-right: 1px solid rgba(196,180,154,0.12); }
        .cst-badge {
          position: absolute;
          bottom: 10px;
          left: 10px;
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: rgba(255,255,255,0.85);
          background: rgba(0,0,0,0.55);
          backdrop-filter: blur(4px);
          padding: 4px 8px;
          border-radius: 2px;
        }
        .cst-badge-after {
          background: rgba(196,180,154,0.25);
          color: #C4B49A;
        }

        .cst-card-body {
          padding: 36px 36px 32px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .cst-card-firm {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cst-firm-label {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 15px;
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.3;
        }
        .cst-firm-meta {
          font-size: 12px;
          color: rgba(255,255,255,0.45);
        }

        .cst-card-pillars {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .cst-pillar {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: #C4B49A;
          border: 1px solid rgba(196,180,154,0.3);
          padding: 4px 10px;
          border-radius: 20px;
        }

        .cst-card-stats {
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
        }
        .cst-stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .cst-stat-n {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 32px;
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1;
        }
        .cst-stat-l {
          font-size: 11px;
          color: rgba(255,255,255,0.45);
          line-height: 1.4;
          max-width: 100px;
        }

        .cst-read-link {
          font-family: var(--font-display, 'Oxanium', sans-serif);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: #C4B49A;
          margin-top: auto;
        }

        @media (max-width: 960px) {
          .cst-section { padding: 64px 24px; }
          .cst-card { grid-template-columns: 1fr; }
          .cst-card-images { height: 220px; grid-template-columns: 1fr 1fr; }
          .cst-card-body { padding: 24px; }
          .cst-card-stats { gap: 16px; }
          .cst-stat-n { font-size: 24px; }
        }
        @media (max-width: 600px) {
          .cst-card-images { height: 160px; }
          .cst-card-stats { flex-direction: column; gap: 12px; }
        }
      `}</style>
    </section>
  );
}
