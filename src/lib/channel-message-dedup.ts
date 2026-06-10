/**
 * Meta-channel webhook idempotency (launch audit H1).
 *
 * Meta redelivers webhook events (slow ACK, subscription retries) and users
 * double-send, so the same message mid can arrive at a receiver more than
 * once. Without a claim, both deliveries run the full engine concurrently:
 * duplicate follow-up questions, lost turns, and on a first-turn finalize
 * two screened_leads rows plus two lawyer notifications.
 *
 * Claim-before-process: the receiver inserts (firm_id, channel, message_mid)
 * into processed_channel_messages BEFORE any engine work. The unique
 * constraint makes the claim race-safe; losing the race means another
 * delivery already owns the mid, so the loser ACKs 200 and skips.
 *
 * Fail-open on infrastructure errors: a missed dedup re-processes a message
 * (annoying), while a wrongly-skipped message drops a lead (unacceptable).
 *
 * Rows are transient; the daily data-retention cron sweeps claims older
 * than 7 days. Service-role only, same posture as channel_intake_sessions.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

export type MetaChannel = 'facebook' | 'instagram' | 'whatsapp';

export interface ClaimChannelMessageResult {
  /** True when another delivery already claimed this mid; skip processing. */
  duplicate: boolean;
  reason: 'claimed' | 'duplicate' | 'no_mid' | 'claim_error';
}

export interface ClaimChannelMessageArgs {
  firmId: string;
  channel: MetaChannel;
  messageMid: string | null | undefined;
}

export async function claimChannelMessage(
  args: ClaimChannelMessageArgs,
): Promise<ClaimChannelMessageResult> {
  const mid = (args.messageMid ?? '').trim();
  // No usable mid: process as a fresh message. Inventing a synthetic id
  // here would make unrelated messages collide on the synthetic key.
  if (!mid) {
    return { duplicate: false, reason: 'no_mid' };
  }

  const { data, error } = await supabase
    .from('processed_channel_messages')
    .upsert(
      { firm_id: args.firmId, channel: args.channel, message_mid: mid },
      { onConflict: 'firm_id,channel,message_mid', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    // 23505 means the unique constraint surfaced before ignoreDuplicates
    // could swallow it; same meaning as losing the claim race.
    if (error.code === '23505') {
      return { duplicate: true, reason: 'duplicate' };
    }
    console.error(
      `[channel-message-dedup] claim failed channel=${args.channel} mid=${mid}:`,
      error.message,
    );
    return { duplicate: false, reason: 'claim_error' };
  }

  // With ignoreDuplicates, a swallowed conflict returns zero rows: the mid
  // was already claimed by an earlier delivery.
  if (!data || data.length === 0) {
    return { duplicate: true, reason: 'duplicate' };
  }
  return { duplicate: false, reason: 'claimed' };
}

export interface ReleaseChannelMessageClaimArgs {
  firmId: string;
  channel: MetaChannel;
  messageMid: string | null | undefined;
}

/**
 * Best-effort release of a claim after processing THREW. A crashed engine
 * run produced no lead, so a held claim would permanently swallow the
 * message; deleting the row lets a Meta redelivery retry it.
 *
 * Only call this from a receiver's throw path. Non-throw outcomes
 * (persisted, contact-gate reject, multi-turn follow-up) are decisions,
 * not crashes, and their claims must hold so redeliveries stay skipped.
 *
 * Never throws: a failed release just leaves the claim in place, which is
 * the pre-release behaviour (message swallowed until the 7-day sweep).
 */
export async function releaseChannelMessageClaim(
  args: ReleaseChannelMessageClaimArgs,
): Promise<void> {
  const mid = (args.messageMid ?? '').trim();
  // No mid means no claim was taken; nothing to release.
  if (!mid) return;

  try {
    const { error } = await supabase
      .from('processed_channel_messages')
      .delete()
      .eq('firm_id', args.firmId)
      .eq('channel', args.channel)
      .eq('message_mid', mid);

    if (error) {
      console.error(
        `[channel-message-dedup] release failed channel=${args.channel} mid=${mid}:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[channel-message-dedup] release threw channel=${args.channel} mid=${mid}:`,
      err,
    );
  }
}
