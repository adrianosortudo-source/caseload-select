import type { Metadata } from "next";
import ToolNav from "./_components/ToolNav";
import PublicToolFooter from "../PublicToolFooter";
// The SEO tool components moved out of this frozen marketing tree to
// src/components/seo-check/ so operator-tool work is no longer blocked by the
// website-rebuild freeze. This page (proxied, not rebuilt, per the rebuild
// plan) and /admin/seo-check both consume them from that single home.
import SeoCheckTool from "@/components/seo-check/SeoCheckTool";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Free Law Firm SEO Check · CaseLoad Select",
  description:
    "Review public website signals across up to 25 pages. See affected-page evidence and prioritized next steps. AI-related observations do not grade visibility or predict citations.",
  openGraph: {
    title: "Free Law Firm SEO Check · CaseLoad Select",
    description:
      "Review public website signals across up to 25 pages, with affected-page evidence and prioritized next steps. AI observations do not predict citations.",
    type: "website",
    locale: "en_CA",
  },
};

/**
 * `?embed=1` strips the page down to the tool itself.
 *
 * The marketing site frames this route inline on capture.html and
 * tools.html. Without the flag the embed carries its own ToolNav (a second
 * CaseLoad wordmark plus a "Back to home" link) and the (marketing) layout's
 * full site footer, both stranded mid-page inside a page that already has
 * them. The layout owns the footer and App Router layouts do not receive
 * searchParams, so the page hides it with a scoped rule rather than the
 * layout branching on the flag.
 */
interface PageProps {
  searchParams: Promise<{ embed?: string }>;
}

