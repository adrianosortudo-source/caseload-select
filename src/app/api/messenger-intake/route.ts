/**
 * /api/messenger-intake
 *
 * Webhook receiver for Facebook Messenger intake. Per CaseLoad Screen
 * channels-as-input architecture (CRM Bible DR-022): Meta posts an
 * incoming Messenger message here, the screen engine processes it
 * exactly like every other channel, the resulting brief lands in
 * `screened_leads` with `channel='facebook_messenger'`.
 *
 * Two HTTP methods.
 *
 *   GET  — Meta's webhook verification challenge. Configured in the Meta
 *          developer console; called once when the webhook URL is first
 *          registered. Echoes back hub.challenge if hub.verify_token
 *          matches META_MESSENGER_VERIFY_TOKEN.
 *
 *   POST — Incoming message event from Meta. Body is signed with the
 *          app secret (X-Hub-Signature-256 header). Must verify before
 *          processing or anyone can post fake events.
 *
 * Status: production-wired (Block 2 of Meta App Review prep, 2026-05-14).
 * HMAC verification + Meta verification challenge run inline. Engine
 * integration runs the screen engine on the inbound text via
 * `lib/channel-intake-processor`, builds the brief, persists to
 * screened_leads, fires the new-lead notification. The receiver ACKs 200
 * within ~1-2s and runs the engine in `waitUntil` so Meta does not
 * retry on the 5-15s LLM call. Multi-turn follow-up via the Messenger
 * Send API is out of scope until App Review approves pages_messaging.
 *
 * Env vars:
 *   META_APP_SECRET            App Secret from the Meta developer console.
 *                              Same secret signs Messenger + IG + WhatsApp.
 *   META_MESSENGER_VERIFY_TOKEN A string the operator picks and configures
 *                               on both sides (Meta console + this env).
 *                               Anything random and long is fine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import {
  verifyMetaSignature,
  handleVerificationChallenge,
} from '@/lib/meta-webhook-auth';
import { resolveFirmByFacebookPageId } from '@/lib/firm-resolver';
import {
  processChannelInbound,
  type MessengerSender,
} from '@/lib/channel-intake-processor';

const APP_SECRET = process.env.META_APP_SECRET ?? '';
const VERIFY_TOKEN = process.env.META_MESSENGER_VERIFY_TOKEN ?? '';

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

interface MessengerEntry {
  id: string;
  time: number;
  messaging?: Array<{
    sender: { id: string };
    recipient: { id: string };
    timestamp: number;
    message?: {
      mid: string;
      text?: string;
      attachments?: Array<{ type: string; payload: { url?: string } }>;
    };
  }>;
}

interface MessengerWebhookPayload {
  object: 'page';
  entry: MessengerEntry[];
}

export async function POST(req: NextRequest) {
  // Read the body as raw text — HMAC verification requires byte-exact
  // input. Parsing first would re-serialise and break the hash.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('x-hub-signature-256');

  const verified = verifyMetaSignature({
    rawBody,
    signatureHeader,
    appSecret: APP_SECRET,
  });

  if (!verified.valid) {
    console.warn('[messenger-intake] signature rejected:', verified.reason);
    return NextResponse.json(
      { ok: false, error: 'signature verification failed' },
      { status: 401 }
    );
  }

  let payload: MessengerWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MessengerWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  // Meta sometimes posts non-message events (delivery receipts, read
  // receipts, postbacks). Only the `messaging[].message.text` shape is
  // relevant for our intake; everything else returns 200 quickly so Meta
  // keeps the subscription active.
  const messageEvents: Array<{
    pageId: string;
    senderId: string;
    text: string;
    timestamp: number;
    mid: string;
  }> = [];

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const text = event.message?.text;
      const mid = event.message?.mid;
      if (text && mid) {
        messageEvents.push({
          pageId: entry.id,
          senderId: event.sender.id,
          text,
          timestamp: event.timestamp,
          mid,
        });
      }
    }
  }

  // Engine integration. For each inbound message event:
  //   1. Resolve pageId → firm via intake_firms.facebook_page_id (unique).
  //   2. Run the channel-intake-processor in waitUntil so Meta gets a
  //      fast 200 ACK (within ~1-2s) while the engine + LLM work (5-15s)
  //      runs in the background.
  //   3. If no firm matches the Page ID, log a warning and drop the
  //      event. Meta delivers events for any Page the App is connected
  //      to, including Pages we have not mapped to a firm yet.
  //
  // Multi-turn conversational follow-up (sending a Question back via the
  // Messenger Send API) is out of scope for the App Review demo and lands
  // in a separate `channel-send` patch.
  if (messageEvents.length > 0) {
    console.log(
      '[messenger-intake] received',
      messageEvents.length,
      'message event(s):',
      messageEvents.map((e) => ({
        page: e.pageId,
        sender: e.senderId,
        preview: e.text.slice(0, 80),
      })),
    );

    for (const event of messageEvents) {
      // Resolve at the route boundary so we can decide whether to enqueue
      // engine work or drop the event cleanly. This is one DB roundtrip;
      // the heavy work (engine + LLM + insert) runs in waitUntil below.
      const firm = await resolveFirmByFacebookPageId(event.pageId);
      if (!firm) {
        console.warn(
          `[messenger-intake] no firm mapped to facebook_page_id=${event.pageId}; dropping mid=${event.mid}`,
        );
        continue;
      }

      const sender: MessengerSender = {
        channel: 'facebook',
        senderPsid: event.senderId,
        senderName: null, // Messenger inbound has no profile name; would
        // require a Graph API call with the Page token.
        messageMid: event.mid,
        pageId: event.pageId,
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
                `[messenger-intake] persisted lead=${res.leadId} firm=${firm.firmName} status=${res.status} band=${res.band ?? '-'}`,
              );
            } else {
              console.warn(
                `[messenger-intake] not persisted firm=${firm.firmName} reason=${res.reason ?? 'unknown'}`,
              );
            }
          })
          .catch((err) => {
            console.error(
              `[messenger-intake] processChannelInbound threw firm=${firm.firmName} mid=${event.mid}:`,
              err,
            );
          }),
      );
    }
  }

  // Meta requires 200 within ~20 seconds or the subscription gets
  // disabled. We ACK now; engine work runs in waitUntil above.
  return NextResponse.json({ ok: true });
}
