import { describe, it, expect } from 'vitest';
import { buildInboxThreads, filterInboxThreads, previewBody } from '@/lib/staff-inbox-pure';
import type { ClientMatter, MatterMessage } from '@/lib/types';

function matter(overrides: Partial<ClientMatter> = {}): ClientMatter {
  return {
    id: 'matter-1', firm_id: 'firm-1', source_screened_lead_id: null, lead_id: null,
    assignee_ids: [], matter_stage: 'active', matter_stage_changed_at: '2026-07-01T00:00:00.000Z',
    matter_type: 'will_drafting', practice_area: 'estates', primary_name: 'Ana Santos',
    primary_email: 'ana@example.com', primary_phone: null,
    welcome_draft_html: null, welcome_draft_plain_text: null, welcome_draft_edited_html: null,
    welcome_draft_sent_at: null, welcome_draft_sent_body: null, embed_url: null, closed_at: null,
    created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
    matter_milestone: null, matter_milestone_note: null,
    ...overrides,
  };
}

function message(overrides: Partial<MatterMessage> = {}): MatterMessage {
  return {
    id: 'msg-1', matter_id: 'matter-1', firm_id: 'firm-1', channel_type: 'client',
    recipient_scope: 'individual', sender_role: 'client', sender_lawyer_id: null,
    sender_client_email: 'ana@example.com', body: 'Hello there', attachments: [],
    broadcast_id: null, parent_message_id: null, created_at: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildInboxThreads', () => {
  it('picks the most recent message per matter and sorts threads by last activity', () => {
    const matters = [
      matter({ id: 'm1', updated_at: '2026-07-01T00:00:00.000Z' }),
      matter({ id: 'm2', updated_at: '2026-07-01T00:00:00.000Z' }),
    ];
    const messages = [
      message({ id: 'a', matter_id: 'm1', created_at: '2026-07-02T00:00:00.000Z', body: 'first' }),
      message({ id: 'b', matter_id: 'm1', created_at: '2026-07-03T00:00:00.000Z', body: 'second' }),
      message({ id: 'c', matter_id: 'm2', created_at: '2026-07-04T00:00:00.000Z', body: 'newest' }),
    ];
    const threads = buildInboxThreads(matters, messages);
    expect(threads.map((t) => t.matter.id)).toEqual(['m2', 'm1']); // m2 more recent
    const m1Thread = threads.find((t) => t.matter.id === 'm1')!;
    expect(m1Thread.lastMessage?.id).toBe('b');
    expect(m1Thread.messageCount).toBe(2);
  });

  it('gives a matter with zero messages an empty thread using matter.updated_at', () => {
    const threads = buildInboxThreads([matter({ id: 'm1', updated_at: '2026-07-05T00:00:00.000Z' })], []);
    expect(threads).toHaveLength(1);
    expect(threads[0].lastMessage).toBeNull();
    expect(threads[0].messageCount).toBe(0);
    expect(threads[0].lastActivityAt).toBe('2026-07-05T00:00:00.000Z');
  });

  it('sorts an empty-thread matter below matters with recent messages when its updated_at is older', () => {
    const matters = [
      matter({ id: 'quiet', updated_at: '2026-01-01T00:00:00.000Z' }),
      matter({ id: 'active', updated_at: '2026-07-01T00:00:00.000Z' }),
    ];
    const messages = [message({ matter_id: 'active', created_at: '2026-07-05T00:00:00.000Z' })];
    const threads = buildInboxThreads(matters, messages);
    expect(threads.map((t) => t.matter.id)).toEqual(['active', 'quiet']);
  });

  it('returns an empty array for zero matters', () => {
    expect(buildInboxThreads([], [])).toEqual([]);
  });
});

describe('filterInboxThreads', () => {
  const threads = buildInboxThreads(
    [matter({ id: 'm1', matter_stage: 'active' }), matter({ id: 'm2', matter_stage: 'closing' })],
    [
      message({ matter_id: 'm1', channel_type: 'client', created_at: '2026-07-02T00:00:00.000Z' }),
      message({ matter_id: 'm2', channel_type: 'internal', created_at: '2026-07-03T00:00:00.000Z' }),
    ],
  );

  it('filters by channel of the last message', () => {
    expect(filterInboxThreads(threads, { channel: 'client' }).map((t) => t.matter.id)).toEqual(['m1']);
  });

  it('filters by matter stage', () => {
    expect(filterInboxThreads(threads, { matterStage: 'closing' }).map((t) => t.matter.id)).toEqual(['m2']);
  });

  it('filters unreadOnly to threads with at least one message', () => {
    const withEmpty = buildInboxThreads([matter({ id: 'm3' })], []);
    expect(filterInboxThreads(withEmpty, { unreadOnly: true })).toEqual([]);
  });

  it('returns all threads with no filters', () => {
    expect(filterInboxThreads(threads, {})).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const copy = [...threads];
    filterInboxThreads(threads, { channel: 'client' });
    expect(threads).toEqual(copy);
  });
});

describe('previewBody', () => {
  it('returns an empty string for null or undefined', () => {
    expect(previewBody(null)).toBe('');
    expect(previewBody(undefined)).toBe('');
  });

  it('strips HTML tags and collapses whitespace', () => {
    expect(previewBody('<p>Hello   <b>world</b></p>')).toBe('Hello world');
  });

  it('leaves a short body untruncated', () => {
    expect(previewBody('short message')).toBe('short message');
  });

  it('truncates a long body with an ellipsis at maxLength', () => {
    const long = 'a'.repeat(200);
    const result = previewBody(long, 90);
    expect(result.length).toBe(90);
    expect(result.endsWith('…')).toBe(true);
  });
});
