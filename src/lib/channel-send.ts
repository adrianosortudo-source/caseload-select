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
import { getI18n } from '@/lib/screen-engine/i18n/loader';
import type { SupportedLanguage } from '@/lib/screen-engine/types';
import {
  claimOutboundConversationEvent,
  loadChannelConversation,
  loadOutboundConversationResult,
  recordOutboundConversationResult,
  resolveScreenedLeadIdForFirm,
  validateChannelText,
  type OutboundLedgerContext,
} from '@/lib/channel-conversation';

export interface ChannelSendResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
  status?: number;
  code?:
    | 'validation_failed'
    | 'lead_not_found'
    | 'reply_window_closed'
    | 'duplicate_request'
    | 'ledger_unavailable';
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
    console.error('[channel-send] firm token lookup failed');
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
  /** Required for operator sends and auditable post-finalization automation. */
  ledger?: OutboundLedgerContext;
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
  const validation = validateChannelText(args.sender.channel, args.text);
  if (!validation.valid) {
    return { sent: false, reason: validation.reason, code: 'validation_failed' };
  }

  let ledger = args.ledger;
  if (args.ledger) {
    try {
      const resolvedLeadId = await resolveScreenedLeadIdForFirm(
        args.firmId,
        args.ledger.screenedLeadId,
      );
      if (!resolvedLeadId) {
        return {
          sent: false,
          reason: 'screened lead not found for firm',
          code: 'lead_not_found',
        };
      }
      ledger = { ...args.ledger, screenedLeadId: resolvedLeadId };
      if (ledger.requireOpenWindow) {
        const conversation = await loadChannelConversation({
          firmId: args.firmId,
          screenedLeadId: ledger.screenedLeadId,
        });
        if (!conversation?.replyWindow.isOpen) {
          return {
            sent: false,
            reason: 'Meta reply window is closed',
            code: 'reply_window_closed',
          };
        }
      }

      const claim = await claimOutboundConversationEvent({
        firmId: args.firmId,
        channel: args.sender.channel,
        text: args.text,
        ledger,
      });
      if (!claim.claimed) {
        const prior = await loadOutboundConversationResult({
          firmId: args.firmId,
          clientRequestId: ledger.clientRequestId,
        });
        return {
          sent: prior?.status === 'sent',
          messageId: prior?.metaMessageId ?? undefined,
          reason: prior
            ? prior.failureReason ?? 'request already completed'
            : 'request is already in progress',
          code: 'duplicate_request',
        };
      }
    } catch {
      console.warn('[channel-send] outbound ledger claim failed');
      return {
        sent: false,
        reason: 'conversation ledger unavailable',
        code: 'ledger_unavailable',
      };
    }
  }

  const finish = async (result: ChannelSendResult): Promise<ChannelSendResult> => {
    if (ledger) {
      try {
        await recordOutboundConversationResult({
          firmId: args.firmId,
          channel: args.sender.channel,
          text: args.text,
          ledger,
          sent: result.sent,
          metaMessageId: result.messageId,
          failureReason: result.reason,
        });
      } catch {
        console.warn('[channel-send] outbound result ledger write threw');
      }
    }
    return result;
  };

  const tokens = await loadFirmTokens(args.firmId);
  if (!tokens) {
    return finish({ sent: false, reason: 'firm tokens unavailable' });
  }

  // Recheck immediately before the external side effect. Equality is closed.
  if (ledger?.requireOpenWindow) {
    try {
      const conversation = await loadChannelConversation({
        firmId: args.firmId,
        screenedLeadId: ledger.screenedLeadId,
      });
      if (!conversation?.replyWindow.isOpen) {
        return finish({
          sent: false,
          reason: 'Meta reply window is closed',
          code: 'reply_window_closed',
        });
      }
    } catch {
      return finish({
        sent: false,
        reason: 'conversation ledger unavailable',
        code: 'ledger_unavailable',
      });
    }
  }

  switch (args.sender.channel) {
    case 'facebook': {
      if (!tokens.facebook_page_access_token) {
        return finish({ sent: false, reason: 'no facebook_page_access_token configured' });
      }
      return finish(await sendMessengerMessage({
        pageId: args.sender.pageId,
        pageAccessToken: tokens.facebook_page_access_token,
        recipientPsid: args.sender.senderPsid,
        text: args.text,
      }));
    }
    case 'instagram': {
      // IG inherits the linked Page's access token. Same column.
      if (!tokens.facebook_page_access_token) {
        return finish({ sent: false, reason: 'no facebook_page_access_token configured (IG inherits)' });
      }
      return finish(await sendInstagramMessage({
        igBusinessAccountId: args.sender.igBusinessAccountId,
        pageAccessToken: tokens.facebook_page_access_token,
        recipientIgsid: args.sender.senderIgsid,
        text: args.text,
      }));
    }
    case 'whatsapp': {
      if (!tokens.whatsapp_cloud_api_access_token) {
        return finish({ sent: false, reason: 'no whatsapp_cloud_api_access_token configured' });
      }
      return finish(await sendWhatsappMessage({
        phoneNumberId: args.sender.phoneNumberId,
        accessToken: tokens.whatsapp_cloud_api_access_token,
        recipientWaId: args.sender.senderWaId,
        text: args.text,
      }));
    }
  }
}

