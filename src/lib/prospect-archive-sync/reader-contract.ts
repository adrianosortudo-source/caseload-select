import 'server-only';

import type { ArchiveSyncEligibleArm } from './types';

/**
 * Pure guardrails for a future HighLevel history reader.  They deliberately do
 * not contain a token, a fetch implementation, or a provider endpoint.  The
 * caller must prove its authenticated scope before it can opt into direct sync.
 */
export const ARCHIVE_READER_MAX_PAGES_PER_CONTACT = 50;
export const ARCHIVE_READER_MAX_EVENTS_PER_CONTACT = 2_000;

export type ArchiveReaderIdentity = {
  cls_record_id: string;
  arm: ArchiveSyncEligibleArm;
  highlevel_location_id: string;
  highlevel_contact_id: string;
};

export type ArchiveReaderRequest = {
  method: 'GET';
  highlevel_location_id: string;
  highlevel_contact_id: string;
  cursor?: string | null;
  page_size: number;
};

export type ArchiveReaderRawEvent = {
  provider_event_id?: string | null;
  direction?: 'inbound' | 'outbound' | null;
  kind?: 'message_sent' | 'human_reply' | 'automated_reply' | 'bounce' | 'meeting' | null;
  occurred_at?: string | null;
  automation_indicator?: boolean | null;
  subject?: string | null;
  body?: string | null;
};

export type ArchiveReaderEventClassification = {
  status: 'accepted' | 'held';
  provider_event_id: string | null;
  kind: 'message_sent' | 'human_reply' | 'automated_reply' | 'bounce' | 'meeting' | null;
  response_kind: 'none' | 'human' | 'automated' | 'unclassified';
  hold_reason: 'missing_provider_event_id' | 'unclassified_provider_event' | null;
};

export type ArchiveReaderPage<TEvent = ArchiveReaderRawEvent> = {
  events: readonly TEvent[];
  next_cursor?: string | null;
  complete: boolean;
};

export type ArchiveReaderStreamState = {
  pages_read: number;
  events_read: number;
  cursors_seen: readonly string[];
  complete: boolean;
  stop_reason: 'complete' | 'cursor_loop' | 'page_limit' | 'event_limit' | 'incomplete_provider_response';
  history_coverage: 'known_empty' | 'evidenced_activity' | 'history_unknown';
};

export type AuthenticatedReaderScopeProof = {
  status: 'unproven' | 'proved';
  highlevel_location_id?: string;
  allowed_contact_ids?: readonly string[];
  verified_at?: string;
};

function nonBlank(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;
}

function validTime(value: unknown): value is string {
  return nonBlank(value, 80) && Number.isFinite(Date.parse(value));
}

/** Builds the immutable BA/AE directory and rejects duplicate contact keys. */
export function buildArchiveReaderDirectory(
  records: readonly ArchiveReaderIdentity[],
  expectedLocationId: string,
): ReadonlyMap<string, ArchiveReaderIdentity> {
  if (!nonBlank(expectedLocationId, 200)) throw new Error('Archive reader requires one HighLevel location ID.');
  const directory = new Map<string, ArchiveReaderIdentity>();
  const recordIds = new Set<string>();
  for (const record of records) {
    if (!nonBlank(record.cls_record_id, 300)
      || (record.arm !== 'BA' && record.arm !== 'AE')
      || record.highlevel_location_id !== expectedLocationId
      || !nonBlank(record.highlevel_contact_id, 500)
      || recordIds.has(record.cls_record_id)
      || directory.has(record.highlevel_contact_id)) {
      throw new Error('Archive reader directory must contain unique exact BA/AE contact identities in one location.');
    }
    recordIds.add(record.cls_record_id);
    directory.set(record.highlevel_contact_id, Object.freeze({ ...record }));
  }
  return directory;
}

/** No provider-wide or multi-contact export is ever a valid reader request. */
export function validateArchiveReaderRequest(
  request: unknown,
  expectedLocationId: string,
  directory: ReadonlyMap<string, ArchiveReaderIdentity>,
): request is ArchiveReaderRequest {
  if (!request || typeof request !== 'object') return false;
  const value = request as Record<string, unknown>;
  if (value.method !== 'GET'
    || value.highlevel_location_id !== expectedLocationId
    || !nonBlank(value.highlevel_contact_id, 500)
    || !directory.has(value.highlevel_contact_id)
    || !Number.isInteger(value.page_size)
    || (value.page_size as number) < 1
    || (value.page_size as number) > ARCHIVE_READER_MAX_EVENTS_PER_CONTACT) return false;
  return value.cursor === undefined || value.cursor === null || nonBlank(value.cursor, 1_000);
}

