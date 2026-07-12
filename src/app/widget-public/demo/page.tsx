import type { Metadata } from "next";
import { ScreenEnginePublicWidget } from "@/components/intake-v2/ScreenEnginePublicWidget";

/**
 * /widget-public/demo - the public, REAL-engine demonstration of CaseLoad
 * Screen, for embedding on caseloadselect.ca marketing surfaces.
 *
 * Why this exists: the marketing site's interactive demo must run the real
 * screening engine (operator directive 2026-07-11: a scripted trial "will be
 * working against us"). This page mounts the same ScreenEnginePublicWidget
 * every client firm embeds, in the server's purpose-built demo mode:
 *
 *   - firmId is the literal sentinel "demo_firm". /api/intake-v2 recognizes
 *     it and returns { persisted: false, mode: "demo" } BEFORE validation,
 *     the contact gate, and every write. No screened_leads row, no
 *     unconfirmed_inquiries row, no consent_log row, no notification, no
 *     GHL webhook. The engine still runs fully (client-side classification,
 *     banding, question selection) and /api/extract still performs real
 *     Gemini extraction.
 *   - No intake_firms row exists or is needed; the widget renders the
 *     default CaseLoad Select chrome (that IS the default theme).
 *   - This static route sits under /widget-public/, so it inherits the
 *     widget security headers from next.config.ts (no frame-ancestors
 *     restriction, Permissions-Policy microphone=*), making it embeddable
 *     in an iframe on caseloadselect.ca with allow="microphone".
 *
 * Compliance posture (LSO Rule 4.2-1): the DEMONSTRATION bands top and
 * bottom mirror the Sample Report's mandatory band device. The top band
 * also states plainly that nothing entered here is stored or sent to a
 * firm, which is literally true in demo mode.
 *
 * Operator gate before promoting this URL publicly: provision Upstash so
 * the per-IP rate limits on /api/extract and /api/intake-v2 actually
 * enforce (they fail open without UPSTASH_REDIS_REST_URL/TOKEN).
 */

export const metadata: Metadata = {
  title: "CaseLoad Screen · Live Demonstration",
  robots: { index: false, follow: false },
};

const DEMO_FIRM_SENTINEL = "demo_firm";

export default function PublicWidgetDemoPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F4F3EF]">
      <div
        className="text-center text-white uppercase"
        style={{
          background: "#0D1520",
          fontFamily: "Manrope, sans-serif",
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: "0.14em",
          padding: "10px 16px",
        }}
      >
        Demonstration &middot; Real screening engine &middot; Nothing you enter is stored or sent to a firm
      </div>

      <div className="flex-1">
        <ScreenEnginePublicWidget firmId={DEMO_FIRM_SENTINEL} firmName="Hartwell Law PC" />
      </div>

      <div
        className="text-center uppercase"
        style={{
          background: "#0D1520",
          color: "rgba(237, 234, 217, 0.7)",
          fontFamily: "Manrope, sans-serif",
          fontSize: "10px",
          fontWeight: 800,
          letterSpacing: "0.14em",
          padding: "8px 16px",
        }}
      >
        Hartwell Law PC is a fictional firm &middot; Sample environment &middot; Not legal advice
      </div>
    </div>
  );
}
