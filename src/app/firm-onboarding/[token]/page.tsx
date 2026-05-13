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
      <header
        className="w-full"
        style={{
          background: "#1E2F58",
          padding: "28px 0",
        }}
      >
        <div className="max-w-3xl mx-auto px-6 flex items-center justify-between">
          <span
            style={{
              fontFamily: "Oxanium, sans-serif",
              fontWeight: 700,
              fontSize: "1.1rem",
              color: "#FFFFFF",
              letterSpacing: "0.05em",
            }}
          >
            CaseLoad Select
            <span
              style={{
                display: "inline-block",
                width: "6px",
                height: "6px",
                background: "#C4B49A",
                marginLeft: "4px",
                verticalAlign: "baseline",
                marginBottom: "1px",
              }}
            />
          </span>
          <span
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: "0.78rem",
              color: "rgba(255,255,255,0.7)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
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
              fontFamily: "Oxanium, sans-serif",
              fontSize: "0.72rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#C4B49A",
              fontWeight: 700,
              marginBottom: "8px",
            }}
          >
            {firmLabel}
          </p>
          <h1
            style={{
              fontFamily: "Manrope, sans-serif",
              fontWeight: 800,
              fontSize: "2.1rem",
              lineHeight: 1.15,
              color: "#1E2F58",
              marginBottom: "16px",
              letterSpacing: "-0.01em",
            }}
          >
            Tell us about your firm
          </h1>
          <p
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: "1rem",
              lineHeight: 1.6,
              color: "#3F3C36",
              marginBottom: 0,
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
        className="w-full mt-16"
        style={{
          background: "#0D1520",
          padding: "20px 0",
        }}
      >
        <div className="max-w-3xl mx-auto px-6">
          <p
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: "0.78rem",
              color: "rgba(255,255,255,0.55)",
              margin: 0,
            }}
          >
            CaseLoad Select &middot; Sign Better Cases
            <span
              style={{
                display: "inline-block",
                width: "5px",
                height: "5px",
                background: "#C4B49A",
                marginLeft: "4px",
                verticalAlign: "baseline",
                marginBottom: "1px",
              }}
            />
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Convert a token like "DRG-LAW-2026-05-13" into "DRG Law" for display.
 * Strips the date suffix and title-cases the remaining segments.
 */
function humaniseToken(token: string): string {
  // Remove trailing date if present (YYYY-MM-DD or similar)
  const stripped = token.replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}.*$/i, "");
  const parts = stripped.split(/[-_]/).filter(Boolean);
  if (parts.length === 0) return token;
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}
