import 'server-only';

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { requireChannelConversationLedger } from '@/lib/channel-conversation-gate';

export type ConversationChannel = 'facebook' | 'instagram' | 'whatsapp';
export type ConversationDirection = 'inbound' | 'outbound';
export type ConversationSource =
  | 'webhook'
  | 'intake_automation'
  | 'operator'
  | 'expiry_cron';
export type ConversationStatus = 'received' | 'pending' | 'sent' | 'failed';
export type ConversationActorType = 'lead' | 'system' | 'operator' | 'lawyer';

/** Shared portal compose limit. Channel-specific limits can be stricter. */
export const CHANNEL_PORTAL_TEXT_LIMIT = 2000;
export const CHANNEL_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Provider and application clocks may differ slightly; larger future drift is not evidence. */
export const CHANNEL_INBOUND_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const INSTAGRAM_TEXT_BYTE_LIMIT = 1000;
export const WHATSAPP_TEXT_LIMIT = 4096;

export interface ChannelConversationMessage {
  id: string;
  channel: ConversationChannel;
  direction: ConversationDirection;
  source: ConversationSource;
  body: string;
  status: ConversationStatus;
  metaMessageId: string | null;
  clientRequestId: string | null;
  actorType: ConversationActorType;
  actorId: string | null;
  occurredAt: string;
  failureReason: string | null;
}

export type ChannelReplyWindowReason =
  | 'open'
  | 'expired'
  | 'no_authoritative_inbound';

export interface ChannelReplyWindow {
  isOpen: boolean;
  lastInboundAt: string | null;
  closesAt: string | null;
  reason: ChannelReplyWindowReason;
}

export interface ChannelConversation {
  messages: ChannelConversationMessage[];
  replyWindow: ChannelReplyWindow;
}

interface ConversationEventRow {
  id: string;
  channel: ConversationChannel;
  direction: ConversationDirection;
  source: ConversationSource;
  body: string;
  status: ConversationStatus;
  meta_message_id: string | null;
  client_request_id: string | null;
  actor_type: ConversationActorType;
  actor_id: string | null;
  authoritative_inbound: boolean;
  occurred_at: string;
  failure_reason: string | null;
  created_at: string;
}

function validTimestamp(
  value: string | null | undefined,
  now: Date,
): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  const nowMs = now.getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)) return null;
  if (timestamp > nowMs + CHANNEL_INBOUND_CLOCK_SKEW_MS) return null;
  return timestamp;
}

/**
 * Normalize verified provider time without manufacturing evidence. Missing,
 * malformed, or unreasonably future values return null; callers may continue
 * processing the inbound, but free-form outbound messaging must fail closed.
 */
export function normalizeAuthoritativeInboundAt(
  value: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const timestamp = validTimestamp(value, now);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

/**
 * Meta's standard reply window is strict: `now < inbound + 24h`.
 * Exactly 24 hours is closed. Missing/invalid legacy evidence fails closed.
 */
export function isChannelReplyWindowOpen(
  lastInboundAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const inboundMs = validTimestamp(lastInboundAt, now);
  const nowMs = now.getTime();
  if (inboundMs === null || !Number.isFinite(nowMs)) return false;
  return nowMs < inboundMs + CHANNEL_REPLY_WINDOW_MS;
}

export function getChannelReplyWindow(
  lastInboundAt: string | null | undefined,
  now: Date = new Date(),
): ChannelReplyWindow {
  const inboundMs = validTimestamp(lastInboundAt, now);
  if (inboundMs === null) {
    return {
      isOpen: false,
      lastInboundAt: null,
      closesAt: null,
      reason: 'no_authoritative_inbound',
    };
  }
  const lastInboundIso = new Date(inboundMs).toISOString();
  const closesAt = new Date(inboundMs + CHANNEL_REPLY_WINDOW_MS).toISOString();
  const isOpen = isChannelReplyWindowOpen(lastInboundIso, now);
  return {
    isOpen,
    lastInboundAt: lastInboundIso,
    closesAt,
    reason: isOpen ? 'open' : 'expired',
  };
}

export interface ChannelTextValidation {
  valid: boolean;
  reason?: string;
}

/** Validate the external API limit; the portal applies its 2,000-char cap too. */
export function validateChannelText(
  channel: ConversationChannel,
  text: string,
): ChannelTextValidation {
  if (!text.trim()) return { valid: false, reason: 'message text is required' };
  const characterCount = Array.from(text).length;
  if (channel === 'instagram') {
    const byteCount = new TextEncoder().encode(text).byteLength;
    if (byteCount > INSTAGRAM_TEXT_BYTE_LIMIT) {
      return {
        valid: false,
        reason: `Instagram messages must be ${INSTAGRAM_TEXT_BYTE_LIMIT} UTF-8 bytes or fewer`,
      };
    }
    return { valid: true };
  }
  const limit = channel === 'whatsapp' ? WHATSAPP_TEXT_LIMIT : CHANNEL_PORTAL_TEXT_LIMIT;
  if (characterCount > limit) {
    return {
      valid: false,
      reason: `${channel === 'facebook' ? 'Messenger' : 'WhatsApp'} messages must be ${limit} characters or fewer`,
    };
  }
  return { valid: true };
}

function toMessage(row: ConversationEventRow): ChannelConversationMessage {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    source: row.source,
    body: row.body,
    status: row.status,
    metaMessageId: row.meta_message_id,
    clientRequestId: row.client_request_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    failureReason: row.failure_reason,
  };
}

