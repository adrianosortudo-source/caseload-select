import type { Metadata } from "next";
import "./website-design-check.css";
import ToolNav from "./_components/ToolNav";
import PublicToolFooter from "../PublicToolFooter";
import WebsiteDesignCheckTool from "@/components/website-design-check/WebsiteDesignCheckTool";

export const metadata: Metadata = {
  title: "Free Website Design Review · CaseLoad Select",
  description:
    "See how your law firm's website scores on typography, contrast, forms, mobile usability, and authority signals, plus a ranked list of specific fixes. Free, no account required.",
  alternates: {
    canonical: "https://caseloadselect.ca/tools/website-design-check",
  },
  openGraph: {
    title: "Free Website Design Review · CaseLoad Select",
    description: "See how your law firm's website scores on design and conversion craft, plus a ranked list of specific fixes. Free, no account required.",
    type: "website",
    locale: "en_CA",
  },
};

/**
 * `?embed=1` strips the page down to the tool itself.
 *
 * The marketing site frames this route inline on tools.html alongside the
 * other three public tools. Without the flag the embed carries its own
 * ToolNav (a second CaseLoad wordmark plus a "Back to home" link) and the
 * (marketing) layout's full site footer, both stranded mid-page inside a
 * page that already has them. The layout owns the footer and App Router
 * layouts do not receive searchParams, so the page hides it with a scoped
 * rule rather than the layout branching on the flag.
 *
 * No flag to propagate onward: this tool has no internal navigation. The
 * scan posts to /api/tools/website-design-check and the report renders in
 * place, so unlike the screen demo's CasePicker there is no router.push
 * that would drop ?embed=1 and bring the chrome back inside the iframe.
 */
interface PageProps {
  searchParams: Promise<{ embed?: string }>;
}

export default async function WebsiteDesignCheckPage({ searchParams }: PageProps) {
  const { embed } = await searchParams;
  const isEmbedded = embed === "1";

  return (
    <div className={`dc-page${isEmbedded ? " dc-page-embedded" : ""}`}>
      {!isEmbedded && <ToolNav />}
      <main className="dc-main">
        {!isEmbedded && (
          <header className="dc-hero" data-ui-component-content="checker-introduction">
            <h1 className="dc-hero-title" data-ui-copy="heading">Website Design Review</h1>
            <p className="dc-hero-sub" data-ui-copy="body">
              A visitor decides whether your firm looks credible within seconds, before reading a word. This tool loads your
              homepage in a real browser at mobile and desktop widths, then measures typography, contrast, spacing, forms, and
              authority signals against a fixed rubric, the same craft standards a design review would apply by hand.
            </p>
            <ul className="dc-hero-facts" aria-label="About this check">
              <li><span>60+</span> signals checked</li>
              <li><span>9</span> categories scored</li>
              <li>Free, no account required</li>
            </ul>
          </header>
        )}
        <section className="dc-tool-section" aria-label="Check a public website">
          <WebsiteDesignCheckTool />
        </section>
        <section className="dc-categories-preview" aria-labelledby="dc-categories-title">
          <div className="dc-categories-header" data-ui-component-content="category-introduction">
            <h2 id="dc-categories-title" className="dc-categories-title" data-ui-copy="heading">The categories that shape a first impression</h2>
          </div>
          <div className="dc-categories-grid">
            {[
              ["Typography & Legibility", "Line length, line height, heading order, and headline-to-body contrast, measured from real computed font metrics."],
              ["Color & Contrast", "WCAG AA text contrast on the elements a visitor actually reads, computed from the real relative-luminance formula."],
              ["Forms & Conversion Flow", "Field count, label persistence, and required-field clarity on the intake form that decides whether a visitor finishes."],
              ["Mobile & Responsive", "Tap target size, horizontal overflow, and menu labeling at the width most visitors actually use."],
              ["Performance", "Core Web Vitals from a real page load, plus image format and logo delivery."],
              ["Authority & Positioning", "Whether the page states a clear focus and backs its claims with verifiable proof, or leans on unbacked language a regulator would flag."],
            ].map(([name, description]) => (
              <article className="dc-cat-preview" key={name} data-ui-component-content="category-description">
                <h3 className="dc-cat-preview-name" data-ui-copy="heading">{name}</h3>
                <p className="dc-cat-preview-desc" data-ui-copy="body">{description}</p>
              </article>
            ))}
          </div>
        </section>
        <aside className="dc-disclaimer" data-ui-component-content="checker-disclosure">
          <p data-ui-copy="supporting">
            <strong>Free diagnostic tool.</strong> This report checks publicly visible signals on your homepage in a single
            page render. It does not access analytics or any private data, and design judgment items are scored by a
            language model against a fixed rubric rather than a human reviewer. Built by CaseLoad Select.
          </p>
        </aside>
      </main>
    </div>
  );
}
