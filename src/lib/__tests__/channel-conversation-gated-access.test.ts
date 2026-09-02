import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  requireLedger: vi.fn(),
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock('@/lib/channel-conversation-gate', () => ({
  requireChannelConversationLedger: mocks.requireLedger,
}));

import {
  claimOutboundConversationEvent,
  loadChannelConversation,
  loadOutboundConversationResult,
  recordInboundConversationEvent,
  recordOutboundConversationResult,
} from '../channel-conversation';

const ledger = {
  screenedLeadId: '11111111-1111-4111-8111-111111111111',
  source: 'operator' as const,
  actorType: 'lawyer' as const,
  actorId: '22222222-2222-4222-8222-222222222222',
  clientRequestId: '33333333-3333-4333-8333-333333333333',
};

describe('channel conversation data access while the gate is off', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.requireLedger.mockReset();
    mocks.requireLedger.mockRejectedValue(
      new Error('channel conversation ledger unavailable'),
    );
  });

  it('does not read or insert any ledger row', async () => {
    await expect(
      loadChannelConversation({ firmId: 'firm-1', screenedLeadId: 'lead-1' }),
    ).rejects.toThrow('channel conversation ledger unavailable');

    expect(
      await recordInboundConversationEvent({
        firmId: 'firm-1',
        screenedLeadId: 'lead-1',
        channel: 'facebook',
        body: 'Private inbound message',
        metaMessageId: 'mid-in',
        occurredAt: '2026-09-02T12:00:00.000Z',
      }),
    ).toEqual({ ok: false });

    await expect(
      claimOutboundConversationEvent({
        firmId: 'firm-1',
        channel: 'facebook',
        text: 'Private outbound message',
        ledger,
      }),
    ).rejects.toThrow('channel conversation ledger unavailable');

    expect(
      await recordOutboundConversationResult({
        firmId: 'firm-1',
        channel: 'facebook',
        text: 'Private outbound message',
        ledger,
        sent: false,
        failureReason: 'not sent',
      }),
    ).toEqual({ recorded: false, duplicate: false });

    await expect(
      loadOutboundConversationResult({
        firmId: 'firm-1',
        clientRequestId: ledger.clientRequestId,
      }),
    ).rejects.toThrow('channel conversation ledger unavailable');

    expect(mocks.from).not.toHaveBeenCalled();
  });
});
