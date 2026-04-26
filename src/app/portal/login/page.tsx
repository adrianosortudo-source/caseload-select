/**
 * /portal/login
 *
 * Landing page for expired or invalid magic links.
 * The firm never navigates here directly  -  they arrive via a magic link
 * which validates and redirects immediately. This page only shows on error.
 */

export default function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="text-navy font-semibold text-lg">CaseLoad Select</div>
        <div className="bg-white rounded-xl border border-black/5 shadow-sm p-8 space-y-3">
          <div className="text-2xl font-bold text-navy">Access Required</div>
          <p className="text-sm text-black/60">
            This link has expired or is invalid. Contact your CaseLoad Select operator to receive a new access link.
          </p>
        </div>
        <p className="text-xs text-black/40">caseloadselect.ca</p>
      </div>
    </div>
  );
}
