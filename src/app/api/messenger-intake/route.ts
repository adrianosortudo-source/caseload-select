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
 * Status: scaffold. HMAC verification + Meta verification challenge are
 * complete and production-grade. Engine integration (running the screen
 * engine on the inbound text, building the brief, persisting to
 * screened_leads, firing the new-lead notification) is stubbed pending
 * Meta App Review approval — the receiver MUST exist and respond
 * correctly before App Review can be submitted, but the downstream
 * processing won't fire real leads until Meta grants the elevated
 * permissions. Stub returns 200 to acknowledge receipt (Meta requires
 * fast 200s; anything else gets the webhook subscription disabled).
 *
 * Env vars:
 *   META_APP_SECRET            App Secret from the Meta developer console.
 *                              Same secret signs Messenger + IG + WhatsApp.
 *   META_MESSENGER_VERIFY_TOKEN A string the operator picks and configures
 *                               on both sides (Meta console + this env).
 *                               Anything random and long is fine.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyMetaSignature,
  handleVerificationChallenge,
} from '@/lib/meta-webhook-auth';

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

  // STUB: log the inbound messages for now. Engine integration lands once
  // Meta App Review approves the pages_messaging permission. Until then,
  // we acknowledge receipt and let the events drain.
  if (messageEvents.length > 0) {
    console.log(
      '[messenger-intake] received',
      messageEvents.length,
      'message event(s):',
      messageEvents.map((e) => ({
        page: e.pageId,
        sender: e.senderId,
        preview: e.text.slice(0, 80),
      }))
    );
    // TODO (post App Review approval):
    //   1. Resolve pageId → firmId via intake_firms.branding or a new
    //      firm_facebook_pages table.
    //   2. Initialise the screen engine with channel='facebook_messenger'.
    //   3. Feed the inbound text through extraction + slot evidence + LLM.
    //   4. Build the brief HTML and JSON.
    //   5. Insert into screened_leads with channel='facebook_messenger'.
    //   6. Fire the new-lead notification email.
    //   7. Send the lawyer-determined reply back via Meta's Send API.
  }

  // Meta requires 200 within ~20 seconds or the subscription gets
  // disabled. Acknowledge first, do work async via waitUntil when wired.
  return NextResponse.json({ ok: true });
}
