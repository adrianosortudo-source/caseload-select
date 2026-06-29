/**
 * cron-quiet-file-nudge.ts
 *
 * J8 Milestone Assistant: Quiet-File Nudge
 *
 * Scans active matters where the lawyer has sent no client message
 * in approximately 10 days, then queues a notification_outbox row
 * (event_type: milestone_draft_ready) for each. The notification
 * batcher picks these up and delivers them in the next digest.
 *
 * Runs as a scheduled function (e.g. daily at 09:00 local time).
 * Invoke via: npx tsx scripts/cron-quiet-file-nudge.ts
 *
 * Env vars required:
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 *
 * DRY_RUN=true prints matches without inserting notification rows.
 * QUIET_FILE_DAYS=N overrides the default 10-day threshold.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DRY_RUN = process.env.DRY_RUN === 'true';
const QUIET_FILE_DAYS = parseInt(process.env.QUIET_FILE_DAYS ?? '10', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[cron-quiet-file-nudge] missing SUPABASE env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

interface ActiveMatterRow {
  id: string;
  firm_id: string;
  primary_name: string;
  primary_email: string | null;
  matter_type: string;
  practice_area: string;
  matter_stage: string;
  assignee_ids: string[];
}

interface LastMessageRow {
  matter_id: string;
  max_created_at: string;
}

async function run() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - QUIET_FILE_DAYS);
  const cutoffIso = cutoffDate.toISOString();

  console.log(`[cron-quiet-file-nudge] checking matters with no client message since ${cutoffIso}`);
  if (DRY_RUN) {
    console.log('[cron-quiet-file-nudge] DRY_RUN=true, no notifications will be inserted');
  }

  // Load all active matters
  const { data: matters, error: mErr } = await supabase
    .from('client_matters')
    .select('id, firm_id, primary_name, primary_email, matter_type, practice_area, matter_stage, assignee_ids')
    .eq('matter_stage', 'active');

  if (mErr || !matters || matters.length === 0) {
    console.log('[cron-quiet-file-nudge] no active matters found or query error:', mErr?.message);
    return;
  }

  const matterIds = (matters as ActiveMatterRow[]).map((m) => m.id);

  // Find the most recent client-channel message per matter
  const { data: latestMsgs, error: msgErr } = await supabase
    .from('matter_messages')
    .select('matter_id, created_at')
    .in('matter_id', matterIds)
    .eq('channel_type', 'client')
    .eq('sender_role', 'admin')
    .order('created_at', { ascending: false });

  if (msgErr) {
    console.error('[cron-quiet-file-nudge] error fetching messages:', msgErr.message);
    return;
  }

  // Build a map of matter_id -> most recent admin message timestamp
  const lastSentMap = new Map<string, string>();
  for (const msg of (latestMsgs ?? []) as { matter_id: string; created_at: string }[]) {
    if (!lastSentMap.has(msg.matter_id)) {
      lastSentMap.set(msg.matter_id, msg.created_at);
    }
  }

  // Find quiet-file matters: either never messaged or last message > QUIET_FILE_DAYS ago
  const quietMatters = (matters as ActiveMatterRow[]).filter((m) => {
    const lastSent = lastSentMap.get(m.id);
    if (!lastSent) return true; // never sent a client message
    return lastSent < cutoffIso;
  });

  console.log(
    `[cron-quiet-file-nudge] found ${quietMatters.length} quiet-file matter(s) out of ${matters.length} active`,
  );

  if (quietMatters.length === 0) return;

  const notificationRows = quietMatters.map((m) => ({
    firm_id: m.firm_id,
    matter_id: m.id,
    event_type: 'milestone_draft_ready',
    event_payload: {
      trigger: 'quiet_file_nudge',
      days_since_last_update: QUIET_FILE_DAYS,
      matter_type: m.matter_type,
      practice_area: m.practice_area,
      primary_name: m.primary_name,
      last_sent_at: lastSentMap.get(m.id) ?? null,
    },
    lawyer_ids: m.assignee_ids,
  }));

  if (DRY_RUN) {
    console.log('[cron-quiet-file-nudge] would insert:', JSON.stringify(notificationRows, null, 2));
    return;
  }

  // Insert notifications in batches of 50 to stay within payload limits
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < notificationRows.length; i += BATCH) {
    const batch = notificationRows.slice(i, i + BATCH);
    const { error: insertErr } = await supabase
      .from('notification_outbox')
      .insert(batch);
    if (insertErr) {
      console.error(
        `[cron-quiet-file-nudge] insert error on batch ${i / BATCH + 1}:`,
        insertErr.message,
      );
    } else {
      inserted += batch.length;
    }
  }

  console.log(`[cron-quiet-file-nudge] inserted ${inserted} notification row(s)`);
}

run().catch((err) => {
  console.error('[cron-quiet-file-nudge] fatal error:', err);
  process.exit(1);
});
