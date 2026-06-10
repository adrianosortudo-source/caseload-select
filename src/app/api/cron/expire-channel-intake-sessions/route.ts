/**
 * GET /api/cron/expire-channel-intake-sessions
 *
 * Sweeper for expired multi-turn Meta-channel intake sessions.
 *
 * Phase B of the contact-capture doctrine (2026-05-15). When a lead
 * messages on Messenger / Instagram DM / WhatsApp and fails the
 * contact-capture gate, we send a follow-up and persist EngineState in
 * `channel_intake_sessions`. If the lead never replies, the session
 * sits open forever; this sweeper resolves it.
 *
 * Behaviour (launch audit B3, 2026-06-09, contact-aware split):
 *   - Find every `channel_intake_sessions` row where
 *     `expires_at < now() AND finalized = false`.
 *   - When the restored engine state PASSES the contact gate
 *     (report.contact_complete, the same gate the live processor
 *     branches on), the lead is reachable: finalize into
 *     `screened_leads` as a normal thin lead via the shared
 *     `finalizeChannelLead` pipeline (brief render, insert, new-lead
 *     notification, session linked via screened_lead_id, best-effort
 *     closing message). DR-038: a reachable lead must reach the lawyer;
 *     a thin brief beats a dropped lead. Before this split, a
 *     contact-complete lead mid-discovery vanished into
 *     unconfirmed_inquiries with no lawyer notification.
 *   - When the gate FAILS, keep the original behaviour: move the data
 *     to `unconfirmed_inquiries` with reason='abandoned' and flip the
 *     session to finalized=true.
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
import { resolveFirmTimezone } from '@/lib/firm-timezone';
import {
  computeDecisionDeadline,
  computeWhaleNurture,
} from '@/lib/intake-v2-derive';
import { buildReport } from '@/lib/screen-engine/report';
import { computeBand } from '@/lib/screen-engine/band';
import { renderBriefHtmlServer } from '@/lib/screen-brief-html';
import {
  finalizeChannelLead,
  type ChannelSender,
  type MetaChannel,
} from '@/lib/channel-intake-processor';
import type { EngineState, LawyerReport } from '@/lib/screen-engine/types';

const BATCH_LIMIT = 100;

interface ExpiredSession {
  id: string;
  firm_id: string;
  channel: string;
  sender_id: string;
  engine_state: EngineState;
  follow_up_count: number;
}

interface SweepOutcome {
  session_id: string;
  firm_id: string;
  channel: string;
  moved: boolean;
  /** Which resolution path the row took. */
  disposition: 'finalized_lead' | 'abandoned';
  reason?: string;
}

/**
 * Firm fields the finalize path needs: location for the brief's
 * firm-local timestamps, and the channel asset IDs to rebuild a
 * ChannelSender for the Send API + audit meta.
 */
interface SweepFirmContext {
  location: string | null;
  facebook_page_id: string | null;
  instagram_business_account_id: string | null;
  whatsapp_phone_number_id: string | null;
}

async function loadFirmContext(
  firmId: string,
  cache: Map<string, SweepFirmContext | null>,
): Promise<SweepFirmContext | null> {
  if (cache.has(firmId)) return cache.get(firmId) ?? null;
  const { data, error } = await supabase
    .from('intake_firms')
    .select(
      'location, facebook_page_id, instagram_business_account_id, whatsapp_phone_number_id',
    )
    .eq('id', firmId)
    .maybeSingle();
  if (error) {
    console.warn('[expire-channel-sessions] firm lookup failed:', error.message);
    cache.set(firmId, null);
    return null;
  }
  const ctx = (data as SweepFirmContext | null) ?? null;
  cache.set(firmId, ctx);
  return ctx;
}

/**
 * Rebuild a ChannelSender from the session key + firm asset IDs. The
 * sweep has no inbound message, so messageMid is empty and senderName
 * is null (the contact gate already guarantees client_name is in the
 * slots, so the senderName fallback on contact_name never engages).
 * Missing asset IDs degrade to '': the closing send fails gracefully
 * and the finalize does not depend on it.
 */
