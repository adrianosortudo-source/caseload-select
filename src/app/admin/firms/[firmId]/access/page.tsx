/**
 * /admin/firms/[firmId]/access
 *
 * Firm-scoped portal access management. firmId from URL segment. Auth
 * enforced by /admin/layout.tsx.
 */

import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listFirmMembers } from "@/lib/firm-members";
import MemberManager, { type MemberView } from "@/components/admin/MemberManager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FirmAccessPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const session = await getOperatorSession();
  if (!session) redirect("/portal/login?error=missing");

  const { firmId } = await params;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name")
    .eq("id", firmId)
    .maybeSingle();

  const firmName = (firm?.name as string | null) ?? "(unknown firm)";
  const members = await listFirmMembers(firmId);
  const memberViews: MemberView[] = members.map((m) => ({
    id: m.id,
    email: m.email,
    role: m.role,
    display_name: m.display_name,
    title: m.title,
    disabled: m.disabled,
    invitation_sent_at: m.invitation_sent_at,
    last_signed_in_at: m.last_signed_in_at,
    created_at: m.created_at,
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Portal access</h1>
        <p className="mt-1 text-sm text-black/60">
          {firmName}: grant and manage who can sign in to this firm&apos;s portal.
        </p>
      </div>

      <div className="bg-white border border-border-brand p-4 flex items-center justify-between gap-3 flex-wrap">
        <a
          href={`/portal/${firmId}/files`}
          title={`Open ${firmName} portal`}
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold px-3 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors"
        >
          Open portal <span aria-hidden>&#8599;</span>
        </a>
      </div>

      <MemberManager
        firmId={firmId}
        firmName={firmName}
        initialMembers={memberViews}
      />
    </div>
  );
}
