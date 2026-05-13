/**
 * /firm-onboarding/[token]/submitted
 *
 * Thank-you page after the firm onboarding form is submitted.
 */

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SubmittedPage({ params }: PageProps) {
  await params; // consume so the route is recognised even if we do not use the token

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F4F3EF" }}>
      <header className="w-full" style={{ background: "#1E2F58", padding: "28px 0" }}>
        <div className="max-w-3xl mx-auto px-6">
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
        </div>
      </header>

      <main className="flex-grow max-w-2xl mx-auto px-6 py-16">
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E4E2DB",
            padding: "40px 36px",
            borderRadius: "4px",
          }}
        >
          <p
            style={{
              fontFamily: "Oxanium, sans-serif",
              fontSize: "0.72rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#C4B49A",
              fontWeight: 700,
              marginBottom: "10px",
            }}
          >
            Submitted
          </p>
          <h1
            style={{
              fontFamily: "Manrope, sans-serif",
              fontWeight: 800,
              fontSize: "2rem",
              lineHeight: 1.15,
              color: "#1E2F58",
              marginBottom: "20px",
              letterSpacing: "-0.01em",
            }}
          >
            Thank you
            <span
              style={{
                display: "inline-block",
                width: "9px",
                height: "9px",
                background: "#C4B49A",
                marginLeft: "5px",
                verticalAlign: "baseline",
                marginBottom: "3px",
              }}
            />
          </h1>
          <p
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: "1rem",
              lineHeight: 1.65,
              color: "#3F3C36",
              marginBottom: "14px",
            }}
          >
            Your firm onboarding details are with us. CaseLoad Select will use them to file
            the SMS A2P 10DLC brand registration with the Canadian carriers and to begin
            the WhatsApp Business Account verification with Meta on your behalf.
          </p>
          <p
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: "1rem",
              lineHeight: 1.65,
              color: "#3F3C36",
              marginBottom: "14px",
            }}
          >
            Expect to hear back within 1-2 business days with the next-step plan: timing,
            what is required from your side during Meta verification, and any clarifications
            we may need on the answers you provided.
          </p>
          <p
            style={{
              fontFamily: "DM Sans, sans-serif",
              fontSize: "0.95rem",
              lineHeight: 1.65,
              color: "#6B665E",
              marginBottom: 0,
            }}
          >
            If you remembered something after submitting, simply reply to the email that
            originally pointed you to this form.
          </p>
        </div>
      </main>

      <footer className="w-full" style={{ background: "#0D1520", padding: "20px 0" }}>
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
