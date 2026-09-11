import { describe, expect, it } from 'vitest';

import {
  classifyArchiveEvent,
  deriveArchiveConversationStatus,
  validateArchiveSyncScope,
} from '@/lib/prospect-archive-sync/contract';

const LOCATION_ID = 'xXhW340nWLAJhOPzLbAA';
const BA_RECORD = 'BA-B1-01';
const AE_RECORD = 'AE-B1-01';
const KS_RECORD = 'KS-B1-01';
const CONTACT_ID = '9c0e4f8a-0000-4000-8000-000000000001';

function scope(overrides: Record<string, unknown> = {}) {
  return {
    arm: 'BA',
    cls_record_id: BA_RECORD,
    highlevel_location_id: LOCATION_ID,
    highlevel_contact_id: CONTACT_ID,
    allowed_method: 'GET',
    preview_token: 'archive-preview:2026-09-10T18:00:00.000Z',
    preview_expires_at: '2026-09-10T18:10:00.000Z',
    ...overrides,
  };
}

describe('prospect archive sync safety contract', () => {
  it('limits every application to the BA/AE cohort in the fixed HighLevel location', () => {
    expect(validateArchiveSyncScope(scope(), LOCATION_ID, new Date('2026-09-10T18:04:00.000Z'))).toBe(true);

    for (const invalid of [
      scope({ highlevel_location_id: 'another-location' }),
      scope({ allowed_method: 'POST' }),
      scope({ cls_record_id: KS_RECORD, arm: 'KS' }),
      scope({ highlevel_contact_id: '' }),
      scope({ highlevel_contact_id: undefined }),
      scope({ cls_record_id: '' }),
    ]) {
      expect(validateArchiveSyncScope(invalid, LOCATION_ID, new Date('2026-09-10T18:04:00.000Z'))).toBe(false);
    }
  });

  it('fails closed when an apply attempt uses a stale or mismatched preview', () => {
    expect(validateArchiveSyncScope(scope(), LOCATION_ID, new Date('2026-09-10T18:20:01.000Z'))).toBe(false);
    expect(validateArchiveSyncScope(scope({ preview_token: '' }), LOCATION_ID, new Date('2026-09-10T18:04:00.000Z'))).toBe(false);
    expect(validateArchiveSyncScope(scope({ preview_expires_at: 'not-a-date' }), LOCATION_ID, new Date('2026-09-10T18:04:00.000Z'))).toBe(false);
  });

  it('creates stable provider-event identity so replay cannot create a second event', () => {
    const first = classifyArchiveEvent({
      provider_event_id: 'provider-message-42',
      direction: 'outbound',
      kind: 'message_sent',
      delivery_status: 'sent',
    });
    const replay = classifyArchiveEvent({
      provider_event_id: 'provider-message-42',
      direction: 'outbound',
      kind: 'message_sent',
      delivery_status: 'delivered',
    });

    expect(first.external_event_id).toBe('provider-message-42');
    expect(first.idempotency_key).toBe(replay.idempotency_key);
    expect(first.idempotency_key).toMatch(/^prospect-archive-sync:highlevel:/);
  });

  it('does not turn automated or unclassified inbound mail into a human reply', () => {
    const automated = classifyArchiveEvent({
      provider_event_id: 'auto-1',
      direction: 'inbound',
      automation_indicator: true,
    });
    const unknown = classifyArchiveEvent({
      provider_event_id: 'unknown-1',
      direction: 'inbound',
    });

    expect(automated).toMatchObject({ kind: 'automated_reply', response_kind: 'automated' });
    expect(unknown.response_kind).not.toBe('human');
    expect(unknown.kind).not.toBe('human_reply');
  });

  it('does not let later delivery evidence duplicate an outbound send or regress a real reply or meeting', () => {
    const delivered = classifyArchiveEvent({
      provider_event_id: 'provider-message-42',
      direction: 'outbound',
      kind: 'message_sent',
      delivery_status: 'delivered',
    });

    expect(deriveArchiveConversationStatus('replied', delivered)).toBe('replied');
    expect(deriveArchiveConversationStatus('meeting_scheduled', delivered)).toBe('meeting_scheduled');
    expect(deriveArchiveConversationStatus('completed', delivered)).toBe('completed');
  });

  it('returns only the minimal event identity and classification, never copied content or provider credentials', () => {
    const classified = classifyArchiveEvent({
      provider_event_id: 'provider-message-private',
      direction: 'outbound',
      kind: 'message_sent',
      body: 'A private message body that must not enter a receipt or audit log.',
      subject: 'Private subject',
      from_endpoint: 'owner@example.test',
      raw_provider_payload: { bearer: 'must-not-leak' },
    });
    const serialized = JSON.stringify(classified);

    expect(serialized).not.toContain('private message body');
    expect(serialized).not.toContain('Private subject');
    expect(serialized).not.toContain('owner@example.test');
    expect(serialized).not.toContain('must-not-leak');
    expect(Object.keys(classified).sort()).toEqual([
      'classification', 'delivery_status', 'external_event_id', 'idempotency_key', 'kind', 'response_kind',
    ]);
  });
});
