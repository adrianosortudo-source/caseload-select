import type { Metadata } from "next";
import ToolNav from "./_components/ToolNav";
import SeoCheckTool from "./_components/SeoCheckTool";

export const metadata: Metadata = {
  title: "Free SEO & AI Visibility Check · CaseLoad Select",
  description:
    "Run a multi-page diagnostic of your law firm's SEO health and AI search visibility. 49 signals per page across 7 categories including AI bot access, schema markup, performance, and security. Free, no account required.",
  openGraph: {
    title: "Free SEO & AI Visibility Check · CaseLoad Select",
    description:
      "Run a multi-page diagnostic of your law firm's SEO health and AI search visibility. Free, no account required.",
    type: "website",
    locale: "en_CA",
  },
};

export default function SeoCheckPage() {
  return (
    <>
      <ToolNav />

      <main className="seo-main">
        <section className="seo-hero">
          <div className="seo-hero-eyebrow">Free tool · Multi-page scan · No account</div>
          <h1 className="seo-hero-title">
            SEO &amp; AI Visibility Check<span className="ts" />
          </h1>
          <p className="seo-hero-sub">
            Most law firm websites are invisible to AI search. Google&apos;s AI Overviews,
            ChatGPT, and Perplexity now answer legal questions directly, citing the firms
            with the strongest signals. This tool checks 49 of those signals across SEO health
            and AI search readiness, then scores your site on what actually drives visibility today.
          </p>

          <div className="seo-hero-stats">
            <div className="seo-hero-stat">
              <div className="seo-hero-stat-num">49</div>
              <div className="seo-hero-stat-label">Signals checked</div>
            </div>
            <div className="seo-hero-stat">
              <div className="seo-hero-stat-num">7</div>
              <div className="seo-hero-stat-label">Categories scored</div>
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
            <span className="seo-cat-eyebrow">What we check</span>
            <h2 className="seo-categories-title">
              Seven categories that determine your visibility<span className="ts" />
            </h2>
          </div>
          <div className="seo-categories-grid">
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">1</div>
              <h3 className="seo-cat-preview-name">On-Page SEO</h3>
              <p className="seo-cat-preview-desc">
                Title tags, meta descriptions, heading structure, canonical URLs, Open Graph
                tags, image alt text. The basics that most firms get wrong.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">2</div>
              <h3 className="seo-cat-preview-name">Schema &amp; Structured Data</h3>
              <p className="seo-cat-preview-desc">
                LocalBusiness, Attorney, FAQPage, Review, and Breadcrumb structured data.
                The machine-readable layer Google uses for rich results.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">3</div>
              <h3 className="seo-cat-preview-name">AI Visibility</h3>
              <p className="seo-cat-preview-desc">
                AI search bot access, training bot control, llms.txt, question headings,
                direct-answer patterns, author attribution, entity signals. Whether AI models
                can find and cite your content.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">4</div>
              <h3 className="seo-cat-preview-name">Local SEO</h3>
              <p className="seo-cat-preview-desc">
                NAP visibility, Google Maps, GBP cross-linking, structured location data.
                The signals that put your firm on the map for local searches.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">5</div>
              <h3 className="seo-cat-preview-name">Technical &amp; Security</h3>
              <p className="seo-cat-preview-desc">
                HTTPS, HSTS, CSP, mixed content, viewport, compression, robots directives.
                The foundation that determines whether search engines can crawl and trust your site.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">6</div>
              <h3 className="seo-cat-preview-name">Performance</h3>
              <p className="seo-cat-preview-desc">
                Time to first byte, document size, render-blocking resources, image dimensions,
                resource hints, third-party script load. Speed signals that affect ranking and experience.
              </p>
            </div>
            <div className="seo-cat-preview">
              <div className="seo-cat-icon">7</div>
              <h3 className="seo-cat-preview-name">Links &amp; Content</h3>
              <p className="seo-cat-preview-desc">
                Word count, heading hierarchy, internal links, content-to-HTML ratio,
                anchor text quality, external links. The content structure that search engines evaluate.
              </p>
            </div>
          </div>
        </section>

        <section className="seo-disclaimer">
          <p>
            <strong>Free diagnostic tool.</strong> This report checks publicly visible signals
            on your website. It does not access analytics, Search Console, or any private data.
            Results are based on a multi-page diagnostic scan (up to 5 pages) and may not capture every signal on larger sites.
            Built by CaseLoad Select.
          </p>
        </section>
      </main>

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
          font-family: var(--font-display);
          font-size: var(--fs-hero);
          font-weight: 800;
          color: var(--navy);
          line-height: 1.05;
          letter-spacing: var(--ls-headline);
          margin: 0 0 var(--sp-5);
        }
        .seo-hero-sub {
          font-size: var(--fs-lead);
          color: var(--text-muted);
          line-height: 1.65;
          margin: 0 auto var(--sp-7);
          max-width: 640px;
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
          font-family: var(--font-display);
          font-size: var(--fs-h2);
          font-weight: 800;
          color: var(--navy);
          line-height: 1.1;
          margin: 0;
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
    </>
  );
}
