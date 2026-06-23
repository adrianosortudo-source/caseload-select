/**
 * GET /api/cron/notification-batch
 *
 * Drains the notification_outbox table every 5 minutes. Groups
 * queued rows by recipient_email, builds one digest email per
 * recipient, sends via Resend, and stamps the rows as sent.
 *
 * Auth: Bearer CRON_SECRET / PG_CRON_TOKEN (constant-time compare
 * via isCronAuthorized).
 *
 * Triggered by the pg_cron job `notification-batch-5m` defined in
 * migration 20260520_s8p1_notification_batch_cron.sql.
 *
 * Per-recipient toggle: firm_lawyers.email_notifications_enabled.
 * When false, queued rows for that recipient drop at drain time
 * (status='dropped'). Client recipients (matter.primary_email) are
 * always delivered.
 *
 * Phase 1 grouping: simple email-grouped digest. Each digest body
 * lists the events grouped by matter, with the full message body and
 * a deep link to the matter. Lawyers link to the matter-detail page;
 * clients link to the matter-home page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/email';

const BATCH_WINDOW_MIN = 5;
const MAX_ROWS_PER_DRAIN = 500;
const APP_BASE = 'https://app.caseloadselect.ca';

interface OutboxRow {
  id: string;
  recipient_email: string;
  firm_id: string | null;
  matter_id: string | null;
  event_type: string;
  event_payload: {
    message_id?: string;
    channel_type?: string;
    sender_role?: string;
    body_preview?: string;
    body?: string;
    primary_name?: string | null;
    [key: string]: unknown;
  };
  created_at: string;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - BATCH_WINDOW_MIN * 60 * 1000).toISOString();

  const { data: rows, error: fetchErr } = await supabase
    .from('notification_outbox')
    .select('id, recipient_email, firm_id, matter_id, event_type, event_payload, created_at')
    .eq('status', 'queued')
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS_PER_DRAIN);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const queued = (rows ?? []) as OutboxRow[];
  if (queued.length === 0) {
    return NextResponse.json({ ok: true, drained: 0, message: 'no rows due' });
  }

  const byRecipient = new Map<string, OutboxRow[]>();
  for (const row of queued) {
    const list = byRecipient.get(row.recipient_email) ?? [];
    list.push(row);
    byRecipient.set(row.recipient_email, list);
  }

  const lawyerEmailMap = await resolveLawyerEmailEnabledMap(
    Array.from(byRecipient.keys()),
  );

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const stats = { sent: 0, dropped: 0, failed: 0, recipients: 0 };
  const sentIds: string[] = [];
  const droppedIds: string[] = [];
  const failedIds: string[] = [];

  for (const [email, recipientRows] of byRecipient.entries()) {
    stats.recipients++;
    const enabled = lawyerEmailMap.get(email) ?? true;
    if (!enabled) {
      stats.dropped += recipientRows.length;
      for (const r of recipientRows) droppedIds.push(r.id);
      continue;
    }

    const isLawyer = lawyerEmailMap.has(email);
    const digest = buildDigest(email, recipientRows, isLawyer);
    try {
      await sendEmail(email, digest.subject, digest.html);
      stats.sent += recipientRows.length;
      for (const r of recipientRows) sentIds.push(r.id);
    } catch (err) {
      stats.failed += recipientRows.length;
      for (const r of recipientRows) failedIds.push(r.id);
      console.warn(`[notification-batch] send failed for ${email}:`, err);
    }
  }

  await Promise.all([
    sentIds.length > 0 && supabase
      .from('notification_outbox')
      .update({ status: 'sent', sent_at: now, batch_id: batchId })
      .in('id', sentIds),
    droppedIds.length > 0 && supabase
      .from('notification_outbox')
      .update({ status: 'dropped', batch_id: batchId })
      .in('id', droppedIds),
    failedIds.length > 0 && supabase
      .from('notification_outbox')
      .update({
        status: 'failed',
        failed_at: now,
        attempts: 1,
      })
      .in('id', failedIds),
  ].filter(Boolean));

  return NextResponse.json({
    ok: true,
    drained: queued.length,
    batch_id: batchId,
    stats,
  });
}

async function resolveLawyerEmailEnabledMap(
  emails: string[],
): Promise<Map<string, boolean>> {
  if (emails.length === 0) return new Map();
  const { data } = await supabase
    .from('firm_lawyers')
    .select('email, email_notifications_enabled')
    .in('email', emails);
  const m = new Map<string, boolean>();
  for (const row of data ?? []) {
    if (row.email) m.set(row.email, row.email_notifications_enabled !== false);
  }
  return m;
}

function buildDigest(
  _email: string,
  rows: OutboxRow[],
  isLawyer: boolean,
): { subject: string; html: string } {
  const byMatter = new Map<string, OutboxRow[]>();
  for (const r of rows) {
    const key = r.matter_id ?? '_no_matter';
    const list = byMatter.get(key) ?? [];
    list.push(r);
    byMatter.set(key, list);
  }

  const totalEvents = rows.length;
  const matterCount = byMatter.size;

  // Use primary_name from first row if available for a better subject.
  const firstRow = rows[0];
  const firstPrimaryName = firstRow?.event_payload?.primary_name;
  const subject =
    totalEvents === 1 && firstPrimaryName
      ? `New message${firstRow.event_type === 'message_internal_new' ? ' (internal)' : ''}: ${firstPrimaryName}`
      : totalEvents === 1
        ? 'New message on your matter'
        : `${totalEvents} updates across ${matterCount} matter${matterCount === 1 ? '' : 's'}`;

  const sections: string[] = [];
  for (const [matterId, matterRows] of byMatter.entries()) {
    const matterName = matterRows[0]?.event_payload?.primary_name ?? null;
    const matterLabel = matterName ? `Matter: ${escapeHtml(matterName)}` : `Matter ${escapeHtml(matterId.slice(0, 8))}...`;

    const portalUrl =
      matterId !== '_no_matter' && matterRows[0]?.firm_id
        ? isLawyer
          ? `${APP_BASE}/portal/${matterRows[0].firm_id}/matters/${matterId}`
          : `${APP_BASE}/portal/${matterRows[0].firm_id}/m/${matterId}`
        : null;

    const eventBlocks = matterRows.map((r) => eventBlockHtml(r, portalUrl)).join('');
    sections.push(`
      <section style="margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; color: #888; font-size: 13px;">${matterLabel}</p>
        ${eventBlocks}
      </section>
    `);
  }

  const html = `
    <div style="font-family: 'Manrope', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1E2F58; margin-bottom: 16px;">${escapeHtml(subject)}</h2>
      ${sections.join('')}
      <p style="margin-top: 28px; color: #888; font-size: 12px;">
        Sent by CaseLoad Select on behalf of the firm. Reply to this email to respond directly.
      </p>
    </div>
  `.trim();

  return { subject, html };
}

function eventBlockHtml(row: OutboxRow, portalUrl: string | null): string {
  const label = describeEvent(row.event_type);
  const fullBody = row.event_payload?.body ?? row.event_payload?.body_preview;
  const bodyText = fullBody
    ? fullBody.slice(0, 800)
    : null;
  const bodyHtml = bodyText
    ? `<p style="margin: 6px 0 0 0; color: #333; font-size: 14px; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(bodyText)}${fullBody && fullBody.length > 800 ? '...' : ''}</p>`
    : '';
  const linkHtml = portalUrl
    ? `<p style="margin: 8px 0 0 0;"><a href="${portalUrl}" style="color: #1E2F58; font-size: 13px; font-weight: 700;">View message</a></p>`
    : '';
  return `
    <div style="padding: 12px 14px; background: #F4F3EF; border-radius: 4px; margin-bottom: 8px;">
      <p style="margin: 0; font-weight: 700; color: #0D1520; font-size: 14px;">${escapeHtml(label)}</p>
      ${bodyHtml}
      ${linkHtml}
    </div>
  `;
}

function describeEvent(eventType: string): string {
  const m: Record<string, string> = {
    message_new: 'New message',
    message_internal_new: 'New internal note',
    file_uploaded: 'New file uploaded',
    matter_stage_changed: 'Matter stage changed',
    explainer_assigned: 'Explainer assigned',
    welcome_draft_ready: 'Welcome draft ready',
    broadcast_received: 'Broadcast message',
  };
  return m[eventType] ?? eventType;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
