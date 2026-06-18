/**
 * /firm-profile/[token]
 *
 * Public-facing Firm Profile intake (Form 2 of 2). Operations, brand, and
 * growth details that run alongside or just after the registration form. Same
 * token model as /firm-onboarding/[token]: the token is the credential and
 * becomes the firm's display label. Submissions land in firm_onboarding_intake
 * with form_type='profile'.
 */

import FirmProfileForm from "@/components/firm-onboarding/FirmProfileForm";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export default async function FirmProfilePage({ params }: PageProps) {
  const { token } = await params;
  const firmLabel = humaniseToken(token);

  return (
    <div className="min-h-screen" style={{ background: "#F4F3EF" }}>
      <header
        style={{
          background: "#0D1520",
          borderBottom: "2px solid #C4B49A",
          padding: "18px clamp(16px, 4vw, 28px) 16px",
        }}
      >
        <div
          className="max-w-3xl mx-auto"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}
        >
          <img
            src="/brand/logos/lockup-horizontal-tagline-dark-transparent.png"
            alt="CaseLoad Select · Sign Better Cases"
            style={{ height: "17px", width: "auto", display: "block", border: 0 }}
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
            Firm Profile
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
            Your firm profile
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
            About fifteen minutes. This is the operations, brand, and growth side of your setup, the details that shape the CRM journeys, the website, and how intake is screened. Nothing here is urgent or sensitive; most fields are quick choices.
          </p>
        </div>

        <FirmProfileForm token={token} firmLabel={firmLabel} />
      </main>

      <footer style={{ background: "#0D1520", padding: "22px 0", marginTop: "60px" }}>
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
