/**
 * GET /api/cron/expire-channel-intake-sessions
 *
 * Sweeper for abandoned multi-turn Meta-channel intake sessions.
 *
 * Phase B of the contact-capture doctrine (2026-05-15). When a lead
 * messages on Messenger / Instagram DM / WhatsApp and fails the
 * contact-capture gate, we send a follow-up and persist EngineState in
 * `channel_intake_sessions`. If the lead never replies, the session
 * sits open forever — this sweeper resolves it.
 *
 * Behaviour:
 *   - Find every `channel_intake_sessions` row where
 *     `expires_at < now() AND finalized = false`.
 *   - Move its data to `unconfirmed_inquiries` with reason='abandoned'.
 *   - Flip the session to finalized=true.
 *
 * Auth: Bearer CRON_SECRET or PG_CRON_TOKEN (same shape as the existing
 * triage-backstop and webhook-retry crons).
 *
 * Scheduling: hourly via Supabase pg_cron (or manual trigger). Not in
 * vercel.json under Hobby plan; align with existing pg_cron setup at
 * `20260506_pg_cron_pg_net_setup.sql`.
 *
 * Batch: 100 rows per run (rare to have many at once; capped for safety).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { persistUnconfirmedInquiry } from '@/lib/unconfirmed-inquiry';

const BATCH_LIMIT = 100;

interface ExpiredSession {
  id: string;
  firm_id: string;
  channel: string;
  sender_id: string;
  engine_state: {
    matter_type?: string;
    practice_area?: string;
    language?: string;
    input?: string;
    slots?: Record<string, string | null>;
  };
  follow_up_count: number;
}

interface SweepOutcome {
  session_id: string;
  firm_id: string;
  channel: string;
  moved: boolean;
  reason?: string;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  const { data: expired, error } = await supabase
    .from('channel_intake_sessions')
    .select('id, firm_id, channel, sender_id, engine_state, follow_up_count')
    .eq('finalized', false)
    .lt('expires_at', nowIso)
    .order('expires_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outcomes: SweepOutcome[] = [];

  for (const row of (expired ?? []) as ExpiredSession[]) {
    const inquiryResult = await persistUnconfirmedInquiry({
      firmId: row.firm_id,
      channel: row.channel as 'facebook' | 'instagram' | 'whatsapp',
      senderId: row.sender_id,
      senderMeta: { session_id: row.id },
      rawTranscript: row.engine_state.input ?? null,
      matterType: row.engine_state.matter_type ?? null,
      practiceArea: row.engine_state.practice_area ?? null,
      intakeLanguage: row.engine_state.language ?? null,
      reason: 'abandoned',
      followUpAttempts: row.follow_up_count,
    });

    if (!inquiryResult.ok) {
      outcomes.push({
        session_id: row.id,
        firm_id: row.firm_id,
        channel: row.channel,
        moved: false,
        reason: inquiryResult.error,
      });
      continue;
    }

    // Finalise the session. Best-effort — if this fails the next sweep
    // run will catch it again, but unconfirmed_inquiries already has the
    // row so the operator-visibility goal is met.
    const { error: finalErr } = await supabase
      .from('channel_intake_sessions')
      .update({
        finalized: true,
        last_activity_at: nowIso,
      })
      .eq('id', row.id);

    if (finalErr) {
      outcomes.push({
        session_id: row.id,
        firm_id: row.firm_id,
        channel: row.channel,
        moved: true,
        reason: `finalize failed: ${finalErr.message}`,
      });
    } else {
      outcomes.push({
        session_id: row.id,
        firm_id: row.firm_id,
        channel: row.channel,
        moved: true,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    swept: outcomes.length,
    batch_limit: BATCH_LIMIT,
    outcomes,
  });
}
