/**
 * /firm-onboarding/[token]/submitted
 *
 * Thank-you page after the firm onboarding form is submitted.
 * Brand alignment matches /firm-onboarding/[token]/page.tsx.
 */

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SubmittedPage({ params }: PageProps) {
  await params; // consume so the route is recognised even if we do not use the token

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F4F3EF" }}>
      <header
        style={{
          background: "#0D1520",
          borderBottom: "2px solid #C4B49A",
          padding: "18px 28px 16px",
        }}
      >
        <div
          className="max-w-3xl mx-auto"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <img
            src="/brand/logos/lockup-horizontal-tagline-dark-transparent.png"
            alt="CaseLoad Select · Sign Better Cases"
            style={{ height: "24px", width: "auto", display: "block", border: 0 }}
          />
          <span
            style={{
              fontFamily: "var(--font-oxanium), sans-serif",
              fontSize: "0.7rem",
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.55)",
            }}
          >
            Firm Onboarding
          </span>
        </div>
      </header>

      <main className="flex-grow max-w-2xl mx-auto px-6 py-16">
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E4E2DB",
            padding: "44px 40px",
            borderRadius: "4px",
          }}
        >
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
            Submitted
          </p>
          <h1
            style={{
              fontFamily: "var(--font-manrope), sans-serif",
              fontWeight: 800,
              fontSize: "2.2rem",
              lineHeight: 1.1,
              color: "#1E2F58",
              marginBottom: "24px",
              letterSpacing: "-0.015em",
            }}
          >
            Thank you
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
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
              fontSize: "1.0625rem",
              lineHeight: 1.65,
              color: "#4a5a72",
              marginBottom: "16px",
            }}
          >
            Your firm onboarding details are with us. CaseLoad Select will use them to file
            the SMS A2P 10DLC brand registration with the Canadian carriers and to begin
            the WhatsApp Business Account verification with Meta on your behalf.
          </p>
          <p
            style={{
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "1.0625rem",
              lineHeight: 1.65,
              color: "#4a5a72",
              marginBottom: "16px",
            }}
          >
            Expect to hear back within 1-2 business days with the next-step plan: timing,
            what is required from your side during Meta verification, and any clarifications
            we may need on the answers you provided.
          </p>
          <p
            style={{
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "0.95rem",
              lineHeight: 1.65,
              color: "#8090A8",
              marginBottom: 0,
            }}
          >
            If you remembered something after submitting, simply reply to the email that
            originally pointed you to this form.
          </p>
        </div>
      </main>

      <footer style={{ background: "#0D1520", padding: "22px 0" }}>
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
