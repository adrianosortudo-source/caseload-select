/**
 * /portal/login
 *
 * Lawyer-facing login page. Lawyer enters their email, the request-link
 * endpoint resolves email → firmId via the firm's branding.lawyer_email
 * field and sends a magic link via Resend. Existing /api/portal/generate
 * (operator-provisioned links) keeps working in parallel.
 *
 * Also shown when an operator-generated link is expired or invalid (the
 * existing flow). The status messaging covers both paths.
 */

import RequestLinkForm from "@/components/portal/RequestLinkForm";

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage =
    error === "expired" ? "This link has expired. Request a new one below."
    : error === "invalid" ? "This link is invalid. Request a new one below."
    : error === "missing" ? "Sign-in link missing. Enter your email below to receive a new one."
    : null;

  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-4">
        <div className="text-center text-navy font-semibold text-lg">CaseLoad Select</div>

        <div className="bg-white border border-black/8 p-8 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-navy" style={{ lineHeight: "1.2" }}>
              Sign in
            </h1>
            <p className="mt-2 text-sm text-black/60">
              Enter the email associated with your firm. A sign-in link will be sent to your inbox.
            </p>
          </div>

          {errorMessage && (
            <div className="bg-parchment border border-black/8 px-3 py-2 text-xs text-black/70">
              {errorMessage}
            </div>
          )}

          <RequestLinkForm />
        </div>

        <div className="flex items-center justify-center gap-3 text-xs text-black/40">
          <span>caseloadselect.ca</span>
          <span aria-hidden>·</span>
          <a href="/privacy" className="hover:text-navy transition-colors">Privacy</a>
          <span aria-hidden>·</span>
          <a href="/terms" className="hover:text-navy transition-colors">Terms</a>
        </div>
      </div>
    </div>
  );
}
