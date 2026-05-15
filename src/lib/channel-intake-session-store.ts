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

export interface ChannelSessionRow {
  id: string;
  firm_id: string;
  channel: MetaChannel;
  sender_id: string;
  engine_state: EngineState;
  follow_up_count: number;
  max_follow_ups: number;
  finalized: boolean;
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
      'id, firm_id, channel, sender_id, engine_state, follow_up_count, max_follow_ups, finalized, expires_at, created_at',
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
    })
    .eq('id', args.sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function finalizeChannelSession(
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('channel_intake_sessions')
    .update({ finalized: true, last_activity_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
