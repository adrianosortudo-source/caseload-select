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
  MatterAttachment,
  ActorRole,
  RecipientScope,
} from './types';
import { visibleChannelsForRole, sanitiseBody, notificationEventType } from './matter-messages-pure';
import { sanitizeMessageHtml } from './message-html-sanitize';
import { writeActivity, type ActivityActorRole } from './crm-dual-write';

const ATTACHMENT_BUCKET = 'firm-files';
const SIGNED_URL_TTL = 3600; // 1 hour

/**
 * Sign all storage_path entries in an attachment array.
 * Best-effort: a signing failure leaves signed_url absent but does not
 * throw or drop the attachment from the list.
 */
async function signAttachments(
  attachments: MatterAttachment[],
): Promise<MatterAttachment[]> {
  const paths = attachments
    .map((a, i) => ({ i, path: a.storage_path }))
    .filter((x): x is { i: number; path: string } => typeof x.path === 'string');

  if (paths.length === 0) return attachments;

  const signed = await Promise.all(
    paths.map(async ({ i, path }) => {
      const { data } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
      return { i, signed_url: data?.signedUrl ?? undefined };
    }),
  );

  const result = attachments.map((a) => ({ ...a }));
  for (const { i, signed_url } of signed) {
    if (signed_url) result[i] = { ...result[i], signed_url };
  }
  return result;
}

/**
 * List messages on a matter, filtered by the role's visible channels.
 * Attachment storage_path entries are pre-signed (1h TTL) before return.
 * Returns up to `limit` messages in chronological order.
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

  const messages = (data ?? []) as MatterMessage[];

  // Sign attachments in parallel across all messages.
  const withSignedUrls = await Promise.all(
    messages.map(async (m) => {
      if (!m.attachments?.length) return m;
      return { ...m, attachments: await signAttachments(m.attachments) };
    }),
  );

  return withSignedUrls;
}

/**
 * Insert a new message. Caller MUST have validated channel-write
 * permission via `canWriteChannel(role, channel_type)`.
 *
 * Also queues a notification_outbox row for digest delivery.
 * The notification queue write is best-effort; if it fails, the
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
  attachments?: MatterAttachment[];
  broadcast_id?: string | null;
  parent_message_id?: string | null;
  /**
   * When false, the matter client is not added as a notification recipient
   * (lawyers and assignees still are). The welcome send uses this for themed
   * firms, where a standalone branded email replaces the client's digest copy.
   * Defaults to true, so every other caller keeps notifying the client.
   */
  notifyClient?: boolean;
}): Promise<
  | { ok: true; message: MatterMessage }
  | { ok: false; error: string }
> {
  const cleanBody = sanitiseBody(input.body);
  if (!cleanBody) {
    return { ok: false, error: 'body is empty after sanitisation' };
  }
  // HTML-sanitize before storage: bodies render via dangerouslySetInnerHTML in
  // both threads, so an unsanitized body is a stored XSS vector from the client
  // into the lawyer/operator origin. Plain text survives (a stray "<" is
  // encoded, not dropped); a small rich subset is allowed for welcome sends.
  const safeBody = sanitizeMessageHtml(cleanBody);
  if (!safeBody) {
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
      body: safeBody,
      attachments: input.attachments ?? [],
      broadcast_id: input.broadcast_id ?? null,
      parent_message_id: input.parent_message_id ?? null,
    })
    .select()
    .single();

  if (insertErr) {
    return { ok: false, error: `message insert failed: ${insertErr.message}` };
  }

  // Queue notification (best-effort).
  await enqueueMessageNotification(
    inserted as MatterMessage,
    input.notifyClient ?? true,
  ).catch((err) => {
    console.warn('[matter-messages] notification enqueue failed:', err);
  });

  // M1 canonical model dual-write (best-effort, never blocks the send).
  const label = input.channel_type === 'client' ? 'client message' : 'internal note';
  void writeActivity({
    matterId: input.matter_id,
    firmId: input.firm_id,
    activityType: 'message',
    title: `${input.sender_role} sent ${label} (${input.channel_type})`,
    body: safeBody,
    actorRole: input.sender_role as ActivityActorRole,
    metadata: { channel_type: input.channel_type, recipient_scope: input.recipient_scope ?? 'individual' },
  });

  return { ok: true, message: inserted as MatterMessage };
}

/**
 * Queue notification_outbox rows for a new message. Resolves recipients
 * from the matter's role assignments (client vs internal staff) and
 * inserts one outbox row per recipient.
 *
 *   channel_type='client'   : primary_email + lead_lawyer + assignees
 *   channel_type='internal' : lead_lawyer + assignees (NEVER client)
 */
async function enqueueMessageNotification(
  msg: MatterMessage,
  notifyClient = true,
): Promise<void> {
  const { data: matter } = await supabase
    .from('client_matters')
    .select('lead_id, assignee_ids, primary_email, primary_name, firm_id')
    .eq('id', msg.matter_id)
    .maybeSingle();
  if (!matter) return;

  const recipients = new Set<string>();
  const lawyerIds: string[] = [];
  if (matter.lead_id) lawyerIds.push(matter.lead_id);
  if (Array.isArray(matter.assignee_ids)) {
    for (const id of matter.assignee_ids) if (typeof id === 'string') lawyerIds.push(id);
  }

  if (lawyerIds.length > 0) {
    const { data: lawyers } = await supabase
      .from('firm_lawyers')
      .select('id, email, email_notifications_enabled')
      .in('id', lawyerIds);
    for (const l of lawyers ?? []) {
      if (l.email && l.email_notifications_enabled !== false) recipients.add(l.email);
    }
  }

  // Client recipient on client-channel messages (skip when client is the sender,
  // or when the caller opted out via notifyClient=false).
  if (
    notifyClient &&
    msg.channel_type === 'client' &&
    matter.primary_email &&
    msg.sender_role !== 'client'
  ) {
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
      body: msg.body,
      primary_name: matter.primary_name ?? null,
    },
  }));

  await supabase.from('notification_outbox').insert(rows);
}

/**
 * Stub for Phase 2 per-individual-message read tracking.
 */
export async function markMatterMessagesRead(
  matterId: string,
  _role: ActorRole,
): Promise<void> {
  void matterId;
}
