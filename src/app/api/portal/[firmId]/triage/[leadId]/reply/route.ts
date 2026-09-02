/**
 * POST /api/portal/[firmId]/triage/[leadId]/reply
 *
 * Sends one operator-authored reply to a Meta-channel lead. The request may
 * provide only the message body and an idempotency UUID. Channel, Meta asset,
 * recipient, lead ownership, reply-window evidence, and actor identity are all
 * resolved server-side.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  loadChannelConversation,
  validateChannelText,
  type ChannelConversation,
  type ChannelConversationMessage,
  type ConversationChannel,
} from "@/lib/channel-conversation";
import {
  sendChannelMessage,
  type ChannelSendResult,
} from "@/lib/channel-send";
import type { ChannelSender } from "@/lib/channel-intake-processor";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LeadRow {
  id: string;
  lead_id: string;
  firm_id: string;
  slot_answers: unknown;
}

type JsonObject = Record<string, unknown>;

const ALLOWED_BODY_FIELDS = new Set(["body", "client_request_id"]);

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveSender(slotAnswersValue: unknown): ChannelSender | null {
  const slotAnswers = asObject(slotAnswersValue);
  const channel = slotAnswers?.channel;

  if (channel === "facebook") {
    const meta = asObject(slotAnswers?.messenger_meta);
    const pageId = nonEmptyString(meta?.page_id);
    const senderPsid = nonEmptyString(meta?.sender_psid);
    if (!pageId || !senderPsid) return null;
    return {
      channel,
      pageId,
      senderPsid,
      senderName: nonEmptyString(meta?.sender_name),
      messageMid: nonEmptyString(meta?.message_mid) ?? "server-resolved",
    };
  }

  if (channel === "instagram") {
    const meta = asObject(slotAnswers?.instagram_meta);
    const igBusinessAccountId = nonEmptyString(meta?.ig_business_account_id);
    const senderIgsid = nonEmptyString(meta?.sender_igsid);
    if (!igBusinessAccountId || !senderIgsid) return null;
    return {
      channel,
      igBusinessAccountId,
      senderIgsid,
      senderName: nonEmptyString(meta?.sender_name),
      messageMid: nonEmptyString(meta?.message_mid) ?? "server-resolved",
    };
  }

  if (channel === "whatsapp") {
    const meta = asObject(slotAnswers?.whatsapp_meta);
    const phoneNumberId = nonEmptyString(meta?.phone_number_id);
    const senderWaId = nonEmptyString(meta?.sender_wa_id);
    if (!phoneNumberId || !senderWaId) return null;
    return {
      channel,
      phoneNumberId,
      senderWaId,
      senderName: nonEmptyString(meta?.sender_name),
      messageMid: nonEmptyString(meta?.message_mid) ?? "server-resolved",
      displayPhoneNumber: nonEmptyString(meta?.display_phone_number),
    };
  }

  return null;
}

function terminalMessageForRequest(
  conversation: ChannelConversation,
  clientRequestId: string,
): ChannelConversationMessage | null {
  return (
    conversation.messages.find(
      (message) =>
        message.clientRequestId === clientRequestId &&
        (message.status === "sent" || message.status === "failed"),
    ) ?? null
  );
}

function sendFailureStatus(result: ChannelSendResult): number {
  switch (result.code) {
    case "validation_failed":
      return 400;
    case "lead_not_found":
      return 404;
    case "reply_window_closed":
      return 409;
    case "duplicate_request":
      return 409;
    case "delivery_unknown":
    case "request_in_progress":
      return 409;
    case "ledger_unavailable":
      return 503;
    default:
      return 502;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; leadId: string }> },
) {
  const { firmId, leadId } = await params;
  const session = await getPortalSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    session.role === "client" ||
    (session.role !== "operator" && session.firm_id !== firmId)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorId = nonEmptyString(session.lawyer_id);
  if (!actorId || !UUID_PATTERN.test(actorId)) {
    return NextResponse.json(
      {
        error:
          "Sign in again before sending a reply so this action can be attributed to your member account.",
        code: "reauth_required",
      },
      { status: 403 },
    );
  }

  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = asObject(parsed);
  if (!input || Object.keys(input).some((key) => !ALLOWED_BODY_FIELDS.has(key))) {
    return NextResponse.json(
      { error: "Request body may contain only body and client_request_id" },
      { status: 400 },
    );
  }

  const text = typeof input.body === "string" ? input.body.trim() : "";
  const clientRequestId =
    typeof input.client_request_id === "string" ? input.client_request_id : "";
  if (!UUID_PATTERN.test(clientRequestId)) {
    return NextResponse.json(
      { error: "client_request_id must be a UUID" },
      { status: 400 },
    );
  }
  if (!text) {
    return NextResponse.json({ error: "message text is required" }, { status: 400 });
  }

  const { data, error: leadError } = await supabase
    .from("screened_leads")
    .select("id, lead_id, firm_id, slot_answers")
    .eq("lead_id", leadId)
    .eq("firm_id", firmId)
    .maybeSingle();

  if (leadError) {
    return NextResponse.json({ error: "Unable to load lead" }, { status: 500 });
  }
  if (!data || data.firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const lead = data as LeadRow;
  const sender = resolveSender(lead.slot_answers);
  if (!sender) {
    return NextResponse.json(
      { error: "This lead does not have a supported reply channel" },
      { status: 422 },
    );
  }

  const validation = validateChannelText(sender.channel as ConversationChannel, text);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.reason ?? "Invalid message" },
      { status: 400 },
    );
  }

  let beforeSend: ChannelConversation | null;
  try {
    beforeSend = await loadChannelConversation({
      firmId,
      screenedLeadId: lead.id,
    });
  } catch {
    return NextResponse.json(
      {
        error: "Conversation history is unavailable",
        code: "ledger_unavailable",
      },
      { status: 503 },
    );
  }

  if (!beforeSend) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A retry must resolve to its original terminal event even if the reply
  // window closed after the first request reached Meta.
  const existingMessage = terminalMessageForRequest(beforeSend, clientRequestId);
  if (existingMessage?.status === "sent") {
    return NextResponse.json({
      message: existingMessage,
      replyWindow: beforeSend.replyWindow,
    });
  }
  if (existingMessage?.status === "failed") {
    return NextResponse.json(
      {
        error: existingMessage.failureReason ?? "The reply could not be sent",
        message: existingMessage,
        replyWindow: beforeSend.replyWindow,
      },
      { status: 502 },
    );
  }

  if (!beforeSend.replyWindow.isOpen) {
    return NextResponse.json(
      {
        error:
          beforeSend.replyWindow.reason === "no_authoritative_inbound"
            ? "Replying requires an authoritative inbound message"
            : "The 24-hour reply window is closed",
        replyWindow: beforeSend.replyWindow,
      },
      { status: 409 },
    );
  }

  const actorType = session.role === "operator" ? "operator" : "lawyer";

  const sendResult = await sendChannelMessage({
    firmId,
    sender,
    text,
    ledger: {
      screenedLeadId: lead.id,
      source: "operator",
      actorType,
      actorId,
      clientRequestId,
      requireOpenWindow: true,
    },
  });

  let conversation: ChannelConversation | null;
  try {
    conversation = await loadChannelConversation({
      firmId,
      screenedLeadId: lead.id,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Delivery is not yet verified. Keep this draft unchanged and retry it. Do not create a new message.",
        code: "delivery_unknown",
        deliveryUnknown: true,
      },
      { status: 409 },
    );
  }
  if (!conversation) {
    return NextResponse.json(
      {
        error:
          "Delivery is not yet verified. Keep this draft unchanged and retry it. Do not create a new message.",
        code: "delivery_unknown",
        deliveryUnknown: true,
      },
      { status: 409 },
    );
  }

  const message = terminalMessageForRequest(conversation, clientRequestId);
  if (sendResult.sent && message?.status === "sent") {
    return NextResponse.json({ message, replyWindow: conversation.replyWindow });
  }

  if (
    !message &&
    (sendResult.code === "delivery_unknown" ||
      sendResult.code === "request_in_progress" ||
      sendResult.code === "duplicate_request")
  ) {
    return NextResponse.json(
      {
        error:
          "Delivery is not yet verified. Keep this draft unchanged and retry it. Do not create a new message.",
        code: sendResult.code,
        deliveryUnknown: true,
        replyWindow: conversation.replyWindow,
      },
      { status: 409 },
    );
  }

  const error =
    message?.failureReason ?? sendResult.reason ?? "The reply could not be sent";
  return NextResponse.json(
    {
      error,
      ...(sendResult.code ? { code: sendResult.code } : {}),
      ...(message ? { message } : {}),
      replyWindow: conversation.replyWindow,
    },
    { status: sendFailureStatus(sendResult) },
  );
}
