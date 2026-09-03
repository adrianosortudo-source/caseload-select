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
 * a deep link to the matter. Lawyers link to the matter-detail page,
 * operators link to the operator console origin, and clients link to the
 * matter-home page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/email';
import { roleAwareOrigin } from '@/lib/app-origins';

const BATCH_WINDOW_MIN = 5;
const MAX_ROWS_PER_DRAIN = 500;
const MAX_NOTIFY_ATTEMPTS = 5;

type RecipientRole = 'lawyer' | 'operator' | 'client';

interface FirmMemberDelivery {
  enabled: boolean;
  role: 'lawyer' | 'operator';
}

interface RecipientGroup {
  email: string;
  role: RecipientRole;
  rows: OutboxRow[];
}

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
    deliverable_id?: string;
    deliverable_title?: string;
    deliverable_url?: string;
    recipient_role?: string;
    [key: string]: unknown;
  };
  created_at: string;
  attempts?: number;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - BATCH_WINDOW_MIN * 60 * 1000).toISOString();

  const { data: rows, error: fetchErr } = await supabase
    .from('notification_outbox')
    .select('id, recipient_email, firm_id, matter_id, event_type, event_payload, created_at, attempts')
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

  const firmMemberMap = await resolveFirmMemberDeliveryMap(
    Array.from(new Set(queued.map((row) => row.recipient_email))),
  );

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const stats = { sent: 0, dropped: 0, failed: 0, requeued: 0, recipients: 0 };
  const droppedIds: string[] = [];
  const failedRows: OutboxRow[] = [];

  // One inbox can legitimately hold a lawyer membership for one firm and an
  // operator membership for another. Group by resolved role as well as email
  // so one digest never mixes links whose session cookies live on different
  // origins.
  const recipientGroups = new Map<string, RecipientGroup>();
  for (const row of queued) {
    const member = firmMemberMap.get(memberKey(row.recipient_email, row.firm_id));
    const recipientRole = inferRecipientRole(row, member);
    if (member?.enabled === false) {
      stats.dropped += 1;
      droppedIds.push(row.id);
      continue;
    }
    const key = `${row.recipient_email.toLowerCase()}\u0000${recipientRole}`;
    const group = recipientGroups.get(key) ?? {
      email: row.recipient_email,
      role: recipientRole,
      rows: [],
    };
    group.rows.push(row);
    recipientGroups.set(key, group);
  }

  for (const { email, role: recipientRole, rows: recipientRows } of recipientGroups.values()) {
    stats.recipients++;
    const digest = buildDigest(email, recipientRows, recipientRole);
    const ids = recipientRows.map((r) => r.id);
    // Content-stable idempotency key: same recipient + same row set produces
    // the same key, so a crash-after-send followed by a replay is deduped by
    // Resend (24h window) and no second copy goes out. Outbox stamp can lag.
    const idempotencyKey = createHash('sha256')
      .update(`${email}|${[...ids].sort().join(',')}`)
      .digest('hex');
    try {
      await sendEmail(email, digest.subject, digest.html, { idempotencyKey });
      // Stamp sent immediately, per recipient, so a mid-drain crash on the
      // NEXT recipient cannot leave this one queued.
      await supabase
        .from('notification_outbox')
        .update({ status: 'sent', sent_at: now, batch_id: batchId })
        .in('id', ids);
      stats.sent += recipientRows.length;
    } catch (err) {
      stats.failed += recipientRows.length;
      for (const r of recipientRows) failedRows.push(r);
      console.error(`[notification-batch] send failed for ${email}:`, err);
    }
  }

  if (droppedIds.length > 0) {
    await supabase
      .from('notification_outbox')
      .update({ status: 'dropped', batch_id: batchId })
      .in('id', droppedIds);
  }

  // Failed rows are retried on the next drain (status stays 'queued') with a
  // bumped attempt count, until MAX_NOTIFY_ATTEMPTS, then terminal 'failed'.
  // Previously a single failure was stamped terminal with no retry. Group by
  // the next attempt value so each group is one update (PostgREST cannot do
  // attempts = attempts + 1 in a plain update).
  if (failedRows.length > 0) {
    const requeueByAttempts = new Map<number, string[]>();
    const terminalIds: string[] = [];
    for (const r of failedRows) {
      const next = (r.attempts ?? 0) + 1;
      if (next >= MAX_NOTIFY_ATTEMPTS) {
        terminalIds.push(r.id);
      } else {
        const list = requeueByAttempts.get(next) ?? [];
        list.push(r.id);
        requeueByAttempts.set(next, list);
      }
    }
    const writes: Array<PromiseLike<unknown>> = [];
    for (const [attempts, ids] of requeueByAttempts.entries()) {
      stats.requeued += ids.length;
      writes.push(
        supabase
          .from('notification_outbox')
          .update({ status: 'queued', attempts, failed_at: now, last_error: 'send failed; will retry' })
          .in('id', ids),
      );
    }
    if (terminalIds.length > 0) {
      writes.push(
        supabase
          .from('notification_outbox')
          .update({ status: 'failed', attempts: MAX_NOTIFY_ATTEMPTS, failed_at: now, last_error: 'send failed; max attempts reached' })
          .in('id', terminalIds),
      );
    }
    await Promise.all(writes);
  }

  return NextResponse.json({
    ok: true,
    drained: queued.length,
    batch_id: batchId,
    stats,
  });
}

