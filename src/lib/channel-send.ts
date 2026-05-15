/**
 * Channel-agnostic Send dispatcher.
 *
 * Loads the firm's per-channel access token and routes to the right
 * Graph API helper. Returns a uniform `SendMessageResult` regardless of
 * channel so the caller can stay channel-agnostic.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sendMessengerMessage } from '@/lib/messenger-send';
import { sendInstagramMessage } from '@/lib/instagram-send';
import { sendWhatsappMessage } from '@/lib/whatsapp-send';
import type { ChannelSender } from '@/lib/channel-intake-processor';

export interface ChannelSendResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
  status?: number;
}

interface FirmTokens {
  facebook_page_access_token: string | null;
  whatsapp_cloud_api_access_token: string | null;
}

async function loadFirmTokens(firmId: string): Promise<FirmTokens | null> {
  const { data, error } = await supabase
    .from('intake_firms')
    .select('facebook_page_access_token, whatsapp_cloud_api_access_token')
    .eq('id', firmId)
    .maybeSingle();
  if (error) {
    console.error('[channel-send] firm token lookup failed:', error);
    return null;
  }
  if (!data) return null;
  return {
    facebook_page_access_token:
      (data.facebook_page_access_token as string | null) ?? null,
    whatsapp_cloud_api_access_token:
      (data.whatsapp_cloud_api_access_token as string | null) ?? null,
  };
}

export interface SendChannelMessageArgs {
  firmId: string;
  sender: ChannelSender;
  text: string;
}

/**
 * Send a free-form text message to the sender on the same channel they
 * messaged us on. The firm's access token is loaded from intake_firms.
 *
 * Returns `{ sent: false, reason }` on any failure path — token missing,
 * Graph 4xx/5xx, network error. The processor uses this signal to fall
 * back to unconfirmed_inquiries rather than crash.
 */
export async function sendChannelMessage(
  args: SendChannelMessageArgs,
): Promise<ChannelSendResult> {
  const tokens = await loadFirmTokens(args.firmId);
  if (!tokens) {
    return { sent: false, reason: 'firm tokens unavailable' };
  }

  switch (args.sender.channel) {
    case 'facebook': {
      if (!tokens.facebook_page_access_token) {
        return { sent: false, reason: 'no facebook_page_access_token configured' };
      }
      return sendMessengerMessage({
        pageId: args.sender.pageId,
        pageAccessToken: tokens.facebook_page_access_token,
        recipientPsid: args.sender.senderPsid,
        text: args.text,
      });
    }
    case 'instagram': {
      // IG inherits the linked Page's access token. Same column.
      if (!tokens.facebook_page_access_token) {
        return { sent: false, reason: 'no facebook_page_access_token configured (IG inherits)' };
      }
      return sendInstagramMessage({
        igBusinessAccountId: args.sender.igBusinessAccountId,
        pageAccessToken: tokens.facebook_page_access_token,
        recipientIgsid: args.sender.senderIgsid,
        text: args.text,
      });
    }
    case 'whatsapp': {
      if (!tokens.whatsapp_cloud_api_access_token) {
        return { sent: false, reason: 'no whatsapp_cloud_api_access_token configured' };
      }
      return sendWhatsappMessage({
        phoneNumberId: args.sender.phoneNumberId,
        accessToken: tokens.whatsapp_cloud_api_access_token,
        recipientWaId: args.sender.senderWaId,
        text: args.text,
      });
    }
  }
}

/**
 * Single source of truth for the contact-capture follow-up question.
 * Returns the phrasing that asks for whatever piece is still missing.
 *
 * Future: per-firm tone customisation (intake_firms.contact_capture_phrasing).
 * Per spec scope, this is system-wide for now.
 */
export function buildContactCaptureFollowUp(
  missing: 'name' | 'reachability' | 'both',
): string {
  switch (missing) {
    case 'name':
      return "Got it. Before I get this to the firm, what name should they use when they reach out?";
    case 'reachability':
      return "Got it. What's the best phone or email for the firm to reach you?";
    case 'both':
    default:
      return "Got it. Before I get this to the firm, can you share your name and the best phone or email for them to reach you?";
  }
}
