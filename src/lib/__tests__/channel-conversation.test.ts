import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));

import {
  CHANNEL_REPLY_WINDOW_MS,
  collapseConversationEvents,
  getChannelReplyWindow,
  isChannelReplyWindowOpen,
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
});
