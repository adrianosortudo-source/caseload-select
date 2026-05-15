/**
 * WhatsApp Cloud API Send client.
 *
 * Used to send the contact-capture follow-up message back to a lead who
 * texted the firm's WhatsApp Business number (Phase B of the contact-
 * capture doctrine, 2026-05-15).
 *
 * Graph API endpoint:
 *   POST https://graph.facebook.com/v25.0/<phone_number_id>/messages
 *   Authorization: Bearer <wa_access_token>
 *   Body: {
 *     messaging_product: 'whatsapp',
 *     to: <wa_id>,
 *     type: 'text',
 *     text: { body: "..." }
 *   }
 *
 * 24h session window: free-form text is only allowed within 24h of the
 * lead's last inbound. The contact-capture follow-up is the immediate
 * next turn so the window is always open. Outside the window we'd need
 * a pre-approved template; that's a separate operational concern.
 *
 * Unlike Messenger/IG, WhatsApp uses its own access token
 * (intake_firms.whatsapp_cloud_api_access_token).
 */

const GRAPH_VERSION = 'v25.0';

export interface SendWhatsappMessageArgs {
  phoneNumberId: string;
  accessToken: string;
  /** wa_id of the recipient (E.164 without leading +). */
  recipientWaId: string;
  text: string;
}

export interface SendMessageResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
  status?: number;
}

export async function sendWhatsappMessage(
  args: SendWhatsappMessageArgs,
): Promise<SendMessageResult> {
  if (!args.phoneNumberId) return { sent: false, reason: 'missing phoneNumberId' };
  if (!args.accessToken) return { sent: false, reason: 'missing accessToken' };
  if (!args.recipientWaId) return { sent: false, reason: 'missing recipientWaId' };
  if (!args.text || !args.text.trim()) return { sent: false, reason: 'empty text' };

  // WhatsApp wants the wa_id WITHOUT the leading +. Strip defensively.
  const to = args.recipientWaId.replace(/^\+/, '');

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
    args.phoneNumberId,
  )}/messages`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: args.text },
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
    const data = (await res.json()) as {
      messages?: Array<{ id: string }>;
    };
    return {
      sent: true,
      messageId: data.messages?.[0]?.id,
      status: res.status,
    };
  } catch {
    return { sent: true, status: res.status };
  }
}
