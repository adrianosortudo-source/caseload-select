/**
 * Portal layout for /portal/[firmId].
 *
 * Overrides root layout (no Sidebar, no operator chrome).
 * Uses firm branding from intake_firms.branding if available.
 * Falls back to CaseLoad Select brand defaults.
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import PortalTabNav from "@/components/portal/PortalTabNav";

interface Branding {
  firm_name?: string;
  primary_color?: string;
  logo_url?: string;
}

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ firmId: string }>;
}) {
  const session = await getPortalSession();
  const { firmId } = await params;

  // Auth gate. Operators can view ANY firm's portal pages (triage queue,
  // brief, etc.) — their session bypasses the firm_id match. Lawyers must
  // present a session whose firm_id matches the path.
  const isOperator = session?.role === "operator";
  if (!session || (!isOperator && session.firm_id !== firmId)) {
    redirect("/portal/login");
  }

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("name, branding")
    .eq("id", firmId)
    .single();

  const branding = (firm?.branding as Branding) ?? {};
  const firmName = branding.firm_name ?? firm?.name ?? "Client Portal";
  const primaryColor = branding.primary_color ?? "#1E2F58";

  return (
    <div className="bg-parchment min-h-screen flex flex-col">
      <header
        className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 border-b border-black/5 shrink-0"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {branding.logo_url && (
            <img src={branding.logo_url} alt={firmName} className="h-7 w-auto shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-white font-semibold text-sm truncate">{firmName}</div>
            <div className="text-white/50 text-xs">Client Dashboard</div>
          </div>
        </div>
        <form action={`/api/portal/logout?firm_id=${firmId}`} method="POST" className="shrink-0">
          <button
            type="submit"
            className="text-xs text-white/60 hover:text-white transition px-3 py-1.5 rounded border border-white/20 hover:border-white/40"
          >
            Sign out
          </button>
        </form>
      </header>

      {isOperator && <OperatorViewingBanner firmName={firmName} />}

      <PortalTabNav firmId={firmId} />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">{children}</main>
      <footer className="text-center text-xs text-black/30 py-6 shrink-0 flex items-center justify-center gap-4">
        <span>Powered by CaseLoad Select</span>
        <span aria-hidden>·</span>
        <a href="/privacy" className="hover:text-navy transition-colors">Privacy</a>
        <span aria-hidden>·</span>
        <a href="/terms" className="hover:text-navy transition-colors">Terms</a>
      </footer>
    </div>
  );
}

/**
 * Visible at the top of every firm-scoped page when the viewer is an
 * operator (cross-firm session). Anchors the operator back to /admin so
 * they don't get lost in firm chrome.
 */
function OperatorViewingBanner({ firmName }: { firmName: string }) {
  return (
    <div className="bg-gold/15 border-b border-gold/30 px-6 py-2 text-xs text-navy flex items-center justify-between gap-3">
      <span>
        <span className="uppercase tracking-wider font-bold mr-2">Operator view</span>
        Viewing {firmName} as the operator console.
      </span>
      <a
        href="/admin/triage"
        className="uppercase tracking-wider font-semibold text-navy/80 hover:text-navy underline underline-offset-2"
      >
        Back to operator console
      </a>
    </div>
  );
}
