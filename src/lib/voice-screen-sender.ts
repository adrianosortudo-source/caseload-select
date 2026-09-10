import "server-only";
import { hashToken, tokenForNonce } from "./voice-screen-live";
import { database, liveConfig, type Inquiry } from "./voice-screen-store";

const API = "https://services.leadconnectorhq.com";
export function senderConfig() {
  const token = process.env.V2S_GHL_SMS_TOKEN;
  const name = process.env.V2S_SENDER_NAME?.trim();
  const recipients = (process.env.V2S_TEST_RECIPIENTS ?? "").split(",").map(s => s.trim()).filter(s => /^\+[1-9]\d{7,14}$/.test(s));
  if (process.env.V2S_SMS_ENABLED !== "true" || !token || !name || name.length > 100 || !recipients.length) return null;
  return { token, name, recipients };
}

/** One durable dispatch attempt. Ambiguous outcomes are never auto-retried. */
export async function dispatchInvitation(inquiryId: string) {
  const config = liveConfig(); const sender = senderConfig();
  if (!config || !sender) return { status: "disabled" };
  const db = await database();
  // Check allowlisted scope and recipient before claiming or reaching provider.
  const { data: initial, error: readError } = await db.from("voice_screen_inquiries").select("*").eq("id", inquiryId).eq("firm_id", config.firmId).eq("location_id", config.locationId).eq("agent_id", config.agentId).maybeSingle();
  if (readError) throw new Error("dispatch_unavailable");
  if (!initial || !sender.recipients.includes((initial as Inquiry).caller_facts.callback.number)) return { status: "not_allowlisted" };
  const { data: claim, error } = await db.rpc("v2s_claim", { p_id: inquiryId });
  if (error) throw new Error("dispatch_unavailable");
  if (!claim?.claimed) return { status: "not_pending" };
  const inquiry = { ...initial, ...claim, id: claim.inquiry_id } as Inquiry;
  const outboxId = claim.outbox_id as string;
  async function finish(status: "sent" | "unknown" | "cancelled", providerId: string | null = null) {
    const { data: saved, error: finishError } = await db.rpc("v2s_finish_dispatch", {
      p_id: outboxId,
      p_status: status,
      p_provider_id: providerId,
      p_error: status === "sent" ? null : `provider_${status}`,
    });
    if (finishError || saved !== true) throw new Error("dispatch_reconciliation_required");
    return { status };
  }
  try {
    const token = tokenForNonce(inquiry.token_nonce, config.key);
    if (hashToken(token) !== inquiry.token_hash || Date.parse(inquiry.expires_at) <= Date.now()) return finish("cancelled");
    const headers = { Authorization: `Bearer ${sender.token}`, Version: "2021-07-28", "Content-Type": "application/json" };
    const contactResponse = await fetch(`${API}/contacts/${encodeURIComponent(inquiry.contact_id)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!contactResponse.ok) return finish("cancelled");
    const contactBody = await contactResponse.json() as { contact?: { locationId?: string; phone?: string; dnd?: boolean; dndSettings?: { SMS?: { status?: string } } } };
    const contact = contactBody.contact;
    if (!contact || contact.locationId !== config.locationId || contact.dnd !== false || contact.dndSettings?.SMS?.status === "active" || contact.phone?.replace(/[^\d+]/g, "") !== inquiry.caller_facts.callback.number) return finish("cancelled");
    // Recheck takeover/expiry/permission after provider read, immediately before send.
    const { data: latest } = await db.from("voice_screen_inquiries").select("human_status,status,invitation_eligible,expires_at").eq("id", inquiry.id).maybeSingle();
    if (!latest || latest.human_status !== "pending" || latest.status === "stopped" || !latest.invitation_eligible || Date.parse(latest.expires_at) <= Date.now()) return finish("cancelled");
    const link = `${config.origin}/widget/voice-continuation#${token}`;
    const message = `Thanks for calling ${sender.name}. Here is the link we discussed to help our team prepare: ${link} You can skip questions. Please avoid confidential details or documents. Reply STOP to opt out.`;
    const response = await fetch(`${API}/conversations/messages`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "SMS", contactId: inquiry.contact_id, message }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return finish("unknown");
    const result = await response.json() as { messageId?: string };
    return result.messageId ? finish("sent", result.messageId) : finish("unknown");
  } catch { return finish("unknown"); }
}
