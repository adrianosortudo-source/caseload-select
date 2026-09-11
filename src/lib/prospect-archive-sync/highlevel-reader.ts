import 'server-only';

import type { ArchiveSyncHistoryObservation, ArchiveSyncProviderEvent } from './types';
import type { ArchiveReaderIdentity } from './reader-contract';

const BASE_URL = 'https://services.leadconnectorhq.com';
const CONTACTS_VERSION = '2021-07-28';
const CONVERSATIONS_VERSION = '2021-04-15';
const MAX_PAGES_PER_CONVERSATION = 50;
const MAX_EVENTS_PER_CONTACT = 2_000;

export const HIGHLEVEL_ARCHIVE_TOKEN_ENV = 'GHL_CASELOAD_SELECT_TOKEN';

export type DirectArchiveReaderIssue = {
  cls_record_id: string;
  highlevel_contact_id: string;
  reason: 'contact_unavailable' | 'conversation_unavailable' | 'message_stream_incomplete' | 'message_for_another_contact' | 'unclassified_inbound';
  provider_event_id?: string;
};

export type DirectArchiveReaderResult = {
  bundle: {
    schema_version: 'prospect-archive-sync-bundle.v1';
    highlevel_location_id: string;
    provider_events: ArchiveSyncProviderEvent[];
    history_observations: ArchiveSyncHistoryObservation[];
  };
  contacts_read: number;
  issues: DirectArchiveReaderIssue[];
};

type FetchLike = typeof fetch;
type JsonResult = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; detail: string };
type HighLevelMessage = Record<string, unknown>;

function string(value: unknown, max = 20_000): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
}

