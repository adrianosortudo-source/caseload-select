/**
 * Channel intake session store — load / save / finalize for the Meta-
 * channel multi-turn flow.
 *
 * Phase B of the contact-capture doctrine (2026-05-15). When the engine
 * fails the contact gate on a Meta channel, we send a follow-up question
 * via the channel's Send API and persist engine state HERE so the next
 * inbound webhook can resume mid-conversation.
 *
 * Naming: this is the Meta-channel-specific multi-turn store. The web
 * widget has its own `public.intake_sessions` table (separate flow).
 *
 * Service-role only.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { EngineState } from '@/lib/screen-engine/types';
import type { MetaChannel } from '@/lib/channel-intake-processor';

/**
 * Session inactivity window. Mirrors the insert-time DB default on
 * channel_intake_sessions.expires_at (now() + interval '24 hours',
 * migration 20260516_channel_intake_sessions.sql). Keep the two in sync.
 */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface ChannelSessionRow {
  id: string;
  firm_id: string;
  channel: MetaChannel;
  sender_id: string;
  engine_state: EngineState;
  follow_up_count: number;
  max_follow_ups: number;
  finalized: boolean;
  /**
   * Set when the session finalized because a screened_lead row was
   * successfully created. NULL when the session was finalized because
   * contact-capture exhausted, the Send API failed, or the cron sweep
   * marked it abandoned. Distinguishing the two states gates the
   * post-finalization secretary mode (Codex review, 2026-05-26).
   */
  screened_lead_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface LoadSessionArgs {
  firmId: string;
  channel: MetaChannel;
  senderId: string;
}

export async function loadOpenChannelSession(
  args: LoadSessionArgs,
): Promise<ChannelSessionRow | null> {
  const { data, error } = await supabase
    .from('channel_intake_sessions')
    .select(
      'id, firm_id, channel, sender_id, engine_state, follow_up_count, max_follow_ups, finalized, screened_lead_id, expires_at, created_at',
    )
    .eq('firm_id', args.firmId)
    .eq('channel', args.channel)
    .eq('sender_id', args.senderId)
    .eq('finalized', false)
    .maybeSingle();

  if (error) {
    console.error('[channel-session-store] load failed:', error);
    return null;
  }
  if (!data) return null;
  return data as ChannelSessionRow;
}

export interface CreateSessionArgs {
  firmId: string;
  channel: MetaChannel;
  senderId: string;
  engineState: EngineState;
  maxFollowUps?: number;
}

export async function createChannelSession(
  args: CreateSessionArgs,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase
    .from('channel_intake_sessions')
    .insert({
      firm_id: args.firmId,
      channel: args.channel,
      sender_id: args.senderId,
      engine_state: args.engineState,
      follow_up_count: 1,
      max_follow_ups: args.maxFollowUps ?? 3,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

export interface UpdateSessionArgs {
  sessionId: string;
  engineState: EngineState;
  followUpCount: number;
}

export async function updateChannelSession(
  args: UpdateSessionArgs,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('channel_intake_sessions')
    .update({
      engine_state: args.engineState,
      follow_up_count: args.followUpCount,
      last_activity_at: new Date().toISOString(),
      // Sliding expiry (launch audit B3, 2026-06-09). expires_at was set
      // once at insert and never extended, so a lead actively answering
      // discovery questions at WhatsApp latency crossed the 24h threshold
      // mid-conversation and the hourly sweeper resolved them as
      // abandoned. Every state save now pushes the window forward; only
      // 24h of true silence expires a session.
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    })
    .eq('id', args.sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Mark a channel intake session as finalized.
 *
 * Pass `screenedLeadId` ONLY when finalization corresponds to a
 * successful screened_leads insert. Leave it undefined / null for
 * abandoned, exhausted, or send-failure paths — those finalizations
 * close the session but did NOT produce a brief. The post-finalization
 * secretary mode (DR-104) gates on screened_lead_id IS NOT NULL so a
 * lead who timed out on contact capture does NOT later receive a
 * "lawyer is reviewing your matter" reply (Codex pushback, 2026-05-26).
 */
export async function finalizeChannelSession(
  sessionId: string,
  screenedLeadId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const update: Record<string, unknown> = {
    finalized: true,
    last_activity_at: new Date().toISOString(),
  };
  if (screenedLeadId) update.screened_lead_id = screenedLeadId;

  const { error } = await supabase
    .from('channel_intake_sessions')
    .update(update)
    .eq('id', sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface LoadRecentFinalizedArgs extends LoadSessionArgs {
  /** Look back this many days. Default 7. */
  withinDays?: number;
}

/**
 * Return the most recent FINALIZED session for (firm, channel, sender)
 * within the look-back window. Used by channel-intake-processor to
 * recognise a returning lead who already submitted an intake and
 * answer their follow-up like a secretary — instead of triggering a
 * brand-new intake (which would silently ask for contact again per
 * the contact-doctrine gate, looking confused from the lead's side).
 *
 * Field-detected 2026-05-25: lead's first intake finalized cleanly,
 * lead asked "when is she calling me?", engine spun up a new session
 * and asked for contact again. Bot needs a "this person is already
 * a lead in our system" branch.
 *
 * Recency clock is `last_activity_at`, not `created_at`. A session
 * created days ago but only finalized recently (long multi-turn
 * intake) should count as a recent submission — and finalize Channel
 * Session bumps `last_activity_at` to NOW() at finalize time, so for
 * a finalized session, `last_activity_at` IS effectively "finalized at".
 *
 * Backed by partial index idx_channel_intake_sessions_recent_finalized
 * (migration 20260525_channel_intake_sessions_recent_finalized_index.sql)
 * for O(log n) lookup at scale.
 */
export async function loadRecentFinalizedSession(
  args: LoadRecentFinalizedArgs,
): Promise<ChannelSessionRow | null> {
  const days = args.withinDays ?? 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Codex pushback 2026-05-26: only finalized sessions that produced an
  // actual screened_lead are eligible for the secretary mode. An
  // abandoned / contact-exhausted / send-failed session has finalized=
  // true but screened_lead_id IS NULL — replying as if a brief exists
  // would be a factual lie ("your lawyer is reviewing it" when no brief
  // was ever created).
  const { data, error } = await supabase
    .from('channel_intake_sessions')
    .select(
      'id, firm_id, channel, sender_id, engine_state, follow_up_count, max_follow_ups, finalized, screened_lead_id, expires_at, created_at, last_activity_at',
    )
    .eq('firm_id', args.firmId)
    .eq('channel', args.channel)
    .eq('sender_id', args.senderId)
    .eq('finalized', true)
    .not('screened_lead_id', 'is', null)
    .gte('last_activity_at', cutoff)
    .order('last_activity_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[channel-session-store] loadRecentFinalized failed:', error);
    return null;
  }
  if (!data) return null;
  return data as ChannelSessionRow;
}
