import 'server-only';

/**
 * CaseLoad Connect data layer: operator-to-firm messaging.
 *
 * One shared channel per firm between the CaseLoad operator and the firm's
 * lawyers (Slack Connect model). NOT the lawyer-to-client matter thread;
 * those (matter_messages) stay privileged and firm-private.
 *
 * Service-role only. Callers MUST resolve auth (operator session for the
 * admin routes, firm session for the portal routes) and pass a trusted
 * actor before invoking the write helpers.
 */

import { supabaseAdmin as supabase } from './supabase-admin';
import { sanitizeMessageHtml } from './message-html-sanitize';
import type { MatterAttachment } from './types';

const ATTACHMENT_BUCKET = 'firm-files';
const SIGNED_URL_TTL = 3600; // 1 hour
const OPERATOR_PARTICIPANT = 'operator';
const OPERATOR_EMAIL = process.env.OPERATOR_NOTIFICATION_EMAIL ?? 'adriano@caseloadselect.ca';

export type OperatorFirmSenderRole = 'operator' | 'lawyer' | 'system';

export interface MessageReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface OperatorFirmMessage {
  id: string;
  channel_id: string;
  firm_id: string;
  parent_message_id: string | null;
  sender_role: OperatorFirmSenderRole;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  attachments: MatterAttachment[];
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  reactions: MessageReaction[];
  created_at: string;
}

/** Fixed reaction palette offered in the composer UI. */
export const REACTION_EMOJIS = ['👍', '✅', '🙏', '👀', '🎉', '❓'] as const;

/** The actor performing a write, resolved by the route from the session. */
export interface MessagingActor {
  role: 'operator' | 'lawyer';
  /** firm_lawyers.id for a lawyer; the OPERATOR_PARTICIPANT sentinel for the operator. */
  id: string;
  name: string;
}

/** The read-tracking participant key for an actor. */
export function participantKey(actor: MessagingActor): string {
  return actor.role === 'operator' ? OPERATOR_PARTICIPANT : actor.id;
}