function buildSweepSender(
  channel: MetaChannel,
  senderId: string,
  firm: SweepFirmContext | null,
): ChannelSender {
  switch (channel) {
    case 'facebook':
      return {
        channel: 'facebook',
        senderPsid: senderId,
        senderName: null,
        messageMid: '',
        pageId: firm?.facebook_page_id ?? '',
      };
    case 'instagram':
      return {
        channel: 'instagram',
        senderIgsid: senderId,
        senderName: null,
        messageMid: '',
        igBusinessAccountId: firm?.instagram_business_account_id ?? '',
      };
    case 'whatsapp':
      return {
        channel: 'whatsapp',
        senderWaId: senderId,
        senderName: null,
        messageMid: '',
        phoneNumberId: firm?.whatsapp_phone_number_id ?? '',
      };
  }
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
  let finalizedCount = 0;
  let abandonedCount = 0;
  const firmCache = new Map<string, SweepFirmContext | null>();

  for (const row of (expired ?? []) as ExpiredSession[]) {
    // Restore the state and run the contact gate via buildReport, the
    // same `contact_complete` flag the live processor branches on.
    // Wrapped because a malformed legacy engine_state must not wedge the
    // sweep; on throw the row falls through to the abandoned path.
    let state: EngineState | null = null;
    let report: LawyerReport | null = null;
    try {
      state = { ...row.engine_state, channel: row.channel as MetaChannel };
      report = buildReport(state);
    } catch (err) {
      console.warn(
        `[expire-channel-sessions] buildReport failed for session=${row.id}; treating as abandoned:`,
        err,
      );
      state = null;
      report = null;
    }

    if (state && report && report.contact_complete) {
      const firm = await loadFirmContext(row.firm_id, firmCache);
      const sender = buildSweepSender(
        row.channel as MetaChannel,
        row.sender_id,
        firm,
      );
      const firmTimezone = resolveFirmTimezone({
        location: firm?.location ?? null,
      });
      const now = new Date();
      const decisionDeadline = computeDecisionDeadline(
        report.four_axis.urgency,
        now,
        state.matter_type,
      );
      const whaleNurture = computeWhaleNurture(
        report.four_axis.value,
        report.four_axis.readiness,
      );
      const briefHtml = renderBriefHtmlServer(
        report,
        row.channel as MetaChannel,
        state.language,
        firmTimezone,
        state.matter_type,
        state.practice_area,
        {
          decisionDeadlineIso: decisionDeadline.toISOString(),
          whaleNurture,
        },
      );
      const band = computeBand(state).band;

      const result = await finalizeChannelLead({
        firmId: row.firm_id,
        sender,
        state,
        report,
        briefHtml,
        band,
        now,
        decisionDeadline,
        whaleNurture,
        sessionId: row.id,
        priorFollowUpCount: row.follow_up_count,
        isResume: true,
        fallbackTranscript: state.input ?? '',
      });

      // 'duplicate lead_id' means the lead row already exists and the
      // helper finalized the session: resolved, count it as moved.
      if (result.persisted || result.reason === 'duplicate lead_id') {
        finalizedCount++;
        outcomes.push({
          session_id: row.id,
          firm_id: row.firm_id,
          channel: row.channel,
          moved: true,
          disposition: 'finalized_lead',
          reason: result.persisted ? undefined : result.reason,
        });
      } else {
        // Insert failed (transient DB error). Leave the session open so
        // the next sweep retries; do NOT downgrade a reachable lead to
        // unconfirmed_inquiries over a transient failure.
        outcomes.push({
          session_id: row.id,
          firm_id: row.firm_id,
          channel: row.channel,
          moved: false,
          disposition: 'finalized_lead',
          reason: result.reason,
        });
      }
      continue;
    }

    // Contact gate failed (or state was unrestorable): original
    // behaviour. The lead is unreachable, move to unconfirmed_inquiries
    // for ops visibility.
    const engineState = (state ?? row.engine_state) as Partial<EngineState>;
    const inquiryResult = await persistUnconfirmedInquiry({
      firmId: row.firm_id,
      channel: row.channel as 'facebook' | 'instagram' | 'whatsapp',
      senderId: row.sender_id,
      senderMeta: { session_id: row.id },
      rawTranscript: engineState.input ?? null,
      matterType: engineState.matter_type ?? null,
      practiceArea: engineState.practice_area ?? null,
      intakeLanguage: engineState.language ?? null,
      reason: 'abandoned',
      followUpAttempts: row.follow_up_count,
    });

    if (!inquiryResult.ok) {
      outcomes.push({
        session_id: row.id,
        firm_id: row.firm_id,
        channel: row.channel,
        moved: false,
        disposition: 'abandoned',
        reason: inquiryResult.error,
      });
      continue;
    }

    // Finalise the session. Best-effort: if this fails the next sweep
    // run will catch it again, but unconfirmed_inquiries already has the
    // row so the operator-visibility goal is met.
    const { error: finalErr } = await supabase
      .from('channel_intake_sessions')
      .update({
        finalized: true,
        last_activity_at: nowIso,
      })
      .eq('id', row.id);

    abandonedCount++;
    if (finalErr) {
      outcomes.push({
        session_id: row.id,
        firm_id: row.firm_id,
        channel: row.channel,
        moved: true,
        disposition: 'abandoned',
        reason: `finalize failed: ${finalErr.message}`,
      });
    } else {
      outcomes.push({
        session_id: row.id,
        firm_id: row.firm_id,
        channel: row.channel,
        moved: true,
        disposition: 'abandoned',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    swept: outcomes.length,
    finalized: finalizedCount,
    abandoned: abandonedCount,
    batch_limit: BATCH_LIMIT,
    outcomes,
  });
}