export default async function SeoCheckPage({ searchParams }: PageProps) {
  const { embed } = await searchParams;
  const isEmbedded = embed === "1";

  return (
    <>
      {!isEmbedded && <ToolNav />}

      <main className="seo-main">
        <section className="seo-hero">
          <div className="seo-hero-eyebrow">Free tool · Multi-page scan · No account</div>
          <h1 className="seo-hero-title">
            Law Firm SEO Check<span className="ts" />
          </h1>
          <p className="seo-hero-sub">
            Review public website signals across up to 25 pages. Findings show affected pages, why they may matter, and general next steps. AI observations are not a visibility grade or citation prediction.
          </p>

          <div className="seo-hero-stats">
            <div className="seo-hero-stat">
              <div className="seo-hero-stat-num">Up to 25</div>
              <div className="seo-hero-stat-label">Pages checked</div>
            </div>
            <div className="seo-hero-stat">
              <div className="seo-hero-stat-num">5</div>
              <div className="seo-hero-stat-label">Score check types</div>
            </div>
            <div className="seo-hero-stat">
              <div className="seo-hero-stat-num">0</div>
              <div className="seo-hero-stat-label">Cost</div>
            </div>
          </div>
        </section>

        <section className="seo-tool-section">
          <SeoCheckTool />
        </section>

        <section className="seo-categories-preview">
          <div className="seo-categories-header">
            <span className="seo-cat-eyebrow">What the scan may observe</span>
            <h2 className="seo-categories-title">
              Areas for review<span className="ts" />
            </h2>
            <p className="seo-categories-intro">
              The v5 score uses five directly observed check types across three of the report’s ten categories: page title, HTTP status, indexability, robots.txt crawl access and HTTPS. Other observations are shown for context and do not add points. If we cannot tell whether a page tells Google not to index it, that check is not scored.
            </p>
          </div>
          <div className="seo-categories-grid">
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">1</div>
              <h3 className="seo-cat-preview-name">On-Page SEO</h3>
              <p className="seo-cat-preview-desc">
                The limited score checks whether an inspected page has a non-empty title. Other on-page observations may help frame a review but do not all add points.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">2</div>
              <h3 className="seo-cat-preview-name">Schema &amp; Structured Data</h3>
              <p className="seo-cat-preview-desc">
                The scan may note structured data it observes. Optional markup is not a score requirement and does not guarantee a search result feature.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">3</div>
              <h3 className="seo-cat-preview-name">AI crawler policy</h3>
              <p className="seo-cat-preview-desc">
                A matching robots.txt rule describes a site setting. It does not prove an AI service accessed the site or will cite a page.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">4</div>
              <h3 className="seo-cat-preview-name">Local SEO</h3>
              <p className="seo-cat-preview-desc">
                The scan may observe public business and contact details on checked pages. It does not inspect firm accounts or measure local search positions.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">5</div>
              <h3 className="seo-cat-preview-name">Technical &amp; Security</h3>
              <p className="seo-cat-preview-desc">
                HTTPS is one of the five scored check types. Other security observations may be shown separately and do not add points.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">6</div>
              <h3 className="seo-cat-preview-name">Performance</h3>
              <p className="seo-cat-preview-desc">
                Performance observations, when available, come from this scan’s own retrieval. They are not real-user Core Web Vitals and do not contribute to the v5 score.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">7</div>
              <h3 className="seo-cat-preview-name">Links &amp; Content</h3>
              <p className="seo-cat-preview-desc">
                Counts and page patterns are observations for context. They do not measure content quality or establish search rankings.
              </p>
            </div>
          </div>
        </section>

        <section className="seo-disclaimer">
          <p>
            <strong>Free diagnostic tool.</strong> This report checks publicly visible signals
            on your website. It does not access analytics, Search Console, or any private data.
            Results are based on a multi-page diagnostic crawl (up to 25 pages) and may not capture every signal on larger sites.
            Built by CaseLoad Select.
          </p>
          {!isEmbedded && (
            <p className="seo-methodology-link-row">
              <a href="https://caseloadselect.ca/tools/seo-check.html#seo-methodology">Read the methodology and limits</a>
            </p>
          )}
        </section>
      </main>

      {!isEmbedded && <PublicToolFooter />}

      <style>{`
        .seo-main {
          background: var(--parchment);
          min-height: calc(100vh - 72px);
          padding: var(--sp-9) var(--section-pad-h) var(--sp-10);
        }
        .seo-hero {
          max-width: 760px;
          margin: 0 auto var(--sp-8);
          text-align: center;
        }
        .seo-hero-eyebrow {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: var(--ls-eyebrow-l);
          text-transform: uppercase;
          color: var(--stone-on-light);
          margin-bottom: var(--sp-5);
        }
        .seo-hero-title {
          width: 100%;
          max-width: none;
          font-family: var(--font-display);
          font-size: var(--fs-hero);
          font-weight: 800;
          color: var(--navy);
          line-height: 1.05;
          letter-spacing: var(--ls-headline);
          margin: 0 0 var(--sp-5);
        }
        .seo-hero-sub {
          width: 100%;
          max-width: none;
          font-size: var(--fs-lead);
          color: var(--text-muted);
          line-height: 1.65;
          margin: 0 auto var(--sp-7);
        }
        .seo-hero-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--sp-5);
          max-width: 480px;
          margin: 0 auto;
        }
        .seo-hero-stat {
          padding: var(--sp-4) var(--sp-3);
          border-top: 2px solid var(--stone);
        }
        .seo-hero-stat-num {
          font-family: var(--font-display);
          font-size: 36px;
          font-weight: 800;
          color: var(--navy);
          line-height: 1;
          margin-bottom: var(--sp-2);
        }
        .seo-hero-stat-label {
          font-family: var(--font-display);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: var(--text-muted);
          line-height: 1.4;
        }

        .seo-tool-section {
          max-width: 860px;
          margin: 0 auto var(--sp-9);
        }

        .seo-categories-preview {
          max-width: 920px;
          margin: 0 auto var(--sp-9);
        }
        .seo-categories-header {
          text-align: center;
          margin-bottom: var(--sp-7);
        }
        .seo-cat-eyebrow {
          font-family: var(--font-display);
          font-size: var(--fs-eyebrow);
          font-weight: 700;
          letter-spacing: var(--ls-eyebrow);
          text-transform: uppercase;
          color: var(--stone);
          margin-bottom: var(--sp-3);
          display: block;
        }
        .seo-categories-title {
          width: 100%;
          max-width: none;
          font-family: var(--font-display);
          font-size: var(--fs-h2);
          font-weight: 800;
          color: var(--navy);
          line-height: 1.1;
          margin: 0;
        }
        .seo-categories-intro {
          color: var(--text-muted);
          font-size: 14px;
          line-height: 1.6;
          margin: var(--sp-3) 0 0;
          text-wrap: pretty;
        }
        .seo-categories-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--sp-5);
        }
        .seo-cat-preview {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          padding: var(--sp-5);
        }
        .seo-cat-icon {
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 800;
          color: var(--white);
          background: var(--navy);
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: var(--sp-4);
        }
        .seo-cat-preview-name {
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 700;
          color: var(--navy);
          margin: 0 0 var(--sp-2);
        }
        .seo-cat-preview-desc {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.6;
          margin: 0;
        }

        .seo-disclaimer {
          max-width: 720px;
          margin: 0 auto;
          padding: var(--sp-5);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          background: var(--white);
        }
        .seo-disclaimer p {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.65;
          margin: 0;
        }
        .seo-disclaimer strong {
          color: var(--navy);
          font-weight: 700;
        }
        .seo-disclaimer .seo-methodology-link-row {
          margin-top: var(--sp-3);
        }
        .seo-disclaimer .seo-methodology-link-row a {
          color: var(--navy);
          font-weight: 700;
          text-underline-offset: 3px;
        }

        @media print {
          /* Print only the diagnostic report, not the marketing page chrome. */
          .seo-nav, .seo-hero, .seo-categories-preview, .seo-disclaimer { display: none !important; }
          .seo-main { padding: 0 !important; background: #fff !important; min-height: 0 !important; }
          .seo-tool-section { margin: 0 !important; max-width: none !important; }
        }
        @media (max-width: 768px) {
          .seo-categories-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .seo-main { padding: var(--sp-7) var(--sp-4) var(--sp-9); }
          .seo-hero-stats { grid-template-columns: 1fr; max-width: 200px; }
        }
      `}</style>

      {isEmbedded && (
        <style>{`
          /* Embedded on the marketing site. The framing page supplies the
             footer and the surrounding narrative, so this route renders the
             tool alone. min-height drops the 100vh-minus-nav reservation,
             which would otherwise force dead space inside a fixed-height
             iframe now that the nav is gone.

             The hero goes too. It is a full viewport of title, sub, and stats
             that the framing section already states in its own words, and
             leaving it in pushes the URL field below the fold of the iframe,
             so the embed reads as a poster rather than a tool. Everything
             below the tool stays, including the disclaimer. */
          .cls-footer { display: none; }
          .seo-main { min-height: 0; }
          .seo-hero { display: none; }
        `}</style>
      )}
    </>
  );
}
