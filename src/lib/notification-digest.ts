import { roleAwareOrigin } from "@/lib/app-origins";

type RecipientRole = 'lawyer' | 'operator' | 'client';

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