/** Raw message bodies help detect auto-replies but are never returned. */
export function classifyArchiveReaderEvent(raw: unknown): ArchiveReaderEventClassification {
  if (!raw || typeof raw !== 'object') {
    return { status: 'held', provider_event_id: null, kind: null, response_kind: 'unclassified', hold_reason: 'unclassified_provider_event' };
  }
  const event = raw as ArchiveReaderRawEvent;
  const eventId = nonBlank(event.provider_event_id, 500) ? event.provider_event_id.trim() : null;
  if (!eventId) {
    return { status: 'held', provider_event_id: null, kind: null, response_kind: 'unclassified', hold_reason: 'missing_provider_event_id' };
  }
  const kind = event.kind ?? null;
  if (kind === 'message_sent' || kind === 'bounce' || kind === 'meeting') {
    return { status: 'accepted', provider_event_id: eventId, kind, response_kind: 'none', hold_reason: null };
  }
  const automated = event.automation_indicator === true
    || /out of (?:the )?office|automatic reply|auto[- ]?reply|autoreply/i.test(`${event.subject ?? ''}\n${event.body ?? ''}`);
  if (kind === 'automated_reply' || (event.direction === 'inbound' && automated)) {
    return { status: 'accepted', provider_event_id: eventId, kind: 'automated_reply', response_kind: 'automated', hold_reason: null };
  }
  if (kind === 'human_reply') {
    return { status: 'accepted', provider_event_id: eventId, kind, response_kind: 'human', hold_reason: null };
  }
  // An inbound message without a provider classification is not assumed human.
  return { status: 'held', provider_event_id: eventId, kind: null, response_kind: 'unclassified', hold_reason: 'unclassified_provider_event' };
}

/**
 * Computes a bounded per-contact read.  A repeated cursor is an incomplete
 * stream, never a known-empty history.  `known_empty` requires a completed
 * first page with no events.
 */
export function advanceArchiveReaderStream(
  previous: Omit<ArchiveReaderStreamState, 'history_coverage'> | null,
  page: ArchiveReaderPage,
): ArchiveReaderStreamState {
  const prior = previous ?? { pages_read: 0, events_read: 0, cursors_seen: [], complete: false, stop_reason: 'incomplete_provider_response' as const };
  const pagesRead = prior.pages_read + 1;
  const eventsRead = prior.events_read + page.events.length;
  const priorCursors = new Set(prior.cursors_seen);
  const nextCursor = page.next_cursor && page.next_cursor.trim() ? page.next_cursor.trim() : null;
  const cursorLoop = nextCursor !== null && priorCursors.has(nextCursor);
  const pageLimit = pagesRead >= ARCHIVE_READER_MAX_PAGES_PER_CONTACT && !page.complete;
  const eventLimit = eventsRead >= ARCHIVE_READER_MAX_EVENTS_PER_CONTACT && !page.complete;
  const complete = page.complete && nextCursor === null;
  const stopReason: ArchiveReaderStreamState['stop_reason'] = complete ? 'complete'
    : cursorLoop ? 'cursor_loop'
      : pageLimit ? 'page_limit'
        : eventLimit ? 'event_limit'
          : 'incomplete_provider_response';
  const coverage = complete && eventsRead === 0 ? 'known_empty'
    : eventsRead > 0 ? 'evidenced_activity'
      : 'history_unknown';
  return {
    pages_read: pagesRead,
    events_read: eventsRead,
    cursors_seen: nextCursor ? [...prior.cursors_seen, nextCursor] : [...prior.cursors_seen],
    complete,
    stop_reason: stopReason,
    history_coverage: coverage,
  };
}

/** Direct sync is forbidden until an authenticated, contact-scoped proof exists. */
export function isDirectArchiveSyncAvailable(
  proof: AuthenticatedReaderScopeProof | null | undefined,
  expectedLocationId: string,
  directory: ReadonlyMap<string, ArchiveReaderIdentity>,
): boolean {
  if (!proof || proof.status !== 'proved' || proof.highlevel_location_id !== expectedLocationId || !validTime(proof.verified_at)) return false;
  const allowed = new Set(proof.allowed_contact_ids ?? []);
  return allowed.size === directory.size && [...directory.keys()].every((contactId) => allowed.has(contactId));
}
