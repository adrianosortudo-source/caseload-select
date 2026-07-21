/**
 * Portal layout for /portal/[firmId].
 *
 * Overrides root layout (no Sidebar, no operator chrome).
 * Uses firm branding from intake_firms.branding if available.
 * Falls back to CaseLoad Select brand defaults.
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { getPreviewIntent } from "@/lib/preview-mode";
import { getOperatorWorkspace } from "@/lib/operator-workspace";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getFirmUnreadCount } from "@/lib/operator-firm-messaging";
import PortalTabNav from "@/components/portal/PortalTabNav";
import PreviewStrip from "@/components/portal/PreviewStrip";
import AdminSidebar from "@/components/admin/AdminSidebar";
import OperatorWorkspaceBanner from "@/components/portal/OperatorWorkspaceBanner";

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
  // Client-role sessions (matter-scoped magic links) are admitted by this
  // layout ON PURPOSE: the client matter home at /portal/[firmId]/m/[matterId]/*
  // nests under it, and the firm_id match below is the right gate for those
  // sessions. Lawyer-facing surfaces (triage, dashboard, pipeline, leads,
  // files, clients, matters) exclude role='client' at page level instead.
  const isOperator = session?.role === "operator";
  const isClient = session?.role === "client";
  if (!session || (!isOperator && session.firm_id !== firmId)) {
    redirect("/portal/login");
  }

  // DR-084: an operator with a live preview cookie for this firm renders the
  // target's interface with no operator chrome (no console rail, no banner),
  // plus the PreviewStrip. Lawyer preview keeps the lawyer tab nav; client
  // preview hides it, matching what a real client sees under this layout.
  const preview = isOperator ? await getPreviewIntent() : null;
  const workspace = isOperator ? await getOperatorWorkspace(firmId) : null;
  const isLawyerPreview = !!preview && preview.target === "lawyer" && preview.firm_id === firmId;
  const isClientPreview = !!preview && preview.target === "client" && preview.firm_id === firmId;
  const inPreview = isLawyerPreview || isClientPreview;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("name, branding")
    .eq("id", firmId)
    .single();

  const branding = (firm?.branding as Branding) ?? {};
  const firmName = branding.firm_name ?? firm?.name ?? "Client Portal";
  const primaryColor = branding.primary_color ?? "#1E2F58";

  // Lawyer-side unread badge for the CaseLoad Connect tab (operators have the
  // console badges; clients never see this tab).
  let caseloadUnread = 0;
  if (session && !isOperator && !isClient) {
    caseloadUnread = await getFirmUnreadCount(firmId, {
      role: "lawyer",
      id: session.lawyer_id ?? "lawyer",
      name: "",
    }).catch(() => 0);
  }

  // The firm-branded portal column (header, operator banner, tab nav, content,
  // footer). Identical for every viewer; the operator gets the console rail
  // wrapped around it below.
  const portalColumn = (
    <div
      className="bg-parchment flex flex-col flex-1 min-w-0 min-h-screen"
      // Firm accent for the lawyer portal (white-label): every lawyer-surface
      // accent reads `var(--portal-accent)` so it follows the firm's branding,
      // matching the header. Structure tokens (parchment, border-brand, status
      // colours) stay brand-agnostic.
      style={{ ["--portal-accent" as string]: primaryColor }}
    >
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
            <div className="text-white/50 text-xs">Lawyer portal</div>
          </div>
        </div>
        <form action={`/api/portal/logout?firm_id=${firmId}`} method="POST" className="shrink-0">
          <button
            type="submit"
            className="text-xs text-white/60 hover:text-white transition px-3 py-1.5 border border-white/20 hover:border-white/40"
          >
            Sign out
          </button>
        </form>
      </header>

      {isOperator && !inPreview && workspace && <OperatorWorkspaceBanner firmName={firmName} firmId={firmId} />}
      {isOperator && !inPreview && !workspace && <OperatorViewingBanner firmName={firmName} firmId={firmId} />}
      {inPreview && (
        <PreviewStrip
          firmId={firmId}
          label={isClientPreview ? "the client" : `${firmName} (lawyer view)`}
        />
      )}

      {/* Lawyer/operator tab nav. Hidden for client sessions: a client only
          reaches /m/[matterId] under this layout, and the tabs point at
          lawyer surfaces that reject client sessions anyway. Client preview
          hides it too, matching a real client's chrome. */}
      {!isClient && !isClientPreview && <PortalTabNav firmId={firmId} caseloadUnread={caseloadUnread} />}

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

  // Operator viewing a firm's portal keeps the full operator console rail on
  // the left at all times, exactly as in /admin. This is strictly operator
  // chrome: it renders only for role='operator', so firm lawyers and clients
  // never see it (their session takes the plain single-column branch below).
  if (isOperator && !inPreview) {
    return (
      <div className="flex min-h-screen bg-parchment">
        <AdminSidebar />
        {portalColumn}
      </div>
    );
  }

  return portalColumn;
}

/**
 * Visible at the top of every firm-scoped page when the viewer is an
 * operator (cross-firm session). Anchors the operator back to /admin so
 * they don't get lost in firm chrome.
 */
function OperatorViewingBanner({ firmName, firmId }: { firmName: string; firmId: string }) {
  return (
    <div className="bg-gold/15 border-b border-gold/30 px-4 sm:px-6 py-2 text-xs text-navy flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3">
      <span>
        <span className="uppercase tracking-wider font-bold mr-2">Operator view</span>
        Viewing {firmName} as the operator console.
      </span>
      <span className="flex items-center gap-4 whitespace-nowrap">
        <a
          href={`/api/portal/${firmId}/preview/enter?target=lawyer`}
          className="uppercase tracking-wider font-semibold text-navy/80 hover:text-navy underline underline-offset-2"
        >
          View as the firm
        </a>
        <a
          href="/admin/triage"
          className="uppercase tracking-wider font-semibold text-navy/80 hover:text-navy underline underline-offset-2"
        >
          Back to operator console
        </a>
      </span>
    </div>
  );
}