async function resolveFirmMemberDeliveryMap(
  emails: string[],
): Promise<Map<string, FirmMemberDelivery>> {
  if (emails.length === 0) return new Map();
  const { data } = await supabase
    .from('firm_lawyers')
    .select('email, firm_id, role, email_notifications_enabled')
    .in('email', emails);
  const m = new Map<string, FirmMemberDelivery>();
  for (const row of data ?? []) {
    if (row.email && row.firm_id) {
      m.set(memberKey(row.email, row.firm_id), {
        enabled: row.email_notifications_enabled !== false,
        role: row.role === 'operator' ? 'operator' : 'lawyer',
      });
    }
  }
  return m;
}

function memberKey(email: string, firmId: string | null): string {
  return `${email.toLowerCase()}\u0000${firmId ?? ''}`;
}

function inferRecipientRole(
  row: OutboxRow,
  member: FirmMemberDelivery | undefined,
): RecipientRole {
  const explicit = row.event_payload?.recipient_role;
  if (explicit === 'operator' || explicit === 'lawyer' || explicit === 'client') {
    return explicit;
  }
  if (row.event_type === 'firm_message_new') {
    return row.event_payload?.sender_role === 'lawyer' ? 'operator' : 'lawyer';
  }
  return member?.role ?? 'client';
}

export function buildDigest(
  _email: string,
  rows: OutboxRow[],
  recipientRole: RecipientRole,
): { subject: string; html: string } {
  // Group by matter, or by deliverable when the event has no matter (content
  // approval events), or a single catch-all bucket otherwise.
  const byMatter = new Map<string, OutboxRow[]>();
  for (const r of rows) {
    const key =
      r.matter_id ??
      r.event_payload?.deliverable_id ??
      (r.event_type === 'firm_message_new' ? `firm:${r.firm_id ?? 'unknown'}` : '_no_matter');
    const list = byMatter.get(key) ?? [];
    list.push(r);
    byMatter.set(key, list);
  }

  const totalEvents = rows.length;
  const groupCount = byMatter.size;

  // Subject prefers a named matter; falls back to a deliverable title; then a
  // generic count.
  const firstRow = rows[0];
  const firstPrimaryName = firstRow?.event_payload?.primary_name;
  const firstDeliverableTitle = firstRow?.event_payload?.deliverable_title;
  const subject =
    totalEvents === 1 && firstPrimaryName
      ? `New message${firstRow.event_type === 'message_internal_new' ? ' (internal)' : ''}: ${firstPrimaryName}`
      : totalEvents === 1 && firstDeliverableTitle
        ? `${describeEvent(firstRow.event_type)}: ${firstDeliverableTitle}`
        : totalEvents === 1
          ? 'New activity on your portal'
          : `${totalEvents} updates across ${groupCount} item${groupCount === 1 ? '' : 's'}`;

  const sections: string[] = [];
  for (const [groupKey, groupRows] of byMatter.entries()) {
    const first = groupRows[0];
    const matterName = first?.event_payload?.primary_name ?? null;
    const deliverableTitle = first?.event_payload?.deliverable_title ?? null;
    const deliverableId = first?.event_payload?.deliverable_id ?? null;
    const deliverableUrl = deliverableId && first?.firm_id
      ? `${roleAwareOrigin(recipientRole)}/portal/${first.firm_id}/deliverables/${deliverableId}`
      : first?.event_payload?.deliverable_url ?? null;

    const isFirmMessage = first?.event_type === 'firm_message_new';

    const groupLabel = isFirmMessage
      ? 'CaseLoad messages'
      : matterName
      ? `Matter: ${escapeHtml(matterName)}`
      : deliverableTitle
        ? `Deliverable: ${escapeHtml(deliverableTitle)}`
        : groupKey !== '_no_matter'
          ? `Item ${escapeHtml(groupKey.slice(0, 8))}...`
          : 'Updates';

    const portalUrl = isFirmMessage && first?.firm_id
      ? recipientRole === 'operator'
        ? `${roleAwareOrigin(recipientRole)}/admin/firms/${first.firm_id}/messages`
        : `${roleAwareOrigin(recipientRole)}/portal/${first.firm_id}/messages`
      : deliverableUrl
      ? deliverableUrl
      : first?.matter_id && first?.firm_id
        ? recipientRole === 'lawyer'
          ? `${roleAwareOrigin(recipientRole)}/portal/${first.firm_id}/matters/${first.matter_id}`
          : `${roleAwareOrigin(recipientRole)}/portal/${first.firm_id}/m/${first.matter_id}`
        : null;

    const linkLabel = recipientRole === 'operator' ? 'Open in operator console' : 'Open in portal';
    const eventBlocks = groupRows.map((r) => eventBlockHtml(r, portalUrl, linkLabel)).join('');
    sections.push(`
      <section style="margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; color: #888; font-size: 13px;">${groupLabel}</p>
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

function eventBlockHtml(row: OutboxRow, portalUrl: string | null, linkLabel: string): string {
  const label = describeEvent(row.event_type);
  const fullBody = row.event_payload?.body ?? row.event_payload?.body_preview;
  const bodyText = fullBody
    ? fullBody.slice(0, 800)
    : null;
  const bodyHtml = bodyText
    ? `<p style="margin: 6px 0 0 0; color: #333; font-size: 14px; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(bodyText)}${fullBody && fullBody.length > 800 ? '...' : ''}</p>`
    : '';
  const linkHtml = portalUrl
    ? `<p style="margin: 8px 0 0 0;"><a href="${portalUrl}" style="color: #1E2F58; font-size: 13px; font-weight: 700;">${linkLabel}</a></p>`
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
    deliverable_review_requested: 'New version to review',
    deliverable_comment_added: 'New comment',
    deliverable_approved: 'Deliverable approved',
    deliverable_changes_requested: 'Changes requested',
    firm_message_new: 'New CaseLoad message',
    milestone_draft_ready: 'Quiet file: update due',
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
