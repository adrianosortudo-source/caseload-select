/**
 * /portal/[firmId]/messages
 *
 * Lawyer side of CaseLoad Connect: the firm's direct line with CaseLoad.
 * Firm-session gated (lawyers only). Operators are sent to their own
 * console-side surface. Clients are excluded by the page (the layout
 * hides the tab for them anyway).
 */

import { redirect } from "next/navigation";
import { getPortalSession, getFirmSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listFirmMessages, markFirmChannelRead } from "@/lib/operator-firm-messaging";
import FirmChat, { type ChatMessage } from "@/components/messaging/FirmChat";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FirmPortalMessagesPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  // Operators use the console-side channel; send them there.
  const portal = await getPortalSession();
  if (portal?.role === "operator") {
    redirect(`/admin/firms/${firmId}/messages`);
  }

  const session = await getFirmSession(firmId);
  if (!session) redirect(`/portal/${firmId}/login`);

  const lawyerId = session.lawyer_id ?? "lawyer";
  let lawyerName = "The firm";
  if (session.lawyer_id) {
    const { data } = await supabase
      .from("firm_lawyers")
      .select("display_name, email")
      .eq("id", session.lawyer_id)
      .maybeSingle();
    lawyerName =
      (data?.display_name as string | null) ?? (data?.email as string | null) ?? "The firm";
  }

  const messages = (await listFirmMessages(firmId, {
    viewerParticipant: lawyerId,
  })) as ChatMessage[];
  await markFirmChannelRead(firmId, {
    role: "lawyer",
    id: lawyerId,
    name: lawyerName,
  }).catch(() => {});

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">CaseLoad</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Messages</h1>
        <p className="mt-1 text-sm text-black/60">
          Your direct line with the CaseLoad team. This is separate from your client messages.
        </p>
      </div>

      <FirmChat
        apiBase={`/api/portal/${firmId}/messages`}
        currentRole="lawyer"
        currentId={lawyerId}
        counterpartLabel="CaseLoad"
        initialMessages={messages}
      />
    </div>
  );
}
