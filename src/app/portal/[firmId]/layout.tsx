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

  if (!session || session.firm_id !== firmId) {
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
        className="px-6 py-4 flex items-center justify-between border-b border-black/5 shrink-0"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="flex items-center gap-3">
          {branding.logo_url && (
            <img src={branding.logo_url} alt={firmName} className="h-7 w-auto" />
          )}
          <div>
            <div className="text-white font-semibold text-sm">{firmName}</div>
            <div className="text-white/50 text-xs">Client Dashboard</div>
          </div>
        </div>
        <form action={`/api/portal/logout?firm_id=${firmId}`} method="POST">
          <button
            type="submit"
            className="text-xs text-white/60 hover:text-white transition px-3 py-1.5 rounded border border-white/20 hover:border-white/40"
          >
            Sign out
          </button>
        </form>
      </header>

      <PortalTabNav firmId={firmId} />

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">{children}</main>
      <footer className="text-center text-xs text-black/30 py-6 shrink-0">
        Powered by CaseLoad Select
      </footer>
    </div>
  );
}
