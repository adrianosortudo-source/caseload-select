import type { Metadata } from "next";
import ToolNav from "./_components/ToolNav";
import WebsiteDesignCheckTool from "@/components/website-design-check/WebsiteDesignCheckTool";

export const metadata: Metadata = {
  title: "Free Website Design & Conversion Check · CaseLoad Select",
  description:
    "See how your law firm's website scores on typography, contrast, forms, mobile usability, and authority signals, plus a ranked list of specific fixes. Free, no account required.",
  openGraph: {
    title: "Free Website Design & Conversion Check · CaseLoad Select",
    description: "See how your law firm's website scores on design and conversion craft, plus a ranked list of specific fixes. Free, no account required.",
    type: "website",
    locale: "en_CA",
  },
};

export default function WebsiteDesignCheckPage() {
  return (
    <>
      <ToolNav />

      <main className="dc-main">
        <section className="dc-hero">
          <div className="dc-hero-eyebrow">Free tool · Real browser render · No account</div>
          <h1 className="dc-hero-title">
            Website Design &amp; Conversion Check<span className="ts" />
          </h1>
          <p className="dc-hero-sub">
            A visitor decides whether your firm looks credible within seconds, before reading a word. This tool loads your
            homepage in a real browser at mobile and desktop widths, then measures typography, contrast, spacing, forms, and
            authority signals against a fixed rubric, the same craft standards a design review would apply by hand.
          </p>

          <div className="dc-hero-stats">
            <div className="dc-hero-stat">
              <div className="dc-hero-stat-num">60+</div>
              <div className="dc-hero-stat-label">Signals checked</div>
            </div>
            <div className="dc-hero-stat">
              <div className="dc-hero-stat-num">9</div>
              <div className="dc-hero-stat-label">Categories scored</div>
            </div>
            <div className="dc-hero-stat">
              <div className="dc-hero-stat-num">0</div>
              <div className="dc-hero-stat-label">Cost</div>
            </div>
          </div>
        </section>

        <section className="dc-tool-section">
          <WebsiteDesignCheckTool />
        </section>

        <section className="dc-categories-preview">
          <div className="dc-categories-header">
            <span className="dc-cat-eyebrow">What we check</span>
            <h2 className="dc-categories-title">
              The categories that shape a first impression<span className="ts" />
            </h2>
          </div>
          <div className="dc-categories-grid">
            <div className="dc-cat-preview">
              <div className="dc-cat-icon">1</div>
              <h3 className="dc-cat-preview-name">Typography &amp; Legibility</h3>
              <p className="dc-cat-preview-desc">Line length, line height, heading order, and headline-to-body contrast, measured from real computed font metrics.</p>
            </div>
            <div className="dc-cat-preview">
              <div className="dc-cat-icon">2</div>
              <h3 className="dc-cat-preview-name">Color &amp; Contrast</h3>
              <p className="dc-cat-preview-desc">WCAG AA text contrast on the elements a visitor actually reads, computed from the real relative-luminance formula.</p>
            </div>
            <div className="dc-cat-preview">
              <div className="dc-cat-icon">3</div>
              <h3 className="dc-cat-preview-name">Forms &amp; Conversion Flow</h3>
              <p className="dc-cat-preview-desc">Field count, label persistence, and required-field clarity on the intake form that decides whether a visitor finishes.</p>
            </div>
            <div className="dc-cat-preview">
              <div className="dc-cat-icon">4</div>
              <h3 className="dc-cat-preview-name">Mobile &amp; Responsive</h3>
              <p className="dc-cat-preview-desc">Tap target size, horizontal overflow, and menu labeling at the width most visitors actually use.</p>
            </div>
            <div className="dc-cat-preview">
              <div className="dc-cat-icon">5</div>
              <h3 className="dc-cat-preview-name">Performance</h3>
              <p className="dc-cat-preview-desc">Core Web Vitals from a real page load, plus image format and logo delivery.</p>
            </div>
            <div className="dc-cat-preview">
              <div className="dc-cat-icon">6</div>
              <h3 className="dc-cat-preview-name">Authority &amp; Positioning</h3>
              <p className="dc-cat-preview-desc">Whether the page states a clear focus and backs its claims with verifiable proof, or leans on unbacked language a regulator would flag.</p>
            </div>
          </div>
        </section>

        <section className="dc-disclaimer">
          <p>
            <strong>Free diagnostic tool.</strong> This report checks publicly visible signals on your homepage in a single
            page render. It does not access analytics or any private data, and design judgment items are scored by a
            language model against a fixed rubric rather than a human reviewer. Built by CaseLoad Select.
          </p>
        </section>
      </main>

      <style>{`
        .dc-main { background: var(--parchment); min-height: calc(100vh - 72px); padding: var(--sp-9) var(--section-pad-h) var(--sp-10); }
        .dc-hero { max-width: 760px; margin: 0 auto var(--sp-8); text-align: center; }
        .dc-hero-eyebrow { font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: var(--ls-eyebrow-l); text-transform: uppercase; color: var(--stone-on-light); margin-bottom: var(--sp-5); }
        .dc-hero-title { font-family: var(--font-display); font-size: var(--fs-hero); font-weight: 800; color: var(--navy); line-height: 1.05; letter-spacing: var(--ls-headline); margin: 0 0 var(--sp-5); }
        .dc-hero-sub { font-size: var(--fs-lead); color: var(--text-muted); line-height: 1.65; margin: 0 auto var(--sp-7); max-width: 640px; }
        .dc-hero-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-5); max-width: 480px; margin: 0 auto; }
        .dc-hero-stat { padding: var(--sp-4) var(--sp-3); border-top: 2px solid var(--stone); }
        .dc-hero-stat-num { font-family: var(--font-display); font-size: 36px; font-weight: 800; color: var(--navy); line-height: 1; margin-bottom: var(--sp-2); }
        .dc-hero-stat-label { font-family: var(--font-display); font-size: 10.5px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; color: var(--text-muted); line-height: 1.4; }

        .dc-tool-section { max-width: 860px; margin: 0 auto var(--sp-9); }

        .dc-categories-preview { max-width: 920px; margin: 0 auto var(--sp-9); }
        .dc-categories-header { text-align: center; margin-bottom: var(--sp-7); }
        .dc-cat-eyebrow { font-family: var(--font-display); font-size: var(--fs-eyebrow); font-weight: 700; letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--stone); margin-bottom: var(--sp-3); display: block; }
        .dc-categories-title { font-family: var(--font-display); font-size: var(--fs-h2); font-weight: 800; color: var(--navy); line-height: 1.1; margin: 0; }
        .dc-categories-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-5); }
        .dc-cat-preview { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-5); }
        .dc-cat-icon { font-family: var(--font-display); font-size: 22px; font-weight: 800; color: var(--white); background: var(--navy); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: var(--sp-4); }
        .dc-cat-preview-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--navy); margin: 0 0 var(--sp-2); }
        .dc-cat-preview-desc { font-size: 12.5px; color: var(--text-muted); line-height: 1.6; margin: 0; }

        .dc-disclaimer { max-width: 720px; margin: 0 auto; padding: var(--sp-5); border: 1px solid var(--border); border-radius: var(--r-card); background: var(--white); }
        .dc-disclaimer p { font-size: 12.5px; color: var(--text-muted); line-height: 1.65; margin: 0; }
        .dc-disclaimer strong { color: var(--navy); font-weight: 700; }

        @media print {
          .dc-nav, .dc-hero, .dc-categories-preview, .dc-disclaimer { display: none !important; }
          .dc-main { padding: 0 !important; background: #fff !important; min-height: 0 !important; }
          .dc-tool-section { margin: 0 !important; max-width: none !important; }
        }
        @media (max-width: 768px) {
          .dc-categories-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .dc-main { padding: var(--sp-7) var(--sp-4) var(--sp-9); }
          .dc-hero-stats { grid-template-columns: 1fr; max-width: 200px; }
        }
      `}</style>
    </>
  );
}