async function signAttachments(attachments: MatterAttachment[]): Promise<MatterAttachment[]> {
  const paths = attachments
    .map((a, i) => ({ i, path: a.storage_path }))
    .filter((x): x is { i: number; path: string } => typeof x.path === 'string');
  if (paths.length === 0) return attachments;

  const signed = await Promise.all(
    paths.map(async ({ i, path }) => {
      const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
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
 * Get (or lazily create) the default CaseLoad channel for a firm.
 * Returns the channel id.
 */
export async function getOrCreateChannel(firmId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('operator_firm_channels')
    .select('id')
    .eq('firm_id', firmId)
    .eq('name', 'CaseLoad')
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from('operator_firm_channels')
    .insert({ firm_id: firmId, name: 'CaseLoad' })
    .select('id')
    .single();
  if (error) {
    // A concurrent create raced us; re-read.
    const { data: again } = await supabase
      .from('operator_firm_channels')
      .select('id')
      .eq('firm_id', firmId)
      .eq('name', 'CaseLoad')
      .maybeSingle();
    if (again?.id) return again.id as string;
    throw new Error(`channel create failed: ${error.message}`);
  }
  return created.id as string;
}

/**
 * List messages on a firm's channel, chronological, attachments pre-signed.
 * Soft-deleted messages return with an empty body and deleted_at set so the
 * renderer can show a tombstone without leaking the original text.
 */
export async function listFirmMessages(
  firmId: string,
  options: { limit?: number; viewerParticipant?: string } = {},
): Promise<OperatorFirmMessage[]> {
  const limit = options.limit ?? 300;
  const viewer = options.viewerParticipant ?? null;
  const channelId = await getOrCreateChannel(firmId);

  const { data } = await supabase
    .from('operator_firm_messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true })
    .limit(limit);

  const rows = (data ?? []) as OperatorFirmMessage[];
  const messageIds = rows.map((m) => m.id);

  // Reactions for all messages in one read, grouped per message + emoji.
  const reactionsByMessage = new Map<string, MessageReaction[]>();
  if (messageIds.length > 0) {
    const { data: reactionRows } = await supabase
      .from('operator_firm_message_reactions')
      .select('message_id, emoji, participant')
      .in('message_id', messageIds);
    const acc = new Map<string, Map<string, { count: number; mine: boolean }>>();
    for (const r of reactionRows ?? []) {
      const mid = r.message_id as string;
      const emoji = r.emoji as string;
      const byEmoji = acc.get(mid) ?? new Map();
      const cur = byEmoji.get(emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (viewer && r.participant === viewer) cur.mine = true;
      byEmoji.set(emoji, cur);
      acc.set(mid, byEmoji);
    }
    for (const [mid, byEmoji] of acc.entries()) {
      reactionsByMessage.set(
        mid,
        Array.from(byEmoji.entries()).map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
      );
    }
  }

  const withSigned = await Promise.all(
    rows.map(async (m) => {
      const reactions = reactionsByMessage.get(m.id) ?? [];
      const base = m.deleted_at
        ? { ...m, body: '', attachments: [], reactions }
        : { ...m, reactions };
      if (!base.attachments?.length) return base;
      return { ...base, attachments: await signAttachments(base.attachments) };
    }),
  );
  return withSigned;
}

/** Toggle a reaction on. Idempotent via the unique constraint. */
export async function addReaction(input: {
  firmId: string;
  messageId: string;
  actor: MessagingActor;
  emoji: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(REACTION_EMOJIS as readonly string[]).includes(input.emoji)) {
    return { ok: false, error: 'unsupported emoji' };
  }
  const { data: msg } = await supabase
    .from('operator_firm_messages')
    .select('id, firm_id')
    .eq('id', input.messageId)
    .maybeSingle();
  if (!msg || msg.firm_id !== input.firmId) return { ok: false, error: 'message not found' };

  const { error } = await supabase.from('operator_firm_message_reactions').upsert(
    {
      message_id: input.messageId,
      firm_id: input.firmId,
      participant: participantKey(input.actor),
      participant_label: input.actor.name,
      emoji: input.emoji,
    },
    { onConflict: 'message_id,participant,emoji' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Toggle a reaction off. */
export async function removeReaction(input: {
  firmId: string;
  messageId: string;
  actor: MessagingActor;
  emoji: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from('operator_firm_message_reactions')
    .delete()
    .eq('message_id', input.messageId)
    .eq('firm_id', input.firmId)
    .eq('participant', participantKey(input.actor))
    .eq('emoji', input.emoji);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Pin or unpin a message. Any participant may pin. */
export async function setPinned(input: {
  firmId: string;
  messageId: string;
  actor: MessagingActor;
  pinned: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: msg } = await supabase
    .from('operator_firm_messages')
    .select('id, firm_id, deleted_at')
    .eq('id', input.messageId)
    .maybeSingle();
  if (!msg || msg.firm_id !== input.firmId) return { ok: false, error: 'message not found' };
  if (msg.deleted_at) return { ok: false, error: 'message deleted' };

  const { error } = await supabase
    .from('operator_firm_messages')
    .update(
      input.pinned
        ? { pinned_at: new Date().toISOString(), pinned_by: input.actor.name }
        : { pinned_at: null, pinned_by: null },
    )
    .eq('id', input.messageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Insert a message. Caller MUST have resolved the actor from a trusted
 * session. Sanitizes the body, lazily creates the channel, queues a
 * notification to the OTHER party (best-effort).
 */
export async function sendFirmMessage(input: {
  firmId: string;
  actor: MessagingActor;
  body: string;
  attachments?: MatterAttachment[];
  parent_message_id?: string | null;
}): Promise<{ ok: true; message: OperatorFirmMessage } | { ok: false; error: string }> {
  const safeBody = sanitizeMessageHtml(input.body);
  const hasAttachments = (input.attachments?.length ?? 0) > 0;
  if (!safeBody && !hasAttachments) {
    return { ok: false, error: 'message is empty' };
  }

  const channelId = await getOrCreateChannel(input.firmId);

  const { data: inserted, error } = await supabase
    .from('operator_firm_messages')
    .insert({
      channel_id: channelId,
      firm_id: input.firmId,
      parent_message_id: input.parent_message_id ?? null,
      sender_role: input.actor.role,
      sender_id: input.actor.id,
      sender_name: input.actor.name,
      body: safeBody,
      attachments: input.attachments ?? [],
    })
    .select()
    .single();

  if (error) {
    return { ok: false, error: `message insert failed: ${error.message}` };
  }

  await enqueueFirmMessageNotification(inserted as OperatorFirmMessage).catch((err) => {
    console.warn('[operator-firm-messaging] notification enqueue failed:', err);
  });

  return { ok: true, message: inserted as OperatorFirmMessage };
}

/** Edit own message. Only the original sender may edit. */
export async function editFirmMessage(input: {
  messageId: string;
  firmId: string;
  actor: MessagingActor;
  body: string;
}): Promise<{ ok: true; message: OperatorFirmMessage } | { ok: false; error: string }> {
  const safeBody = sanitizeMessageHtml(input.body);
  if (!safeBody) return { ok: false, error: 'message is empty' };

  const { data: existing } = await supabase
    .from('operator_firm_messages')
    .select('id, firm_id, sender_role, sender_id, deleted_at')
    .eq('id', input.messageId)
    .maybeSingle();
  if (!existing || existing.firm_id !== input.firmId) {
    return { ok: false, error: 'message not found' };
  }
  if (existing.deleted_at) return { ok: false, error: 'message deleted' };
  if (!isOwnMessage(existing, input.actor)) {
    return { ok: false, error: 'not your message' };
  }

  const { data: updated, error } = await supabase
    .from('operator_firm_messages')
    .update({ body: safeBody, edited_at: new Date().toISOString() })
    .eq('id', input.messageId)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: updated as OperatorFirmMessage };
}

/** Soft-delete own message. */
export async function deleteFirmMessage(input: {
  messageId: string;
  firmId: string;
  actor: MessagingActor;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing } = await supabase
    .from('operator_firm_messages')
    .select('id, firm_id, sender_role, sender_id, deleted_at')
    .eq('id', input.messageId)
    .maybeSingle();
  if (!existing || existing.firm_id !== input.firmId) {
    return { ok: false, error: 'message not found' };
  }
  if (!isOwnMessage(existing, input.actor)) {
    return { ok: false, error: 'not your message' };
  }
  const { error } = await supabase
    .from('operator_firm_messages')
    .update({ deleted_at: new Date().toISOString(), body: '', attachments: [] })
    .eq('id', input.messageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function isOwnMessage(
  row: { sender_role: string; sender_id: string | null },
  actor: MessagingActor,
): boolean {
  return row.sender_role === actor.role && row.sender_id === actor.id;
}

/** Mark the firm's channel read up to now for the actor's participant key. */
export async function markFirmChannelRead(firmId: string, actor: MessagingActor): Promise<void> {
  const channelId = await getOrCreateChannel(firmId);
  await supabase
    .from('operator_firm_channel_reads')
    .upsert(
      {
        channel_id: channelId,
        firm_id: firmId,
        participant: participantKey(actor),
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'channel_id,participant' },
    );
}

/**
 * Unread count for the actor on a firm's channel: messages from the OTHER
 * side created after the actor's last_read_at. Soft-deleted messages excluded.
 */
export async function getFirmUnreadCount(firmId: string, actor: MessagingActor): Promise<number> {
  const channelId = await getOrCreateChannel(firmId);
  const { data: readRow } = await supabase
    .from('operator_firm_channel_reads')
    .select('last_read_at')
    .eq('channel_id', channelId)
    .eq('participant', participantKey(actor))
    .maybeSingle();

  const otherRoles = actor.role === 'operator' ? ['lawyer'] : ['operator', 'system'];
  let q = supabase
    .from('operator_firm_messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .in('sender_role', otherRoles);
  if (readRow?.last_read_at) q = q.gt('created_at', readRow.last_read_at);

  const { count } = await q;
  return count ?? 0;
}

/**
 * Operator unread counts across every firm, keyed by firm_id. Used by the
 * console home (attention bar total + per-firm card badge). Counts lawyer
 * messages newer than the operator's last_read for each firm.
 */
export async function getOperatorUnreadByFirm(): Promise<Map<string, number>> {
  const [{ data: msgs }, { data: reads }] = await Promise.all([
    supabase
      .from('operator_firm_messages')
      .select('firm_id, created_at')
      .eq('sender_role', 'lawyer')
      .is('deleted_at', null)
      .limit(5000),
    supabase
      .from('operator_firm_channel_reads')
      .select('firm_id, last_read_at')
      .eq('participant', OPERATOR_PARTICIPANT),
  ]);

  const lastReadByFirm = new Map<string, number>();
  for (const r of reads ?? []) {
    lastReadByFirm.set(r.firm_id as string, new Date(r.last_read_at as string).getTime());
  }

  const counts = new Map<string, number>();
  for (const m of msgs ?? []) {
    const firmId = m.firm_id as string;
    const createdMs = new Date(m.created_at as string).getTime();
    const lastRead = lastReadByFirm.get(firmId) ?? 0;
    if (createdMs > lastRead) counts.set(firmId, (counts.get(firmId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Queue notification_outbox rows for a new firm message, addressed to the
 * OTHER party. Operator/system sends notify the firm's lawyers; lawyer sends
 * notify the operator inbox. Best-effort.
 */
async function enqueueFirmMessageNotification(msg: OperatorFirmMessage): Promise<void> {
  const preview = msg.body.replace(/<[^>]*>/g, '').slice(0, 240);
  const payload = {
    message_id: msg.id,
    sender_role: msg.sender_role,
    sender_name: msg.sender_name,
    body_preview: preview,
    body: msg.body,
  };

  if (msg.sender_role === 'lawyer') {
    await supabase.from('notification_outbox').insert({
      recipient_email: OPERATOR_EMAIL,
      firm_id: msg.firm_id,
      matter_id: null,
      event_type: 'firm_message_new',
      event_payload: payload,
    });
    return;
  }

  // operator or system -> notify the firm's lawyers.
  const { data: lawyers } = await supabase
    .from('firm_lawyers')
    .select('id, email, email_notifications_enabled')
    .eq('firm_id', msg.firm_id);

  const recipients = new Set<string>();
  for (const l of lawyers ?? []) {
    if (l.email && l.email_notifications_enabled !== false) recipients.add(l.email as string);
  }
  if (recipients.size === 0) return;

  const rows = Array.from(recipients).map((email) => ({
    recipient_email: email,
    firm_id: msg.firm_id,
    matter_id: null,
    event_type: 'firm_message_new' as const,
    event_payload: payload,
  }));
  await supabase.from('notification_outbox').insert(rows);
}
