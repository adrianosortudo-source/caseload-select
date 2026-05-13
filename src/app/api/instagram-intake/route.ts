/**
 * /api/instagram-intake
 *
 * Webhook receiver for Instagram DM intake. Per CaseLoad Screen
 * channels-as-input architecture (CRM Bible DR-022): Meta posts an
 * incoming Instagram DM here, the screen engine processes it exactly
 * like every other channel, the resulting brief lands in screened_leads
 * with channel='instagram_dm'.
 *
 * Two HTTP methods.
 *
 *   GET  — Meta's webhook verification challenge. Echoes back hub.challenge
 *          if hub.verify_token matches META_INSTAGRAM_VERIFY_TOKEN. Called
 *          once when the webhook URL is first registered in the Meta
 *          developer console.
 *
 *   POST — Incoming message event from Meta. Body is signed with the
 *          app secret (X-Hub-Signature-256). Must verify before processing.
 *
 * Status: scaffold. HMAC verification + Meta verification challenge are
 * production-grade. Engine integration is stubbed pending Meta App Review
 * approval of the instagram_business_manage_messages permission. The
 * receiver MUST respond correctly before App Review can be submitted.
 *
 * Instagram payload shape differs from Messenger — IG Business sends
 * events under `entry[].changes[]` with a `field` of `messages`, NOT
 * under `entry[].messaging[]` like Messenger does. Documented below.
 *
 * https://developers.facebook.com/docs/instagram-api/guides/messaging
 *
 * Env vars:
 *   META_APP_SECRET             Shared App Secret (same one signs Messenger
 *                               and WhatsApp Cloud API webhooks).
 *   META_INSTAGRAM_VERIFY_TOKEN  Operator-picked verify token for the IG
 *                                webhook subscription.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyMetaSignature,
  handleVerificationChallenge,
} from '@/lib/meta-webhook-auth';

const APP_SECRET = process.env.META_APP_SECRET ?? '';
const VERIFY_TOKEN = process.env.META_INSTAGRAM_VERIFY_TOKEN ?? '';

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

  return new NextResponse(result.challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

// ── POST: incoming Instagram DM event ───────────────────────────────────

interface InstagramEntry {
  id: string;
  time: number;
  /**
   * Instagram uses two slightly different shapes depending on subscription
   * type. The Business Messaging API uses `messaging[]` like Messenger.
   * The Graph webhooks for business changes use `changes[]`. Both possible
   * fields are handled.
   */
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
  changes?: Array<{
    field: string;
    value: Record<string, unknown>;
  }>;
}

interface InstagramWebhookPayload {
  object: 'instagram';
  entry: InstagramEntry[];
}

export async function POST(req: NextRequest) {
  // Raw body for HMAC verification — JSON.parse before verify breaks the
  // hash because re-serialising drops/reorders bytes.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('x-hub-signature-256');

  const verified = verifyMetaSignature({
    rawBody,
    signatureHeader,
    appSecret: APP_SECRET,
  });

  if (!verified.valid) {
    console.warn('[instagram-intake] signature rejected:', verified.reason);
    return NextResponse.json(
      { ok: false, error: 'signature verification failed' },
      { status: 401 }
    );
  }

  let payload: InstagramWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as InstagramWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  // Extract real message events; ignore delivery receipts, read receipts,
  // story mentions, and other non-intake noise. Only DM text matters here.
  const messageEvents: Array<{
    igUserId: string;
    senderId: string;
    text: string;
    timestamp: number;
    mid: string;
  }> = [];

  for (const entry of payload.entry ?? []) {
    // Messaging-style entries (the most common shape for IG Business DMs)
    for (const event of entry.messaging ?? []) {
      const text = event.message?.text;
      const mid = event.message?.mid;
      if (text && mid) {
        messageEvents.push({
          igUserId: entry.id,
          senderId: event.sender.id,
          text,
          timestamp: event.timestamp,
          mid,
        });
      }
    }
    // Changes-style entries (some webhook subscriptions use this format).
    // Extraction shape varies; for now we just log them and let future
    // engineering work out the canonical mapping when real samples arrive.
    for (const change of entry.changes ?? []) {
      if (change.field === 'messages') {
        console.log('[instagram-intake] changes-format message event:', {
          igUserId: entry.id,
          value: change.value,
        });
      }
    }
  }

  // STUB: log inbound messages. Engine integration lands post-App-Review.
  if (messageEvents.length > 0) {
    console.log(
      '[instagram-intake] received',
      messageEvents.length,
      'message event(s):',
      messageEvents.map((e) => ({
        ig: e.igUserId,
        sender: e.senderId,
        preview: e.text.slice(0, 80),
      }))
    );
    // TODO (post App Review approval):
    //   1. Resolve igUserId → firmId via intake_firms.branding or a new
    //      firm_instagram_accounts table.
    //   2. Initialise the screen engine with channel='instagram_dm'.
    //   3. Feed the inbound text through extraction + slot evidence + LLM.
    //   4. Build the brief HTML and JSON.
    //   5. Insert into screened_leads with channel='instagram_dm'.
    //   6. Fire the new-lead notification email.
    //   7. Send the lawyer-determined reply back via Meta's IG Messaging API.
  }

  // Meta requires 200 within ~20 seconds.
  return NextResponse.json({ ok: true });
}
