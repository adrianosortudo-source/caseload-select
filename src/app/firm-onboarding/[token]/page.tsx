/**
 * /firm-onboarding/[token]
 *
 * Public-facing onboarding intake form. The firm's authorized rep
 * (typically the lead lawyer) fills this in to give CaseLoad Select
 * everything we need to file the SMS A2P 10DLC brand, the WhatsApp
 * Business Account with Meta, and the GHL sub-account configuration.
 *
 * The token in the URL is the credential. Operator generates a token
 * per firm (e.g., "DRG-LAW-2026-05-13") and emails the link directly
 * to the rep. The form is open to anyone with the link.
 *
 * On submit:
 *   1. Row written to firm_onboarding_intake
 *   2. Notification email fires to the operator via Resend
 *   3. Rep sees the /submitted thank-you page
 *
 * Brand alignment: follows LOGO-USAGE.md (lockup-horizontal-tagline-dark-
 * transparent.png at 17px on deep-black header, 2px gold bottom border)
 * and Brand Book ACTS V1 (Manrope 800 h1, Oxanium kickers and labels in
 * 12px 2.5-3px letter-spacing uppercase, DM Sans body, 4px panel corners).
 */

import FirmOnboardingForm from "@/components/firm-onboarding/FirmOnboardingForm";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export default async function FirmOnboardingPage({ params }: PageProps) {
  const { token } = await params;

  // Derive a human-readable firm label from the token if it follows the
  // recommended pattern (e.g., DRG-LAW-2026-05-13 → "DRG Law"). Falls back
  // to the raw token if the pattern does not match.
  const firmLabel = humaniseToken(token);

  return (
    <div className="min-h-screen" style={{ background: "#F4F3EF" }}>
      {/*
        Canonical header per LOGO-USAGE.md §4: deep-black background,
        lockup-horizontal-tagline at 17px, 2px gold border-bottom,
        padding 18px 28px 16px. Identical pattern across firm-onboarding
        pages and the firm-onboarding-guides/* HTML pages.
      */}
      <header
        style={{
          background: "#0D1520",
          borderBottom: "2px solid #C4B49A",
          padding: "18px clamp(16px, 4vw, 28px) 16px",
        }}
      >
        <div
          className="max-w-3xl mx-auto"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <img
            src="/brand/logos/lockup-horizontal-tagline-dark-transparent.png"
            alt="CaseLoad Select · Sign Better Cases"
            style={{
              height: "17px",
              width: "auto",
              display: "block",
              border: 0,
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-oxanium), sans-serif",
              fontSize: "9.5px",
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#C4B49A",
              whiteSpace: "nowrap",
            }}
          >
            Firm Onboarding
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-10">
          <p
            style={{
              fontFamily: "var(--font-oxanium), sans-serif",
              fontSize: "0.66rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#8B7A5E",
              fontWeight: 600,
              marginBottom: "14px",
            }}
          >
            {firmLabel}
          </p>
          <h1
            style={{
              fontFamily: "var(--font-manrope), sans-serif",
              fontWeight: 800,
              fontSize: "clamp(1.85rem, 6vw, 2.4rem)",
              lineHeight: 1.1,
              color: "#1E2F58",
              marginBottom: "20px",
              letterSpacing: "-0.015em",
            }}
          >
            Tell us about your firm
            <span
              style={{
                display: "inline-block",
                width: "clamp(8px, 2vw, 10px)",
                height: "clamp(8px, 2vw, 10px)",
                background: "#C4B49A",
                marginLeft: "5px",
                verticalAlign: "baseline",
                marginBottom: "4px",
              }}
              aria-hidden="true"
            />
          </h1>
          <p
            style={{
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "clamp(1rem, 3.5vw, 1.0625rem)",
              lineHeight: 1.65,
              color: "#4a5a72",
              marginBottom: 0,
              fontWeight: 400,
            }}
          >
            Twelve fields, fifteen minutes. This gives us everything we need
            to file the messaging registrations (SMS and WhatsApp) with the
            carriers and Meta on your behalf, and to configure your CaseLoad
            Select sub-account. Most fields are details you already have on
            file; we are not asking for anything sensitive (no passwords, no
            payment details).
          </p>
        </div>

        <FirmOnboardingForm token={token} firmLabel={firmLabel} />
      </main>

      <footer
        style={{
          background: "#0D1520",
          padding: "22px 0",
          marginTop: "60px",
        }}
      >
        <div className="max-w-3xl mx-auto px-6" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img
            src="/brand/logos/wordmark-dark-transparent.png"
            alt="CaseLoad Select"
            style={{ height: "16px", width: "auto", display: "block", border: 0, opacity: 0.85 }}
          />
          <span
            style={{
              fontFamily: "var(--font-oxanium), sans-serif",
              fontSize: "0.66rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            Sign Better Cases
          </span>
        </div>
      </footer>
    </div>
  );
}

/**
 * Convert a token like "DRG-LAW-2026-05-13" into "DRG Law" for display.
 * Strips the date suffix; treats short all-uppercase segments (≤4 chars
 * in the source token) as acronyms and preserves their case. Anything
 * longer is title-cased.
 *
 *   "DRG-LAW-2026-05-13"        → "DRG Law"
 *   "KENNY-LAW-2026-05-20"      → "Kenny Law"
 *   "POWELL-LITIGATION-..."     → "Powell Litigation"
 *   "ABC-CORPORATE-LAW-..."     → "ABC Corporate Law"
 */
function humaniseToken(token: string): string {
  const stripped = token.replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}.*$/i, "");
  const parts = stripped.split(/[-_]/).filter(Boolean);
  if (parts.length === 0) return token;
  return parts
    .map((p) => {
      const isAcronym = p.length <= 4 && p === p.toUpperCase() && /^[A-Z]+$/.test(p);
      return isAcronym ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join(" ");
}
