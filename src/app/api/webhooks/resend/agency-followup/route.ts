import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { agencyFollowupRecipientEmailHash } from "@/lib/agency-followup-domain";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;
const MESSAGE_EVENTS = new Set([
  "email.sent", "email.delivered", "email.delivery_delayed", "email.failed",
  "email.bounced", "email.complained", "email.unsubscribed", "email.opened", "email.clicked",
]);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && value.length <= 320 &&
    !/[\r\n\s<>]/.test(value) && /^[^@]+@[^@]+\.[^@]+$/.test(value);
}

function noStore(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function readRawBodyWithinLimit(req: Request): Promise<string | null> {
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Signed, minimized Resend event receiver for Agency CRM follow-up only. */
export async function POST(req: NextRequest) {
  const secret = process.env.AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return noStore({ error: "webhook_not_configured" }, 503);

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return noStore({ error: "payload_too_large" }, 413);
  const rawBody = await readRawBodyWithinLimit(req);
  if (rawBody === null) return noStore({ error: "payload_too_large" }, 413);

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return noStore({ error: "invalid_signature" }, 400);

  let event: unknown;
  try {
    // Svix 2.x validates authenticity but intentionally returns undefined.
    // Parse only after successful verification so untrusted content is never
    // interpreted before its signature is checked.
    new Webhook(secret).verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return noStore({ error: "invalid_signature" }, 400);
  }
  try {
    event = JSON.parse(rawBody) as unknown;
  } catch {
    return noStore({ error: "invalid_event" }, 400);
  }
  if (!isObject(event) || typeof event.type !== "string" || !isObject(event.data) || typeof event.created_at !== "string") {
    return noStore({ error: "invalid_event" }, 400);
  }
  const occurredAt = new Date(event.created_at);
  if (!Number.isFinite(occurredAt.getTime())) return noStore({ error: "invalid_event_time" }, 400);

  const data = event.data;
  let providerMessageId: string | null = null;
  let recipientEmail: string;
  let recipientHash: string | null;
  let contactStatus: string | null = null;

  if (event.type === "contact.updated") {
    if (data.unsubscribed !== true && data.status !== "unsubscribed") {
      return noStore({ ok: true, ignored: true }, 202);
    }
    if (!validEmail(data.email)) return noStore({ error: "invalid_contact_event" }, 400);
    recipientEmail = data.email;
    recipientHash = null;
    contactStatus = "unsubscribed";
  } else if (MESSAGE_EVENTS.has(event.type)) {
    if (typeof data.email_id !== "string" || data.email_id.trim() !== data.email_id ||
        data.email_id.length < 1 || data.email_id.length > 500) {
      return noStore({ error: "invalid_message_event" }, 400);
    }
    const recipients = Array.isArray(data.to) ? data.to : [data.to];
    if (recipients.length !== 1 || !validEmail(recipients[0])) {
      return noStore({ error: "single_recipient_required" }, 400);
    }
    providerMessageId = data.email_id;
    recipientEmail = recipients[0];
    recipientHash = agencyFollowupRecipientEmailHash(recipientEmail);
  } else {
    return noStore({ ok: true, ignored: true }, 202);
  }

  const result = await supabaseAdmin.rpc("persist_agency_followup_resend_event", {
    p_provider_event_id: svixId,
    p_provider_message_id: providerMessageId,
    p_event_type: event.type,
    p_contact_status: contactStatus,
    p_occurred_at: occurredAt.toISOString(),
    p_recipient_email: recipientEmail,
    p_recipient_sha256: recipientHash,
  });
  if (result.error) {
    // Keep the response generic, but record the PostgreSQL error class for
    // server-side diagnosis without logging recipient or event contents.
    console.error("[agency-followup-webhook] persistence failure", { code: result.error.code ?? "unknown" });
    return noStore({ error: "event_persistence_failed" }, 500);
  }
  const outcome = isObject(result.data) && typeof result.data.result === "string" ? result.data.result : "recorded";
  // Resend retries non-2xx responses. An event can arrive before the sender
  // persists provider acceptance; allow the same signed event to be replayed
  // after acceptance is recorded instead of permanently deduping it as lost.
  if (outcome === "unmatched_message") return noStore({ ok: false, outcome }, 503);
  return noStore({ ok: true, outcome }, 200);
}
