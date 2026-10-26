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
  "email.bounced", "email.complained", "email.unsubscribed", "email.suppressed", "email.opened", "email.clicked",
]);
const FOLLOWUP_MESSAGE_TAG = "agency_followup_message_id";
const FOLLOWUP_ENROLLMENT_TAG = "agency_followup_enrollment_id";

type JsonObject = Record<string, unknown>;
type ParsedAgencyFollowupTags =
  | { ok: true; messageId: string | null; enrollmentId: string | null }
  | { ok: false };

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && value.length <= 320 &&
    !/[\r\n\s<>]/.test(value) && /^[^@]+@[^@]+\.[^@]+$/.test(value);
}

function parseAgencyFollowupTags(value: unknown): ParsedAgencyFollowupTags {
  if (value === undefined) return { ok: true, messageId: null, enrollmentId: null };
  if (!isObject(value)) return { ok: false };

  const messageId = value[FOLLOWUP_MESSAGE_TAG];
  const enrollmentId = value[FOLLOWUP_ENROLLMENT_TAG];
  for (const tagValue of Object.values(value)) {
    if (typeof tagValue !== "string") return { ok: false };
  }
  if (messageId !== undefined && (typeof messageId !== "string" || !isCanonicalUuid(messageId))) {
    return { ok: false };
  }
  if (enrollmentId !== undefined && (typeof enrollmentId !== "string" || !isCanonicalUuid(enrollmentId))) {
    return { ok: false };
  }
  if ((messageId === undefined) !== (enrollmentId === undefined)) return { ok: false };

  return {
    ok: true,
    messageId: typeof messageId === "string" ? messageId : null,
    enrollmentId: typeof enrollmentId === "string" ? enrollmentId : null,
  };
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

/** JSON.parse otherwise silently keeps only the last duplicate object key. */
function hasDuplicateAgencyFollowupTagKey(rawBody: string): boolean {
  let cursor = 0;
  const skipWhitespace = () => {
    while (/\s/.test(rawBody[cursor] ?? "")) cursor += 1;
  };
  const readString = (): string => {
    const start = cursor;
    cursor += 1;
    while (cursor < rawBody.length) {
      if (rawBody[cursor] === "\\") {
        cursor += 2;
      } else if (rawBody[cursor] === '"') {
        cursor += 1;
        return JSON.parse(rawBody.slice(start, cursor)) as string;
      } else {
        cursor += 1;
      }
    }
    return "";
  };
  const isRelevantKey = (path: string[], key: string) =>
    (path.length === 0 && key === "data") ||
    (path.length === 1 && path[0] === "data" && key === "tags") ||
    (path.length === 2 && path[0] === "data" && path[1] === "tags" &&
      (key === FOLLOWUP_MESSAGE_TAG || key === FOLLOWUP_ENROLLMENT_TAG));

  const scanValue = (path: string[]): boolean => {
    skipWhitespace();
    if (rawBody[cursor] === "{") {
      cursor += 1;
      const seenRelevantKeys = new Set<string>();
      skipWhitespace();
      while (rawBody[cursor] !== "}") {
        const key = readString();
        if (isRelevantKey(path, key)) {
          if (seenRelevantKeys.has(key)) return true;
          seenRelevantKeys.add(key);
        }
        skipWhitespace();
        cursor += 1; // colon
        if (scanValue([...path, key])) return true;
        skipWhitespace();
        if (rawBody[cursor] === ",") {
          cursor += 1;
          skipWhitespace();
        } else {
          break;
        }
      }
      cursor += 1; // closing brace
      return false;
    }
    if (rawBody[cursor] === "[") {
      cursor += 1;
      skipWhitespace();
      while (rawBody[cursor] !== "]") {
        if (scanValue(path)) return true;
        skipWhitespace();
        if (rawBody[cursor] === ",") {
          cursor += 1;
          skipWhitespace();
        } else {
          break;
        }
      }
      cursor += 1; // closing bracket
      return false;
    }
    if (rawBody[cursor] === '"') {
      readString();
      return false;
    }
    while (cursor < rawBody.length && !/[\s,}\]]/.test(rawBody[cursor])) cursor += 1;
    return false;
  };

  return scanValue([]);
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
  if (hasDuplicateAgencyFollowupTagKey(rawBody)) {
    return noStore({ error: "invalid_message_tags" }, 400);
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
  const parsedTags = parseAgencyFollowupTags(data.tags);
  if (!parsedTags.ok) return noStore({ error: "invalid_message_tags" }, 400);
  if (event.type === "contact.updated" && parsedTags.messageId !== null) {
    return noStore({ error: "invalid_message_tags" }, 400);
  }

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
    recipientHash = agencyFollowupRecipientEmailHash(data.email);
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

  const result = event.type === "contact.updated"
    ? await supabaseAdmin.rpc("persist_agency_followup_resend_contact_event", {
      p_provider_event_id: svixId,
      p_occurred_at: occurredAt.toISOString(),
      p_recipient_email: recipientEmail,
      p_recipient_sha256: recipientHash as string,
    })
    : await supabaseAdmin.rpc("persist_agency_followup_resend_event", {
      p_provider_event_id: svixId,
      p_provider_message_id: providerMessageId,
      p_event_type: event.type,
      p_contact_status: contactStatus,
      p_occurred_at: occurredAt.toISOString(),
      p_recipient_email: recipientEmail,
      p_recipient_sha256: recipientHash,
      p_agency_followup_message_id: parsedTags.messageId,
      p_agency_followup_enrollment_id: parsedTags.enrollmentId,
    });
  if (result.error) {
    // Keep the response generic, but record the PostgreSQL error class for
    // server-side diagnosis without logging recipient or event contents.
    console.error("[agency-followup-webhook] persistence failure", { code: result.error.code ?? "unknown" });
    return noStore({ error: "event_persistence_failed" }, 500);
  }
  const outcome = isObject(result.data) && typeof result.data.result === "string" ? result.data.result : "recorded";
  // Resend retries non-2xx responses. An event can arrive before the sender
  // persists provider acceptance; allow a signed Agency event to be replayed
  // after acceptance is recorded. The webhook also receives shared Resend
  // traffic, so unmatched messages without the Agency identity pair must be
  // acknowledged instead of retried indefinitely.
  const hasAgencyFollowupIdentity = parsedTags.messageId !== null && parsedTags.enrollmentId !== null;
  if (outcome === "unmatched_message" && hasAgencyFollowupIdentity) {
    return noStore({ ok: false, outcome }, 503);
  }
  return noStore({ ok: true, outcome }, 200);
}
