import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  ARCHIVE_READER_MAX_PAGES_PER_CONTACT,
  advanceArchiveReaderStream,
  buildArchiveReaderDirectory,
  classifyArchiveReaderEvent,
  isDirectArchiveSyncAvailable,
  validateArchiveReaderRequest,
} from '../reader-contract';

const LOCATION = 'xXhW340nWLAJhOPzLbAA';
const directory = buildArchiveReaderDirectory([
  { cls_record_id: 'BA-B1-01', arm: 'BA', highlevel_location_id: LOCATION, highlevel_contact_id: 'ba-contact' },
  { cls_record_id: 'AE-B1-01', arm: 'AE', highlevel_location_id: LOCATION, highlevel_contact_id: 'ae-contact' },
], LOCATION);

describe('prospect archive reader contract', () => {
  it('permits GET only for one exact BA/AE contact and rejects global or KS-shaped reads', () => {
    expect(validateArchiveReaderRequest({ method: 'GET', highlevel_location_id: LOCATION, highlevel_contact_id: 'ba-contact', page_size: 100 }, LOCATION, directory)).toBe(true);
    expect(validateArchiveReaderRequest({ method: 'POST', highlevel_location_id: LOCATION, highlevel_contact_id: 'ba-contact', page_size: 100 }, LOCATION, directory)).toBe(false);
    expect(validateArchiveReaderRequest({ method: 'GET', highlevel_location_id: LOCATION, page_size: 100 }, LOCATION, directory)).toBe(false);
    expect(validateArchiveReaderRequest({ method: 'GET', highlevel_location_id: LOCATION, highlevel_contact_id: 'ks-contact', page_size: 100 }, LOCATION, directory)).toBe(false);
    expect(() => buildArchiveReaderDirectory([{ cls_record_id: 'KS-B1-01', arm: 'KS' as never, highlevel_location_id: LOCATION, highlevel_contact_id: 'ks-contact' }], LOCATION)).toThrow(/BA\/AE/);
  });

  it('holds events without stable provider IDs and never upgrades unknown inbound mail to human', () => {
    expect(classifyArchiveReaderEvent({ direction: 'inbound', body: 'Please call me' })).toMatchObject({ status: 'held', hold_reason: 'missing_provider_event_id' });
    expect(classifyArchiveReaderEvent({ provider_event_id: 'in-1', direction: 'inbound', body: 'Please call me' })).toMatchObject({ status: 'held', response_kind: 'unclassified' });
    expect(classifyArchiveReaderEvent({ provider_event_id: 'auto-1', direction: 'inbound', body: 'Automatic reply: away' })).toMatchObject({ status: 'accepted', kind: 'automated_reply', response_kind: 'automated' });
  });

  it('treats only a completed empty stream as known empty and detects cursor loops', () => {
    const unknown = advanceArchiveReaderStream(null, { events: [], complete: false, next_cursor: 'page-2' });
    expect(unknown.history_coverage).toBe('history_unknown');
    const loop = advanceArchiveReaderStream(unknown, { events: [], complete: false, next_cursor: 'page-2' });
    expect(loop.stop_reason).toBe('cursor_loop');
    expect(loop.complete).toBe(false);
    expect(advanceArchiveReaderStream(null, { events: [], complete: true }).history_coverage).toBe('known_empty');
    expect(advanceArchiveReaderStream(null, { events: [{ provider_event_id: '1' }], complete: true }).history_coverage).toBe('evidenced_activity');
  });

  it('bounds pagination and leaves direct sync disabled without a proved, exact scope', () => {
    let state = advanceArchiveReaderStream(null, { events: [], complete: false, next_cursor: 'first' });
    for (let page = 1; page < ARCHIVE_READER_MAX_PAGES_PER_CONTACT; page += 1) {
      state = advanceArchiveReaderStream(state, { events: [], complete: false, next_cursor: `cursor-${page}` });
    }
    expect(state.stop_reason).toBe('page_limit');
    expect(isDirectArchiveSyncAvailable(null, LOCATION, directory)).toBe(false);
    expect(isDirectArchiveSyncAvailable({ status: 'proved', highlevel_location_id: LOCATION, allowed_contact_ids: ['ba-contact'], verified_at: '2026-09-10T20:00:00.000Z' }, LOCATION, directory)).toBe(false);
    expect(isDirectArchiveSyncAvailable({ status: 'proved', highlevel_location_id: LOCATION, allowed_contact_ids: ['ba-contact', 'ae-contact'], verified_at: '2026-09-10T20:00:00.000Z' }, LOCATION, directory)).toBe(true);
  });
});
