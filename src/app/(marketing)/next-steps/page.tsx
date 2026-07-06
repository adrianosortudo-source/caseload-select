import type { Metadata } from "next";
import MarketingNav from "../components/MarketingNav";

/**
 * /next-steps
 *
 * On-domain booking page. Replaces direct links out to the raw GHL booking
 * widget URL (https://api.leadconnectorhq.com/widget/booking/strategy-call).
 * The booking widget is embedded here via iframe so the domain stays
 * caseloadselect.ca throughout the booking flow; the prospect never sees
 * the leadconnectorhq.com URL directly.
 *
 * Transactional/booking surface, not a page meant to rank in search:
 * noindex, nofollow.
 */
export const metadata: Metadata = {
  title: "Book a Strategy Call · CaseLoad Select",
  description:
    "A 30-minute call. We walk through your intake numbers, identify where qualified cases are being lost, and decide together whether CaseLoad Select is the right fit for your practice.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NextStepsPage() {
  return (
    <>
      <MarketingNav />

      <section className="section-navy">
        <div className="section-inner">
          <span className="eyebrow reveal">Next steps</span>
          <h1 className="section-headline section-headline-white reveal" style={{ marginTop: "var(--sp-4)" }}>
            Book a Strategy Call<span className="ts" />
          </h1>
          <p className="section-sub section-sub-white reveal">
            1. You request the diagnostic or click through here. 2. We confirm
            fit, briefly. 3. We book a 30-minute call to walk through your
            intake numbers and decide together whether this fits your
            practice.
          </p>
        </div>
      </section>

      <section className="section-parchment">
        <div className="section-inner">
          <div className="ns-booking-frame reveal">
            <iframe
              src="https://api.leadconnectorhq.com/widget/booking/strategy-call"
              title="Book a Strategy Call with CaseLoad Select"
              className="ns-booking-iframe"
              loading="lazy"
            />
          </div>

          <div className="ns-prep-note reveal">
            <span className="eyebrow">Before the call</span>
            <p className="section-sub" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
              Have your practice areas on hand and a rough sense of how many
              inquiries land each month. That is enough for us to walk through
              your intake numbers together and decide whether CaseLoad Select
              is the right fit for your practice.
            </p>
          </div>

          <p className="ns-secondary-link reveal">
            Not ready? <a href="/screen-demo">Try the Screen on a sample inquiry first</a>
          </p>
        </div>
      </section>

      <style>{`
        .ns-booking-frame {
          width: 100%;
          max-width: 900px;
          margin: 0 auto;
          border-radius: var(--r-tight);
          overflow: hidden;
          border: 1px solid rgba(30, 47, 88, 0.12);
          background: var(--white);
        }
        .ns-booking-iframe {
          display: block;
          width: 100%;
          min-height: 760px;
          height: 78vh;
          border: none;
        }
        .ns-prep-note {
          max-width: 900px;
          margin: var(--sp-6) auto 0;
          padding: var(--sp-5) var(--sp-6);
          background: var(--white);
          border: 1px solid rgba(30, 47, 88, 0.1);
          border-radius: var(--r-tight);
        }
        .ns-secondary-link {
          max-width: 900px;
          margin: var(--sp-6) auto 0;
          text-align: center;
          font-size: 13px;
          color: var(--text-muted);
        }
        .ns-secondary-link a {
          color: var(--navy);
          text-decoration: underline;
          text-underline-offset: 3px;
          font-weight: 600;
        }

        @media (max-width: 640px) {
          .ns-booking-iframe {
            min-height: 640px;
          }
        }
      `}</style>
    </>
  );
}
