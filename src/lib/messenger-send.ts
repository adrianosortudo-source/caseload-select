/**
 * Messenger Send API client.
 *
 * Used to send the contact-capture follow-up message back to a lead who
 * messaged the firm's Facebook Page (Phase B of the contact-capture
 * doctrine, 2026-05-15).
 *
 * Graph API endpoint:
 *   POST https://graph.facebook.com/v25.0/<page_id>/messages
 *   Authorization: Bearer <page_access_token>
 *   Body: { recipient: { id: <psid> }, message: { text: "..." } }
 *
 * The 24-hour standard messaging window applies: we can send a free-form
 * text message within 24h of the lead's last inbound. The contact-capture
 * follow-up is the IMMEDIATE next turn after a fresh inbound, so the
 * window is always open. Outside the window we'd need a message tag
 * (HUMAN_AGENT etc.) — not relevant here.
 *
 * Failures are surfaced as `{ sent: false, reason }` so the processor
 * can fall back to unconfirmed_inquiries rather than crash.
 */

const GRAPH_VERSION = 'v25.0';

export interface SendMessengerMessageArgs {
  pageId: string;
  pageAccessToken: string;
  recipientPsid: string;
  text: string;
}

export interface SendMessageResult {
  sent: boolean;
  /** Meta-side message_id on success. */
  messageId?: string;
  /** Diagnostic on failure. */
  reason?: string;
  /** HTTP status when the call reached Graph but failed. */
  status?: number;
}

export async function sendMessengerMessage(
  args: SendMessengerMessageArgs,
): Promise<SendMessageResult> {
  if (!args.pageId) return { sent: false, reason: 'missing pageId' };
  if (!args.pageAccessToken) return { sent: false, reason: 'missing pageAccessToken' };
  if (!args.recipientPsid) return { sent: false, reason: 'missing recipientPsid' };
  if (!args.text || !args.text.trim()) return { sent: false, reason: 'empty text' };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
    args.pageId,
  )}/messages`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.pageAccessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: args.recipientPsid },
        message: { text: args.text },
      }),
    });
  } catch (err) {
    return {
      sent: false,
      reason: `fetch threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    return {
      sent: false,
      status: res.status,
      reason: `graph ${res.status}: ${body.slice(0, 200)}`,
    };
  }

  try {
    const data = (await res.json()) as { message_id?: string };
    return { sent: true, messageId: data.message_id, status: res.status };
  } catch {
    return { sent: true, status: res.status };
  }
}
