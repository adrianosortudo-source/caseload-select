/**
 * /api/whatsapp-intake
 *
 * Webhook receiver for WhatsApp Cloud API intake. Per CaseLoad Screen
 * channels-as-input architecture (CRM Bible DR-022): Meta posts an
 * incoming WhatsApp message here, the screen engine processes it
 * exactly like every other channel, the resulting brief lands in
 * `screened_leads` with `channel='whatsapp'`.
 *
 * Two HTTP methods.
 *
 *   GET  - Meta's webhook verification challenge. Configured in the Meta
 *          developer console; called once when the webhook URL is first
 *          registered. Echoes back hub.challenge if hub.verify_token
 *          matches META_WHATSAPP_VERIFY_TOKEN.
 *
 *   POST - Incoming message event from Meta. Body is signed with the
 *          app secret (X-Hub-Signature-256 header). Must verify before
 *          processing or anyone can post fake events.
 *
 * Status: production-wired (Block 2 of Meta App Review prep, 2026-05-14).
 * HMAC verification + verification challenge run inline. Engine
 * integration runs via `lib/channel-intake-processor`. The receiver ACKs
 * 200 within ~1-2s and runs the engine in `waitUntil`. Non-text inbound
 * (image/audio/document) and statuses-only payloads (delivery receipts)
 * are logged but not processed — text is the only intake input shape.
 *
 * Channel shape (different from Messenger/IG, which both use the
 * messaging[] envelope):
 *
 *   { object: 'whatsapp_business_account',
 *     entry: [
 *       { id: <waba_id>,
 *         changes: [
 *           { value: { messaging_product: 'whatsapp',
 *                     metadata: { phone_number_id, display_phone_number },
 *                     contacts: [{ wa_id, profile }],
 *                     messages: [{ from, id, timestamp, text: { body } }] },
 *             field: 'messages' },
 *         ] },
 *     ] }
 *
 * Env vars:
 *   META_APP_SECRET             App Secret from the Meta developer console.
 *                               Same secret signs Messenger + IG + WhatsApp.
 *   META_WHATSAPP_VERIFY_TOKEN  A string the operator picks and configures
 *                               on both sides (Meta console + this env).
 *                               Set in Block 2 Phase 6 alongside the WABA
 *                               webhook configuration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import {
  verifyMetaSignature,
  handleVerificationChallenge,
} from '@/lib/meta-webhook-auth';
import { resolveFirmByWhatsappPhoneNumberId } from '@/lib/firm-resolver';
import {
  processChannelInbound,
  type WhatsAppSender,
} from '@/lib/channel-intake-processor';

const APP_SECRET = process.env.META_APP_SECRET ?? '';
const VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN ?? '';

// ── GET: Meta verification challenge ────────────────────────────────────

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const result = handleVerificationChallenge({
    searchParams: url.searchParams,
    expectedVerifyToken: VERIFY_TOKEN,
  });

  if (!result.ok) {
    return new NextResponse(result.reason, { status: 403 });
  }

  // Meta expects plain-text echo of hub.challenge.
  return new NextResponse(result.challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

// ── POST: incoming message event ────────────────────────────────────────

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type?: string;
  text?: { body: string };
  // Other types (image, document, audio, video, location, contacts, button,
  // interactive, sticker) are received but not processed until engine
  // wiring lands in Block 2.
}

interface WhatsAppContact {
  wa_id: string;
  profile?: { name?: string };
}

interface WhatsAppStatus {
  id: string;
  recipient_id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

interface WhatsAppChange {
  value: {
    messaging_product: 'whatsapp';
    metadata: { phone_number_id: string; display_phone_number: string };
    contacts?: WhatsAppContact[];
    messages?: WhatsAppMessage[];
    statuses?: WhatsAppStatus[];
  };
  field: 'messages';
}

interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: WhatsAppEntry[];
}

export async function POST(req: NextRequest) {
  // Read the body as raw text - HMAC verification requires byte-exact
  // input. Parsing first would re-serialise and break the hash.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('x-hub-signature-256');

  const verified = verifyMetaSignature({
    rawBody,
    signatureHeader,
    appSecret: APP_SECRET,
  });

  if (!verified.valid) {
    console.warn('[whatsapp-intake] signature rejected:', verified.reason);
    return NextResponse.json(
      { ok: false, error: 'signature verification failed' },
      { status: 401 },
    );
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  // WhatsApp posts three kinds of payloads:
  //   - messages: inbound user message we should process for intake
  //   - statuses: delivery receipts on our outbound (sent/delivered/read)
  //   - errors:   message-send failures (under statuses[].errors)
  //
  // Only `messages` are relevant for intake; everything else returns 200
  // quickly so Meta keeps the subscription active.
  const messageEvents: Array<{
    wabaId: string;
    phoneNumberId: string;
    senderWaId: string;
    senderName: string | null;
    text: string;
    timestamp: string;
    mid: string;
    messageType: string;
  }> = [];

  const statusEvents: Array<{
    wabaId: string;
    mid: string;
    recipient: string;
    status: string;
    error: { code: number; title: string } | null;
  }> = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const val = change.value;
      const contactByWaId = new Map(
        (val.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null] as const),
      );
      for (const m of val.messages ?? []) {
        const text = m.text?.body;
        if (text) {
          messageEvents.push({
            wabaId: entry.id,
            phoneNumberId: val.metadata.phone_number_id,
            senderWaId: m.from,
            senderName: contactByWaId.get(m.from) ?? null,
            text,
            timestamp: m.timestamp,
            mid: m.id,
            messageType: m.type ?? 'text',
          });
        } else if (m.type && m.type !== 'text') {
          // Non-text inbound (image, document, voice, etc.) — log for now
          // so we can size the build later without scaffolding the
          // full media-fetch path tonight.
          console.log(
            `[whatsapp-intake] non-text inbound type=${m.type} from=${m.from} mid=${m.id}`,
          );
        }
      }
      for (const s of val.statuses ?? []) {
        statusEvents.push({
          wabaId: entry.id,
          mid: s.id,
          recipient: s.recipient_id,
          status: s.status,
          error: s.errors?.[0]
            ? { code: s.errors[0].code, title: s.errors[0].title }
            : null,
        });
      }
    }
  }

  if (messageEvents.length > 0) {
    console.log(
      '[whatsapp-intake] received',
      messageEvents.length,
      'message event(s):',
      messageEvents.map((e) => ({
        waba: e.wabaId,
        phone: e.phoneNumberId,
        from: e.senderWaId,
        name: e.senderName,
        type: e.messageType,
        preview: e.text.slice(0, 80),
      })),
    );

    // Engine integration. For each inbound text message:
    //   1. Resolve phoneNumberId → firm via
    //      intake_firms.whatsapp_phone_number_id (unique).
    //   2. Run channel-intake-processor in waitUntil. Meta gets a fast
    //      200 ACK while the engine + LLM work runs in the background.
    //   3. If no firm matches, log and drop.
    //
    // Multi-turn follow-up via the Cloud API Send endpoint
    // (POST /<phone-number-id>/messages) is out of scope for the App
    // Review demo. Single-shot brief generation from the first inbound
    // message is enough for the reviewer to see a lead appear in triage.
    for (const event of messageEvents) {
      // Only process inbound text (we logged non-text inbound above).
      if (event.messageType !== 'text') continue;

      const firm = await resolveFirmByWhatsappPhoneNumberId(event.phoneNumberId);
      if (!firm) {
        console.warn(
          `[whatsapp-intake] no firm mapped to whatsapp_phone_number_id=${event.phoneNumberId}; dropping mid=${event.mid}`,
        );
        continue;
      }

      const sender: WhatsAppSender = {
        channel: 'whatsapp',
        senderWaId: event.senderWaId,
        senderName: event.senderName,
        messageMid: event.mid,
        phoneNumberId: event.phoneNumberId,
        displayPhoneNumber: null,
      };

      waitUntil(
        processChannelInbound({
          firmId: firm.firmId,
          text: event.text,
          sender,
        })
          .then((res) => {
            if (res.persisted) {
              console.log(
                `[whatsapp-intake] persisted lead=${res.leadId} firm=${firm.firmName} status=${res.status} band=${res.band ?? '-'}`,
              );
            } else {
              console.warn(
                `[whatsapp-intake] not persisted firm=${firm.firmName} reason=${res.reason ?? 'unknown'}`,
              );
            }
          })
          .catch((err) => {
            console.error(
              `[whatsapp-intake] processChannelInbound threw firm=${firm.firmName} mid=${event.mid}:`,
              err,
            );
          }),
      );
    }
  }

  if (statusEvents.length > 0) {
    // Log failures explicitly — Meta uses status=failed to signal template
    // / 24-hour-window / rate-limit problems on our outbound. Once the
    // outbound path is wired we want these surfaced in /admin/health.
    const failures = statusEvents.filter((s) => s.status === 'failed');
    if (failures.length > 0) {
      console.warn('[whatsapp-intake] outbound failures:', failures);
    } else {
      console.log(
        '[whatsapp-intake] status events:',
        statusEvents.map((s) => `${s.mid}=${s.status}`).join(' '),
      );
    }
  }

  // Meta requires 200 within ~20 seconds or the subscription gets
  // disabled. Acknowledge first; engine work runs async via waitUntil
  // when wired in Block 2.
  return NextResponse.json({ ok: true });
}
