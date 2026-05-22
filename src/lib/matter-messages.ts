/**
 * Data-access helpers for matter_messages + matter_message_recipients.
 *
 * Imports `supabaseAdmin`. Routes that call these helpers MUST enforce
 * role + channel-write permission via `canWriteChannel` / role gating
 * before invoking.
 */

import { supabaseAdmin as supabase } from './supabase-admin';
import type {
  ChannelType,
  MatterMessage,
  ActorRole,
  RecipientScope,
} from './types';
import { visibleChannelsForRole, sanitiseBody, notificationEventType } from './matter-messages-pure';

/**
 * List messages on a matter, filtered by the role's visible channels.
 * Returns up to `limit` messages in chronological order (oldest first
 * is more useful in a thread view; the caller can reverse for newest-
 * first listing).
 */
export async function listMessagesForMatter(
  matterId: string,
  role: ActorRole,
  options: { limit?: number; channel?: ChannelType } = {},
): Promise<MatterMessage[]> {
  const limit = options.limit ?? 200;
  const visible = visibleChannelsForRole(role);
  const channels = options.channel
    ? visible.includes(options.channel)
      ? [options.channel]
      : []
    : visible;

  if (channels.length === 0) return [];

  const { data } = await supabase
    .from('matter_messages')
    .select('*')
    .eq('matter_id', matterId)
    .in('channel_type', channels)
    .order('created_at', { ascending: true })
    .limit(limit);

  return (data ?? []) as MatterMessage[];
}

/**
 * Insert a new message. Caller MUST have validated channel-write
 * permission via `canWriteChannel(role, channel_type)`.
 *
 * Also queues a notification_outbox row for digest delivery (S09).
 * The notification queue write is best-effort — if it fails, the
 * message still lands.
 */
export async function insertMessage(input: {
  matter_id: string;
  firm_id: string;
  channel_type: ChannelType;
  recipient_scope?: RecipientScope;
  sender_role: 'admin' | 'staff' | 'client' | 'system';
  sender_lawyer_id?: string | null;
  sender_client_email?: string | null;
  body: string;
  attachments?: Array<{ url: string; name: string; size?: number; mime?: string }>;
  broadcast_id?: string | null;
}): Promise<
  | { ok: true; message: MatterMessage }
  | { ok: false; error: string }
> {
  const cleanBody = sanitiseBody(input.body);
  if (!cleanBody) {
    return { ok: false, error: 'body is empty after sanitisation' };
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('matter_messages')
    .insert({
      matter_id: input.matter_id,
      firm_id: input.firm_id,
      channel_type: input.channel_type,
      recipient_scope: input.recipient_scope ?? 'individual',
      sender_role: input.sender_role,
      sender_lawyer_id: input.sender_lawyer_id ?? null,
      sender_client_email: input.sender_client_email ?? null,
      body: cleanBody,
      attachments: input.attachments ?? [],
      broadcast_id: input.broadcast_id ?? null,
    })
    .select()
    .single();

  if (insertErr) {
    return { ok: false, error: `message insert failed: ${insertErr.message}` };
  }

  // Queue notification (best-effort).
  await enqueueMessageNotification(inserted as MatterMessage).catch((err) => {
    console.warn('[matter-messages] notification enqueue failed:', err);
  });

  return { ok: true, message: inserted as MatterMessage };
}

/**
 * Queue a notification_outbox row for a new message. Resolves the
 * recipients from the matter's role assignments (client vs internal
 * staff) and inserts one outbox row per recipient.
 *
 * Phase 1 keeps the recipient resolution simple:
 *   - channel_type='client'    : matter.primary_email + lead_lawyer +
 *                                assignees
 *   - channel_type='internal'  : lead_lawyer + assignees (NEVER client)
 *
 * Phase 2 will add the group/company recipient_scope branches.
 */
async function enqueueMessageNotification(msg: MatterMessage): Promise<void> {
  const { data: matter } = await supabase
    .from('client_matters')
    .select('lead_id, assignee_ids, primary_email, firm_id')
    .eq('id', msg.matter_id)
    .maybeSingle();
  if (!matter) return;

  const recipients = new Set<string>();
  const lawyerIds: string[] = [];
  if (matter.lead_id) lawyerIds.push(matter.lead_id);
  if (Array.isArray(matter.assignee_ids)) {
    for (const id of matter.assignee_ids) if (typeof id === 'string') lawyerIds.push(id);
  }

  // Resolve lawyer ids to email addresses.
  if (lawyerIds.length > 0) {
    const { data: lawyers } = await supabase
      .from('firm_lawyers')
      .select('id, email, email_notifications_enabled')
      .in('id', lawyerIds);
    for (const l of lawyers ?? []) {
      if (l.email && l.email_notifications_enabled !== false) recipients.add(l.email);
    }
  }

  // Client recipient on client-channel messages.
  if (msg.channel_type === 'client' && matter.primary_email && msg.sender_role !== 'client') {
    recipients.add(matter.primary_email);
  }

  if (recipients.size === 0) return;

  const eventType = notificationEventType(msg.channel_type);
  const rows = Array.from(recipients).map((email) => ({
    recipient_email: email,
    firm_id: msg.firm_id,
    matter_id: msg.matter_id,
    event_type: eventType,
    event_payload: {
      message_id: msg.id,
      channel_type: msg.channel_type,
      sender_role: msg.sender_role,
      body_preview: msg.body.slice(0, 240),
    },
  }));

  await supabase.from('notification_outbox').insert(rows);
}

/**
 * Mark all messages on a matter as read for a given matter_message
 * scope. Phase 1 only tracks message-level reads on broadcast
 * recipients (matter_message_recipients.read_at); individual messages
 * don't have a read column. Stubbed for future use.
 */
export async function markMatterMessagesRead(
  matterId: string,
  _role: ActorRole,
): Promise<void> {
  // Phase 1: no per-individual-message read tracking. The matter view
  // can show "X new since you last opened" by comparing to a session
  // timestamp held client-side. This hook exists for Phase 2.
  void matterId;
}
