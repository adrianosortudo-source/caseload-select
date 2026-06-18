/**
 * /admin/access
 *
 * Operator-only tool to grant and manage who can sign in to a firm's portal.
 * Pick a firm, see its members, add a person (which emails them a magic-link
 * invite), resend links, and remove or re-enable access.
 *
 * Auth: getOperatorSession() (also enforced by /admin/layout.tsx).
 */

import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listFirmMembers } from "@/lib/firm-members";
import FirmFilter from "@/components/admin/FirmFilter";
import NewFirmForm from "@/components/admin/NewFirmForm";
import MemberManager, { type MemberView } from "@/components/admin/MemberManager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ firm_id?: string }>;
}) {
  const session = await getOperatorSession();
  if (!session) {
    redirect("/portal/login?error=missing");
  }

  const { firm_id } = await searchParams;

  const { data: firmsRaw } = await supabase
    .from("intake_firms")
    .select("id, name")
    .order("name", { ascending: true })
    .returns<{ id: string; name: string | null }[]>();
  const firms = (firmsRaw ?? []).map((f) => ({ id: f.id, name: f.name ?? "(unnamed firm)" }));

  const selectedFirm = firm_id ? firms.find((f) => f.id === firm_id) ?? null : null;
  const members = selectedFirm ? await listFirmMembers(selectedFirm.id) : [];
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
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Portal access</h1>
        <p className="mt-1 text-sm text-black/60">
          Grant and manage who can sign in to a firm&apos;s portal.
        </p>
      </div>

      <div className="bg-white border border-black/10 p-4 flex items-center justify-between gap-3 flex-wrap">
        <FirmFilter action="/admin/access" firms={firms} active={firm_id ?? null} />
        {selectedFirm && (
          <a
            href={`/portal/${selectedFirm.id}/files`}
            title={`Open ${selectedFirm.name} portal`}
            className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold px-3 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors"
          >
            Open portal <span aria-hidden>↗</span>
          </a>
        )}
      </div>

      <NewFirmForm />

      {!selectedFirm ? (
        <div className="bg-white border border-black/8 px-6 py-10 text-center">
          <p className="text-sm text-black/60">Pick a firm above to manage its portal access.</p>
        </div>
      ) : (
        <MemberManager
          firmId={selectedFirm.id}
          firmName={selectedFirm.name}
          initialMembers={memberViews}
        />
      )}
    </div>
  );
}