/**
 * Single source of truth for the contact-capture follow-up question.
 * Returns the phrasing that asks for whatever piece is still missing.
 *
 * language wired 2026-08-07: routes through i18n.widget_strings with an
 * English fallback (en.json has no widget_strings section at all, so the
 * English literal below is the canonical English text, not a fallback of
 * a fallback). Added when the C2 first-ask intro made English-only
 * contact-capture copy a visible, jarring gap — a PT-speaking lead was
 * getting PT on turn 1's intro and then abruptly English asking the same
 * thing on turn 2's resume-turn follow-up.
 *
 * Future: per-firm tone customisation (intake_firms.contact_capture_phrasing).
 * Per spec scope, this is system-wide for now.
 */
export function buildContactCaptureFollowUp(
  missing: 'name' | 'reachability' | 'both',
  language: SupportedLanguage = 'en',
): string {
  const s = getI18n(language).widget_strings;
  switch (missing) {
    case 'name':
      return (
        s?.contact_capture_followup_name ||
        "Got it. Before I get this to the firm, what name should they use when they reach out?"
      );
    case 'reachability':
      return (
        s?.contact_capture_followup_reachability ||
        "Got it. What's the best phone or email for the firm to reach you?"
      );
    case 'both':
    default:
      return (
        s?.contact_capture_followup_both ||
        "Got it. Before I get this to the firm, can you share your name and the best phone or email for them to reach you?"
      );
  }
}

/**
 * Final acknowledgment when the contact-capture follow-up budget is
 * exhausted (MAX_FOLLOW_UPS reached). Without this message the bot
 * goes silent after 3 unsuccessful asks, which from the lead's side
 * reads as a broken loop — task #92, OOS classification creates
 * (felt-)infinite contact-capture loop.
 *
 * The closing acknowledges the inbound, names what's still missing,
 * and leaves the door open for the lead to reply with contact info
 * later (the next inbound creates a fresh session). No LSO-non-compliant
 * outcome promises, no "specialist" or "expert" language.
 *
 * language wired 2026-08-07 (same reasoning as buildContactCaptureFollowUp
 * above). PT ships as three full pre-composed sentences, not a template
 * substitution into a shared PT frame — substituting a PT noun-phrase
 * into an otherwise-English sentence structure is exactly the kind of
 * composed-not-sourced construction that reads as translated.
 */
export function buildContactCaptureExhaustedMessage(
  missing: 'name' | 'reachability' | 'both',
  language: SupportedLanguage = 'en',
): string {
  const s = getI18n(language).widget_strings;
  switch (missing) {
    case 'name':
      return (
        s?.contact_capture_exhausted_name ||
        "Thanks for the messages. The firm needs a name the firm can use before they can follow up. Reply with that when you're ready and I'll pass it along."
      );
    case 'reachability':
      return (
        s?.contact_capture_exhausted_reachability ||
        "Thanks for the messages. The firm needs the best phone or email to reach you before they can follow up. Reply with that when you're ready and I'll pass it along."
      );
    case 'both':
    default:
      return (
        s?.contact_capture_exhausted_both ||
        "Thanks for the messages. The firm needs your name and the best phone or email to reach you before they can follow up. Reply with that when you're ready and I'll pass it along."
      );
  }
}
