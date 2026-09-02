import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/channel-conversation-gate', () => ({
  requireChannelConversationLedger: () => Promise.resolve(),
}));
const db = vi.hoisted(() => ({
  timelineRows: [] as Record<string, unknown>[],
  latestInboundAt: null as string | null,
  timelineOrders: [] as Array<{ column: string; ascending: boolean }>,
  timelineLimit: 0,
}));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'screened_leads') {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () => Promise.resolve({ data: { id: 'lead-uuid' }, error: null });
        return chain;
      }
      if (table === 'channel_conversation_events') {
        const chain: Record<string, unknown> = {};
        let latestInboundQuery = false;
        chain.select = (columns: string) => {
          latestInboundQuery = columns === 'occurred_at';
          return chain;
        };
        chain.eq = () => chain;
        chain.order = (column: string, options: { ascending: boolean }) => {
          if (!latestInboundQuery) db.timelineOrders.push({ column, ...options });
          return chain;
        };
        chain.limit = (limit: number) => {
          if (!latestInboundQuery) {
            db.timelineLimit = limit;
            return Promise.resolve({ data: db.timelineRows, error: null });
          }
          return chain;
        };
        chain.maybeSingle = () => Promise.resolve({
          data: db.latestInboundAt ? { occurred_at: db.latestInboundAt } : null,
          error: null,
        });
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import {
  CHANNEL_REPLY_WINDOW_MS,
  collapseConversationEvents,
  getChannelReplyWindow,
  isChannelReplyWindowOpen,
  loadChannelConversation,
  normalizeAuthoritativeInboundAt,
  validateChannelText,
} from '../channel-conversation';

describe('strict Meta reply window', () => {
  const inbound = '2026-09-01T12:00:00.000Z';

  it('is open one millisecond before 24 hours', () => {
    expect(
      isChannelReplyWindowOpen(
        inbound,
        new Date(Date.parse(inbound) + CHANNEL_REPLY_WINDOW_MS - 1),
      ),
    ).toBe(true);
  });

  it('is closed at exactly 24 hours', () => {
    const atBoundary = new Date(Date.parse(inbound) + CHANNEL_REPLY_WINDOW_MS);
    expect(isChannelReplyWindowOpen(inbound, atBoundary)).toBe(false);
    expect(getChannelReplyWindow(inbound, atBoundary).reason).toBe('expired');
  });

  it('fails closed without a valid authoritative inbound timestamp', () => {
    expect(isChannelReplyWindowOpen(null)).toBe(false);
    expect(isChannelReplyWindowOpen('not-a-date')).toBe(false);
    expect(getChannelReplyWindow(null).reason).toBe('no_authoritative_inbound');
  });

  it('rejects malformed and unreasonable future evidence without substituting now', () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    expect(normalizeAuthoritativeInboundAt(undefined, now)).toBeNull();
    expect(normalizeAuthoritativeInboundAt('not-a-date', now)).toBeNull();
    expect(
      normalizeAuthoritativeInboundAt('2026-09-01T12:05:00.000Z', now),
    ).toBe('2026-09-01T12:05:00.000Z');
    expect(
      normalizeAuthoritativeInboundAt('2026-09-01T12:05:00.001Z', now),
    ).toBeNull();
    expect(
      isChannelReplyWindowOpen('2026-09-01T12:05:00.001Z', now),
    ).toBe(false);
  });

  it('treats old valid evidence as expired', () => {
    const now = new Date('2026-09-02T12:00:00.001Z');
    expect(normalizeAuthoritativeInboundAt(inbound, now)).toBe(inbound);
    expect(isChannelReplyWindowOpen(inbound, now)).toBe(false);
  });
});

describe('per-channel text limits', () => {
  it('allows Messenger up to 2,000 Unicode characters', () => {
    expect(validateChannelText('facebook', 'a'.repeat(2000)).valid).toBe(true);
    expect(validateChannelText('facebook', 'a'.repeat(2001)).valid).toBe(false);
  });

  it('uses UTF-8 bytes for the conservative Instagram limit', () => {
    expect(validateChannelText('instagram', 'é'.repeat(500)).valid).toBe(true);
    expect(validateChannelText('instagram', 'é'.repeat(501)).valid).toBe(false);
  });

  it('allows WhatsApp up to 4,096 characters', () => {
    expect(validateChannelText('whatsapp', 'a'.repeat(4096)).valid).toBe(true);
    expect(validateChannelText('whatsapp', 'a'.repeat(4097)).valid).toBe(false);
  });
});

describe('append-only event projection', () => {
  it('replaces a pending outbound attempt with its terminal event', () => {
    const base = {
      channel: 'facebook' as const,
      direction: 'outbound' as const,
      source: 'operator' as const,
      body: 'Hello',
      meta_message_id: null,
      client_request_id: '11111111-1111-4111-8111-111111111111',
      actor_type: 'operator' as const,
      actor_id: 'user-1',
      authoritative_inbound: false,
      occurred_at: '2026-09-01T12:00:00.000Z',
      failure_reason: null,
      created_at: '2026-09-01T12:00:00.000Z',
    };
    const result = collapseConversationEvents([
      { ...base, id: 'pending', status: 'pending' },
      {
        ...base,
        id: 'sent',
        status: 'sent',
        meta_message_id: 'mid-out',
        created_at: '2026-09-01T12:00:01.000Z',
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'sent', status: 'sent', metaMessageId: 'mid-out' });
  });

  it('loads the newest 500 then reverses them and queries latest inbound independently', async () => {
    db.timelineOrders = [];
    db.timelineLimit = 0;
    db.latestInboundAt = '2026-09-01T11:59:00.000Z';
    const makeRow = (index: number) => ({
      id: `event-${index}`,
      channel: 'facebook' as const,
      direction: 'inbound' as const,
      source: 'webhook' as const,
      body: `Message ${index}`,
      status: 'received' as const,
      meta_message_id: `mid-${index}`,
      client_request_id: null,
      actor_type: 'lead' as const,
      actor_id: null,
      authoritative_inbound: false,
      occurred_at: new Date(Date.UTC(2026, 8, 1, 12, 0, index)).toISOString(),
      failure_reason: null,
      created_at: new Date(Date.UTC(2026, 8, 1, 12, 0, index)).toISOString(),
    });
    // Supabase returns this bounded page newest-first.
    db.timelineRows = [makeRow(2), makeRow(1), makeRow(0)];

    const result = await loadChannelConversation({
      firmId: 'firm-1',
      screenedLeadId: 'lead-ref',
      now: new Date('2026-09-01T12:01:00.000Z'),
    });

    expect(db.timelineOrders).toEqual([
      { column: 'occurred_at', ascending: false },
      { column: 'created_at', ascending: false },
    ]);
    expect(db.timelineLimit).toBe(500);
    expect(result?.messages.map((message) => message.id)).toEqual([
      'event-0',
      'event-1',
      'event-2',
    ]);
    // No row in the displayed page is marked authoritative; the independent
    // query still supplies the current reply-window evidence.
    expect(result?.replyWindow).toMatchObject({
      isOpen: true,
      lastInboundAt: db.latestInboundAt,
    });
  });
});