/** Collapse append-only pending + terminal events into one displayed message. */
export function collapseConversationEvents(
  rows: ConversationEventRow[],
): ChannelConversationMessage[] {
  const output: ChannelConversationMessage[] = [];
  const outboundByRequest = new Map<string, number>();
  for (const row of rows) {
    const message = toMessage(row);
    if (row.direction === 'outbound' && row.client_request_id) {
      const existingIndex = outboundByRequest.get(row.client_request_id);
      if (existingIndex === undefined) {
        outboundByRequest.set(row.client_request_id, output.length);
        output.push(message);
      } else if (row.status !== 'pending') {
        output[existingIndex] = message;
      }
    } else {
      output.push(message);
    }
  }
  return output.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accept the internal UUID or the portal-facing screened_leads.lead_id. */
export async function resolveScreenedLeadIdForFirm(
  firmId: string,
  screenedLeadRef: string,
): Promise<string | null> {
  const column = UUID_PATTERN.test(screenedLeadRef) ? 'id' : 'lead_id';
  const { data, error } = await supabase
    .from('screened_leads')
    .select('id')
    .eq(column, screenedLeadRef)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (error) throw new Error('conversation lead ownership lookup failed');
  return data ? (data.id as string) : null;
}

export async function screenedLeadBelongsToFirm(
  firmId: string,
  screenedLeadRef: string,
): Promise<boolean> {
  return !!(await resolveScreenedLeadIdForFirm(firmId, screenedLeadRef));
}

export async function loadChannelConversation(args: {
  firmId: string;
  screenedLeadId: string;
  now?: Date;
}): Promise<ChannelConversation | null> {
  await requireChannelConversationLedger(args.firmId);
  const resolvedLeadId = await resolveScreenedLeadIdForFirm(
    args.firmId,
    args.screenedLeadId,
  );
  if (!resolvedLeadId) return null;
  const timelineQuery = supabase
    .from('channel_conversation_events')
    .select(
      'id, channel, direction, source, body, status, meta_message_id, client_request_id, actor_type, actor_id, authoritative_inbound, occurred_at, failure_reason, created_at',
    )
    .eq('firm_id', args.firmId)
    .eq('screened_lead_id', resolvedLeadId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  const latestInboundQuery = supabase
    .from('channel_conversation_events')
    .select('occurred_at')
    .eq('firm_id', args.firmId)
    .eq('screened_lead_id', resolvedLeadId)
    .eq('authoritative_inbound', true)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const [timeline, latestInbound] = await Promise.all([
    timelineQuery,
    latestInboundQuery,
  ]);
  if (timeline.error || latestInbound.error) {
    throw new Error('conversation ledger lookup failed');
  }
  // The database returns the newest page. Reverse only that bounded page for
  // chronological projection; do not derive the reply window from it.
  const rows = ((timeline.data ?? []) as ConversationEventRow[]).slice().reverse();
  const lastInboundAt =
    (latestInbound.data?.occurred_at as string | null | undefined) ?? null;
  return {
    messages: collapseConversationEvents(rows),
    replyWindow: getChannelReplyWindow(lastInboundAt, args.now),
  };
}

export interface RecordInboundEventArgs {
  firmId: string;
  screenedLeadId: string;
  channel: ConversationChannel;
  body: string;
  metaMessageId: string;
  occurredAt: string;
}

export async function recordInboundConversationEvent(
  args: RecordInboundEventArgs,
): Promise<{ ok: boolean; duplicate?: boolean }> {
  try {
    await requireChannelConversationLedger(args.firmId);
  } catch {
    return { ok: false };
  }
  const occurredAt = normalizeAuthoritativeInboundAt(args.occurredAt);
  if (!occurredAt) {
    console.warn('[channel-conversation] rejected invalid authoritative inbound time');
    return { ok: false };
  }
  const { error } = await supabase.from('channel_conversation_events').insert({
    firm_id: args.firmId,
    screened_lead_id: args.screenedLeadId,
    channel: args.channel,
    direction: 'inbound',
    source: 'webhook',
    body: args.body,
    status: 'received',
    meta_message_id: args.metaMessageId,
    actor_type: 'lead',
    authoritative_inbound: true,
    occurred_at: occurredAt,
  });
  if (!error) return { ok: true };
  if (error.code === '23505') return { ok: true, duplicate: true };
  console.warn('[channel-conversation] inbound ledger write failed');
  return { ok: false };
}

export interface OutboundLedgerContext {
  screenedLeadId: string;
  source: Exclude<ConversationSource, 'webhook'>;
  actorType: Exclude<ConversationActorType, 'lead'>;
  actorId?: string | null;
  clientRequestId: string;
  requireOpenWindow?: boolean;
}

export async function claimOutboundConversationEvent(args: {
  firmId: string;
  channel: ConversationChannel;
  text: string;
  ledger: OutboundLedgerContext;
}): Promise<{ claimed: boolean; duplicate: boolean }> {
  await requireChannelConversationLedger(args.firmId);
  const { error } = await supabase.from('channel_conversation_events').insert({
    firm_id: args.firmId,
    screened_lead_id: args.ledger.screenedLeadId,
    channel: args.channel,
    direction: 'outbound',
    source: args.ledger.source,
    body: args.text,
    status: 'pending',
    client_request_id: args.ledger.clientRequestId,
    actor_type: args.ledger.actorType,
    actor_id: args.ledger.actorId ?? null,
    occurred_at: new Date().toISOString(),
  });
  if (!error) return { claimed: true, duplicate: false };
  if (error.code === '23505') return { claimed: false, duplicate: true };
  throw new Error('outbound ledger claim failed');
}

export interface RecordOutboundConversationResult {
  recorded: boolean;
  duplicate: boolean;
}

export async function recordOutboundConversationResult(args: {
  firmId: string;
  channel: ConversationChannel;
  text: string;
  ledger: OutboundLedgerContext;
  sent: boolean;
  metaMessageId?: string | null;
  failureReason?: string | null;
}): Promise<RecordOutboundConversationResult> {
  try {
    await requireChannelConversationLedger(args.firmId);
  } catch {
    return { recorded: false, duplicate: false };
  }
  const failureReason = args.sent
    ? null
    : (args.failureReason?.slice(0, 500) || 'channel send failed');
  const { error } = await supabase.from('channel_conversation_events').insert({
    firm_id: args.firmId,
    screened_lead_id: args.ledger.screenedLeadId,
    channel: args.channel,
    direction: 'outbound',
    source: args.ledger.source,
    body: args.text,
    status: args.sent ? 'sent' : 'failed',
    meta_message_id: args.metaMessageId ?? null,
    client_request_id: args.ledger.clientRequestId,
    actor_type: args.ledger.actorType,
    actor_id: args.ledger.actorId ?? null,
    occurred_at: new Date().toISOString(),
    failure_reason: failureReason,
  });
  if (!error) return { recorded: true, duplicate: false };
  if (error.code === '23505') return { recorded: false, duplicate: true };
  console.warn('[channel-conversation] outbound result ledger write failed');
  return { recorded: false, duplicate: false };
}

export async function loadOutboundConversationResult(args: {
  firmId: string;
  clientRequestId: string;
}): Promise<ChannelConversationMessage | null> {
  await requireChannelConversationLedger(args.firmId);
  const { data, error } = await supabase
    .from('channel_conversation_events')
    .select(
      'id, channel, direction, source, body, status, meta_message_id, client_request_id, actor_type, actor_id, authoritative_inbound, occurred_at, failure_reason, created_at',
    )
    .eq('firm_id', args.firmId)
    .eq('client_request_id', args.clientRequestId)
    .in('status', ['sent', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('outbound idempotency lookup failed');
  return data ? toMessage(data as ConversationEventRow) : null;
}