function instant(value: unknown): string | null {
  const text = string(value, 100);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function messageList(value: Record<string, unknown>): HighLevelMessage[] {
  const messages = value.messages;
  if (Array.isArray(messages)) return messages.filter((item): item is HighLevelMessage => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  if (messages && typeof messages === 'object' && Array.isArray((messages as Record<string, unknown>).messages)) {
    return ((messages as Record<string, unknown>).messages as unknown[]).filter((item): item is HighLevelMessage => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  }
  return [];
}

function responseEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  return value.messages && typeof value.messages === 'object' && !Array.isArray(value.messages)
    ? value.messages as Record<string, unknown>
    : value;
}

function isAutomated(message: HighLevelMessage): boolean {
  const subject = string(message.subject) ?? string((message.meta as Record<string, unknown> | undefined)?.email && ((message.meta as Record<string, unknown>).email as Record<string, unknown>).subject) ?? '';
  const body = string(message.body) ?? string(message.message) ?? '';
  const from = string(message.from) ?? '';
  return /mailer-daemon|mail delivery subsystem|postmaster@|delivery status notification|undeliverable|delivery failed|automatic reply|auto[- ]?reply|autoreply|out of (?:the )?office|auto[-_ ]?submitted/i.test(`${subject}\n${body}\n${from}`);
}

function isFailure(message: HighLevelMessage): boolean {
  const status = (string(message.status, 100) ?? '').toLowerCase();
  return ['failed', 'bounced', 'undelivered', 'error'].includes(status) || Boolean(string(message.error));
}

function messageEvent(message: HighLevelMessage, locationId: string, contactId: string, observedAt: string): ArchiveSyncProviderEvent | null {
  const eventId = string(message.id, 500);
  const occurredAt = instant(message.dateAdded) ?? instant(message.createdAt) ?? instant(message.updatedAt);
  if (!eventId || !occurredAt) return null;
  const direction = (string(message.direction, 100) ?? '').toLowerCase();
  const subject = string(message.subject, 1_000) ?? string(((message.meta as Record<string, unknown> | undefined)?.email as Record<string, unknown> | undefined)?.subject, 1_000);
  const body = string(message.body) ?? string(message.message);
  const from = string(message.from, 320);
  const to = string(message.to, 320);
  if (direction === 'outbound') {
    const failed = isFailure(message);
    return {
      provider_event_id: eventId, highlevel_location_id: locationId, highlevel_contact_id: contactId,
      kind: failed ? 'bounce' : 'message_sent', channel: 'email', occurred_at: occurredAt,
      subject, body, from_endpoint: from, to_endpoints: to ? [to] : [],
      delivery_status: failed ? 'bounced' : 'sent', response_kind: 'none', provider_observed_at: observedAt,
    };
  }
  if (direction === 'inbound' && isAutomated(message)) {
    return {
      provider_event_id: eventId, highlevel_location_id: locationId, highlevel_contact_id: contactId,
      kind: 'automated_reply', channel: 'email', occurred_at: occurredAt,
      subject, body, from_endpoint: from, to_endpoints: to ? [to] : [],
      delivery_status: 'unknown', response_kind: 'automated', provider_observed_at: observedAt,
    };
  }
  // The provider has already scoped this to an exact contact and labelled it
  // inbound email. Preserve that fact as a human reply unless it matches one
  // of the automated-response markers above; do not guess intent or outcome.
  if (direction === 'inbound') {
    return {
      provider_event_id: eventId, highlevel_location_id: locationId, highlevel_contact_id: contactId,
      kind: 'human_reply', channel: 'email', occurred_at: occurredAt,
      subject, body, from_endpoint: from, to_endpoints: to ? [to] : [],
      delivery_status: 'unknown', response_kind: 'human', provider_observed_at: observedAt,
    };
  }
  return null;
}

function providerError(value: unknown): string {
  if (!value || typeof value !== 'object') return 'HighLevel returned an unreadable error response.';
  const record = value as Record<string, unknown>;
  return string(record.message, 500) ?? string(record.error, 500) ?? 'HighLevel rejected this read-only request.';
}

async function getJson(fetchLike: FetchLike, token: string, resource: string, version: string): Promise<JsonResult> {
  const response = await fetchLike(`${BASE_URL}${resource}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, Version: version },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) return { ok: false, status: response.status, detail: providerError(data) };
  return { ok: true, data: data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {} };
}

function assertDirectory(records: readonly ArchiveReaderIdentity[], locationId: string): void {
  if (records.length !== 100 || records.filter((record) => record.arm === 'BA').length !== 50 || records.filter((record) => record.arm === 'AE').length !== 50) {
    throw new Error('Direct archive sync requires exactly 50 BA and 50 AE records.');
  }
  const ids = new Set(records.map((record) => record.highlevel_contact_id));
  if (ids.size !== records.length || records.some((record) => record.highlevel_location_id !== locationId)) {
    throw new Error('Direct archive sync requires one exact HighLevel location and unique contact IDs.');
  }
}

/**
 * Reads only the established BA/AE contact IDs. There is intentionally no
 * provider-wide export, workflow request, contact write, or KS traversal.
 */
export async function readHighLevelArchive(input: {
  records: readonly ArchiveReaderIdentity[];
  highlevelLocationId: string;
  token: string | null | undefined;
  fetchLike?: FetchLike;
  now?: Date;
}): Promise<DirectArchiveReaderResult> {
  const token = string(input.token, 4_096);
  if (!token) throw new Error(`${HIGHLEVEL_ARCHIVE_TOKEN_ENV} is required for direct archive sync.`);
  assertDirectory(input.records, input.highlevelLocationId);
  const fetchLike = input.fetchLike ?? fetch;
  const observedAt = (input.now ?? new Date()).toISOString();
  const first = input.records[0];
  const preflight = await getJson(fetchLike, token, `/contacts/${encodeURIComponent(first.highlevel_contact_id)}`, CONTACTS_VERSION);
  if (!preflight.ok) throw new Error(`Direct archive sync stopped at the authenticated contact preflight (${preflight.status}).`);
  const firstContact = (preflight.data.contact ?? preflight.data) as Record<string, unknown>;
  if (string(firstContact.id, 500) !== first.highlevel_contact_id || string(firstContact.locationId, 200) !== input.highlevelLocationId) {
    throw new Error('Direct archive sync preflight did not return the expected contact in the configured location.');
  }

  const providerEvents: ArchiveSyncProviderEvent[] = [];
  const observations: ArchiveSyncHistoryObservation[] = [];
  const issues: DirectArchiveReaderIssue[] = [];
  let contactsRead = 0;

  for (const record of input.records) {
    const contact = record.highlevel_contact_id === first.highlevel_contact_id
      ? preflight
      : await getJson(fetchLike, token, `/contacts/${encodeURIComponent(record.highlevel_contact_id)}`, CONTACTS_VERSION);
    if (!contact.ok) {
      observations.push({ highlevel_location_id: input.highlevelLocationId, highlevel_contact_id: record.highlevel_contact_id, history_coverage: 'history_unknown', observed_at: observedAt });
      issues.push({ cls_record_id: record.cls_record_id, highlevel_contact_id: record.highlevel_contact_id, reason: 'contact_unavailable' });
      continue;
    }
    const contactRecord = (contact.data.contact ?? contact.data) as Record<string, unknown>;
    if (string(contactRecord.id, 500) !== record.highlevel_contact_id || string(contactRecord.locationId, 200) !== input.highlevelLocationId) {
      throw new Error(`Direct archive sync received an unexpected contact identity for ${record.cls_record_id}.`);
    }
    contactsRead += 1;
    const search = new URLSearchParams({ locationId: input.highlevelLocationId, contactId: record.highlevel_contact_id, limit: '100', sort: 'asc', status: 'all' });
    const conversationsResult = await getJson(fetchLike, token, `/conversations/search?${search}`, CONVERSATIONS_VERSION);
    if (!conversationsResult.ok) {
      observations.push({ highlevel_location_id: input.highlevelLocationId, highlevel_contact_id: record.highlevel_contact_id, history_coverage: 'history_unknown', observed_at: observedAt });
      issues.push({ cls_record_id: record.cls_record_id, highlevel_contact_id: record.highlevel_contact_id, reason: 'conversation_unavailable' });
      continue;
    }
    const conversations = Array.isArray(conversationsResult.data.conversations) ? conversationsResult.data.conversations.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
    let complete = true;
    let eventsForContact = 0;
    for (const conversation of conversations) {
      if (string(conversation.contactId, 500) !== record.highlevel_contact_id) {
        complete = false;
        continue;
      }
      const conversationId = string(conversation.id, 500);
      if (!conversationId) { complete = false; continue; }
      let lastMessageId: string | null = null;
      const seen = new Set<string>();
      for (let page = 0; page < MAX_PAGES_PER_CONVERSATION; page += 1) {
        const query = new URLSearchParams({ limit: '100', type: 'TYPE_EMAIL' });
        if (lastMessageId) query.set('lastMessageId', lastMessageId);
        const messagesResult = await getJson(fetchLike, token, `/conversations/${encodeURIComponent(conversationId)}/messages?${query}`, CONVERSATIONS_VERSION);
        if (!messagesResult.ok) { complete = false; break; }
        for (const message of messageList(messagesResult.data)) {
          if (string(message.contactId, 500) !== record.highlevel_contact_id) {
            issues.push({ cls_record_id: record.cls_record_id, highlevel_contact_id: record.highlevel_contact_id, reason: 'message_for_another_contact', provider_event_id: string(message.id, 500) ?? undefined });
            continue;
          }
          eventsForContact += 1;
          if (eventsForContact > MAX_EVENTS_PER_CONTACT) { complete = false; break; }
          const event = messageEvent(message, input.highlevelLocationId, record.highlevel_contact_id, observedAt);
          if (event) providerEvents.push(event);
          // An email-shaped provider message with an unexpected direction or a
          // missing stable identity/timestamp is not silently treated as empty.
          else complete = false;
        }
        if (!complete) break;
        const envelope = responseEnvelope(messagesResult.data);
        if (envelope.nextPage !== true) break;
        const next = string(envelope.lastMessageId, 500);
        if (!next || seen.has(next)) { complete = false; break; }
        seen.add(next); lastMessageId = next;
      }
      if (!complete) break;
    }
    observations.push({
      highlevel_location_id: input.highlevelLocationId,
      highlevel_contact_id: record.highlevel_contact_id,
      history_coverage: complete ? (eventsForContact > 0 ? 'evidenced_activity' : 'known_empty') : 'history_unknown',
      observed_at: observedAt,
    });
    if (!complete) issues.push({ cls_record_id: record.cls_record_id, highlevel_contact_id: record.highlevel_contact_id, reason: 'message_stream_incomplete' });
  }

  return {
    bundle: { schema_version: 'prospect-archive-sync-bundle.v1', highlevel_location_id: input.highlevelLocationId, provider_events: providerEvents, history_observations: observations },
    contacts_read: contactsRead, issues,
  };
}
