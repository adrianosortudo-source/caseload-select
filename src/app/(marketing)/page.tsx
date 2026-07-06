import type { Metadata } from "next";
import MarketingNav from "./components/MarketingNav";
import Hero from "./components/Hero";
import Ticker from "./components/Ticker";
import ProblemSection from "./components/ProblemSection";
import ActsSystemSection from "./components/ActsSystemSection";
import CpiSection from "./components/CpiSection";
import ClientResultSection from "./components/ClientResultSection";
import CaseStudyTeaser from "./components/CaseStudyTeaser";
import WhySection from "./components/WhySection";
import FaqSection from "./components/FaqSection";

/**
 * CaseLoad Select Marketing Homepage at / (canonical root)
 *
 * Relocated here 2026-07-02 from home/page.tsx per the Website Strategy's
 * canonical-domain decision: / is the canonical homepage, /home 301s to /.
 * home/page.tsx is now a thin redirect stub; do not add content there.
 *
 * Section order (v45 craft inheritance, ACTS brand language):
 *   1. Hero: layered background, ACTS pillars, operator block
 *   2. Ticker: auto-scrolling brand keywords
 *   3. Problem: three cards (Volume Trap / Screening Gap / Capacity Cost)
 *   4. ACTS System: four expanded cards (A / C / T / S)
 *   5. CPI: four-band model strip (A / B / C / D, per band.ts)
 *   6. Client Result: Damaris Regina Guimaraes testimonial + verified activity facts
 *   7. Why: four RTB cards (LSO-Fluent / Operator-Led / System-First / Toronto-Native)
 *   8. FAQ: six accordion items + FAQPage JSON-LD
 *   9. Final CTA: navy with breathing glow
 */
export const metadata: Metadata = {
  title: "CaseLoad Select | Sign Better Cases",
  description:
    "CaseLoad Select scores, filters, and routes every inquiry before a lawyer reads it, so sole practitioners and small Toronto firms spend their time on the cases worth taking.",
  alternates: {
    canonical: "/",
  },
};

export default function MarketingHomePage() {
  return (
    <>
      <MarketingNav />
      <Hero />
      <Ticker />
      <ProblemSection />
      <ActsSystemSection />
      <CpiSection />
      <ClientResultSection />
      <CaseStudyTeaser />
      <WhySection />
      <FaqSection />

      <section id="cta" className="section-navy">
        <div className="section-inner">
          <h2 className="section-headline section-headline-white reveal">
            See if it fits your practice<span className="ts" />
          </h2>
          <p className="section-sub section-sub-white reveal" style={{ marginBottom: "var(--sp-6)" }}>
            A 30-minute call. We walk through your intake numbers, identify
            where qualified cases are being lost, and decide together whether
            CaseLoad Select is the right fit for your practice.
          </p>
          <a href="/next-steps" className="btn-primary reveal">
            Book a Strategy Call
          </a>
          <p
            className="reveal"
            style={{
              marginTop: "var(--sp-5)",
              fontSize: "13px",
              color: "rgba(237, 234, 217, 0.55)",
            }}
          >
            Not ready for a call? <a
              href="/screen-demo"
              style={{ color: "var(--stone)", textDecoration: "underline", textUnderlineOffset: "3px" }}
            >Try the Screen on a sample inquiry first →</a>
          </p>
        </div>
      </section>
    </>
  );
}
