/**
 * /admin/firms/[firmId]/messages
 *
 * Operator side of CaseLoad Connect: the direct line between CaseLoad and
 * this firm's lawyers. NOT the lawyer-to-client matter threads (those are
 * privileged and firm-private). Opening the page marks the channel read.
 */

import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listFirmMessages, markFirmChannelRead } from "@/lib/operator-firm-messaging";
import FirmChat, { type ChatMessage } from "@/components/messaging/FirmChat";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPERATOR_ACTOR = { role: "operator" as const, id: "operator", name: "CaseLoad" };

export default async function OperatorFirmMessagesPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const session = await getOperatorSession();
  if (!session) redirect("/portal/login?error=missing");

  const { firmId } = await params;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("name")
    .eq("id", firmId)
    .maybeSingle();
  const firmName = (firm?.name as string | null) ?? "this firm";

  const messages = (await listFirmMessages(firmId, { viewerParticipant: "operator" })) as ChatMessage[];
  await markFirmChannelRead(firmId, OPERATOR_ACTOR).catch(() => {});

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Messages</h1>
        <p className="mt-1 text-sm text-black/60">
          Your direct line with {firmName}. Clients never see this channel.
        </p>
      </div>

      <FirmChat
        apiBase={`/api/admin/firms/${firmId}/messages`}
        firmId={firmId}
        currentRole="operator"
        currentId="operator"
        counterpartLabel={firmName}
        initialMessages={messages}
      />
    </div>
  );
}
