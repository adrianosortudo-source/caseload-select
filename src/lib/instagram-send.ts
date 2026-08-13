/**
 * Instagram Send API client.
 *
 * Used to send the contact-capture follow-up message back to a lead who
 * DM'd the firm's Instagram Business account (Phase B of the contact-
 * capture doctrine, 2026-05-15).
 *
 * Graph API endpoint:
 *   POST https://graph.facebook.com/v25.0/me/messages
 *   Authorization: Bearer <page_access_token>
 *   Body: { recipient: { id: <igsid> }, message: { text: "..." } }
 *
 * IG inherits the LINKED Facebook Page's access token — that's why this
 * helper takes `pageAccessToken` instead of an IG-specific token. The
 * intake_firms column is `facebook_page_access_token` for both channels.
 *
 * The endpoint MUST be Page-scoped (`/me/messages`, which resolves to the
 * Page that owns the token), not `/<ig_business_account_id>/messages`.
 * Those are two different API flavours: the IG-account-ID path belongs to
 * the Instagram-Login flow and expects an Instagram User token, so calling
 * it with a Page token fails with `(#3) Application does not have the
 * capability to make this API call` regardless of granted permissions.
 * Verified against the live DRG test assets 2026-08-13: the IG-account-ID
 * path returned error #3 while `/me/messages` delivered with the same
 * token. `igBusinessAccountId` is still required as a configuration
 * sanity check (an unconfigured firm should never reach a send).
 *
 * Same 24h messaging window as Messenger. Follow-up runs on the same
 * webhook turn as the inbound so the window is always open.
 */

const GRAPH_VERSION = 'v25.0';

export interface SendInstagramMessageArgs {
  igBusinessAccountId: string;
  pageAccessToken: string;
  recipientIgsid: string;
  text: string;
}

export interface SendMessageResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
  status?: number;
}

export async function sendInstagramMessage(
  args: SendInstagramMessageArgs,
): Promise<SendMessageResult> {
  if (!args.igBusinessAccountId)
    return { sent: false, reason: 'missing igBusinessAccountId' };
  if (!args.pageAccessToken) return { sent: false, reason: 'missing pageAccessToken' };
  if (!args.recipientIgsid) return { sent: false, reason: 'missing recipientIgsid' };
  if (!args.text || !args.text.trim()) return { sent: false, reason: 'empty text' };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.pageAccessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: args.recipientIgsid },
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
