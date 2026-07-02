/**
 * GET /api/cron/quiet-file-nudge
 *
 * J8 Milestone Assistant: Quiet-File Nudge. Scans active matters where no
 * client-channel admin message has gone out in QUIET_FILE_DAYS, and queues
 * a milestone_draft_ready notification_outbox row for each assigned
 * lawyer so the next digest prompts them to draft an update.
 *
 * Replaces the standalone scripts/cron-quiet-file-nudge.ts (removed): that
 * script inserted { lawyer_ids: [...] } into notification_outbox, a column
 * that does not exist on the table (real columns are recipient_email,
 * recipient_user_id, per-row) and never set the NOT NULL recipient_email
 * column, so every insert failed silently. This route follows the same
 * recipient-resolution pattern as enqueueMessageNotification in
 * lib/matter-messages.ts: resolve firm_lawyers.email per lead_id +
 * assignee_ids, respecting email_notifications_enabled, one outbox row
 * per recipient.
 *
 * Suppression: client_matters.quiet_nudge_sent_at prevents re-nudging the
 * same matter every single day for as long as it stays quiet. A matter is
 * eligible again once QUIET_NUDGE_SUPPRESSION_DAYS has passed since the
 * last nudge. The matter exits the quiet set entirely, independent of
 * this column, the moment a new client-channel admin message is sent.
 *
 * Auth: Bearer CRON_SECRET / PG_CRON_TOKEN (same shape as the other
 * crons under /api/cron/*).
 *
 * Scheduling: pg_cron job 'quiet-file-nudge-daily', defined in the DRAFT
 * migration supabase/migrations-draft/20260629_client_matters_milestone_fields.sql.
 * NOT YET APPLIED to prod; this route is inert (matter_milestone /
 * quiet_nudge_sent_at columns absent) until the operator approves the
 * migration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

const QUIET_FILE_DAYS = 10;
const QUIET_NUDGE_SUPPRESSION_DAYS = 7;
const INSERT_BATCH_SIZE = 50;

interface ActiveMatterRow {
  id: string;
  firm_id: string;
  lead_id: string | null;
  assignee_ids: string[] | null;
  primary_name: string | null;
  matter_type: string;
  practice_area: string;
  quiet_nudge_sent_at: string | null;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const messageCutoff = new Date(now.getTime() - QUIET_FILE_DAYS * 24 * 60 * 60 * 1000);
  const suppressionCutoff = new Date(
    now.getTime() - QUIET_NUDGE_SUPPRESSION_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data: matters, error: mErr } = await supabase
    .from('client_matters')
    .select('id, firm_id, lead_id, assignee_ids, primary_name, matter_type, practice_area, quiet_nudge_sent_at')
    .eq('matter_stage', 'active');

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }
  if (!matters || matters.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, nudged: 0 });
  }

  const activeMatters = matters as ActiveMatterRow[];
  const matterIds = activeMatters.map((m) => m.id);

  const { data: latestMsgs, error: msgErr } = await supabase
    .from('matter_messages')
    .select('matter_id, created_at')
    .in('matter_id', matterIds)
    .eq('channel_type', 'client')
    .eq('sender_role', 'admin')
    .order('created_at', { ascending: false });

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  const lastSentMap = new Map<string, string>();
  for (const msg of (latestMsgs ?? []) as { matter_id: string; created_at: string }[]) {
    if (!lastSentMap.has(msg.matter_id)) {
      lastSentMap.set(msg.matter_id, msg.created_at);
    }
  }

  const quietMatters = activeMatters.filter((m) => {
    const lastSent = lastSentMap.get(m.id);
    const isQuiet = !lastSent || new Date(lastSent) < messageCutoff;
    if (!isQuiet) return false;
    if (!m.quiet_nudge_sent_at) return true;
    return new Date(m.quiet_nudge_sent_at) < suppressionCutoff;
  });

  if (quietMatters.length === 0) {
    return NextResponse.json({ ok: true, scanned: activeMatters.length, quiet: 0, nudged: 0 });
  }

  const lawyerIds = new Set<string>();
  for (const m of quietMatters) {
    if (m.lead_id) lawyerIds.add(m.lead_id);
    if (Array.isArray(m.assignee_ids)) {
      for (const id of m.assignee_ids) if (typeof id === 'string') lawyerIds.add(id);
    }
  }

  const lawyerEmailMap = new Map<string, string>();
  if (lawyerIds.size > 0) {
    const { data: lawyers } = await supabase
      .from('firm_lawyers')
      .select('id, email, email_notifications_enabled')
      .in('id', Array.from(lawyerIds));
    for (const l of lawyers ?? []) {
      if (l.email && l.email_notifications_enabled !== false) {
        lawyerEmailMap.set(l.id as string, l.email as string);
      }
    }
  }

  const rows: Array<{
    recipient_email: string;
    firm_id: string;
    matter_id: string;
    event_type: string;
    event_payload: Record<string, unknown>;
  }> = [];
  const nudgedMatterIds: string[] = [];

  for (const m of quietMatters) {
    const recipientIds = new Set<string>();
    if (m.lead_id) recipientIds.add(m.lead_id);
    if (Array.isArray(m.assignee_ids)) {
      for (const id of m.assignee_ids) if (typeof id === 'string') recipientIds.add(id);
    }

    const emails = new Set<string>();
    for (const id of recipientIds) {
      const email = lawyerEmailMap.get(id);
      if (email) emails.add(email);
    }

    if (emails.size === 0) continue; // no notifiable lawyer; still counts as processed
    nudgedMatterIds.push(m.id);

    const lastSent = lastSentMap.get(m.id) ?? null;
    const body = lastSent
      ? `No client update sent on this matter since ${new Date(lastSent).toLocaleDateString('en-CA')}. Tap into the matter to draft one in about 30 seconds.`
      : `No client update has been sent on this matter yet. Tap into the matter to draft one in about 30 seconds.`;

    for (const email of emails) {
      rows.push({
        recipient_email: email,
        firm_id: m.firm_id,
        matter_id: m.id,
        event_type: 'milestone_draft_ready',
        event_payload: {
          trigger: 'quiet_file_nudge',
          days_since_last_update: QUIET_FILE_DAYS,
          matter_type: m.matter_type,
          practice_area: m.practice_area,
          primary_name: m.primary_name,
          last_sent_at: lastSent,
          body,
        },
      });
    }
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error: insertErr } = await supabase.from('notification_outbox').insert(batch);
    if (!insertErr) inserted += batch.length;
  }

  if (nudgedMatterIds.length > 0) {
    await supabase
      .from('client_matters')
      .update({ quiet_nudge_sent_at: now.toISOString() })
      .in('id', nudgedMatterIds);
  }

  return NextResponse.json({
    ok: true,
    scanned: activeMatters.length,
    quiet: quietMatters.length,
    nudged: nudgedMatterIds.length,
    notifications_queued: inserted,
  });
}
