import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  firmEnabled: false,
  firmError: null as { message: string } | null,
  firmReads: 0,
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'intake_firms') throw new Error(`unexpected table ${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => {
          state.firmReads += 1;
          return Promise.resolve({
            data: state.firmError
              ? null
              : { channel_conversation_ledger_enabled: state.firmEnabled },
            error: state.firmError,
          });
        },
      };
      return chain;
    },
  },
}));

import {
  isChannelConversationLedgerEnabledForFirm,
  isChannelConversationLedgerGloballyEnabled,
  requireChannelConversationLedger,
} from '../channel-conversation-gate';

const previousEnv = process.env.CHANNEL_CONVERSATION_LEDGER_ENABLED;

describe('channel conversation ledger gate', () => {
  beforeEach(() => {
    delete process.env.CHANNEL_CONVERSATION_LEDGER_ENABLED;
    state.firmEnabled = false;
    state.firmError = null;
    state.firmReads = 0;
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.CHANNEL_CONVERSATION_LEDGER_ENABLED;
    } else {
      process.env.CHANNEL_CONVERSATION_LEDGER_ENABLED = previousEnv;
    }
  });

  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['TRUE', false],
    ['1', false],
    ['true', true],
  ])('treats server value %s as enabled=%s', (value, expected) => {
    if (value === undefined) delete process.env.CHANNEL_CONVERSATION_LEDGER_ENABLED;
    else process.env.CHANNEL_CONVERSATION_LEDGER_ENABLED = value;
    expect(isChannelConversationLedgerGloballyEnabled()).toBe(expected);
  });

  it('requires both the exact-true server switch and the firm flag', async () => {
    state.firmEnabled = true;
    expect(await isChannelConversationLedgerEnabledForFirm('firm-1')).toBe(false);
    expect(state.firmReads).toBe(0);

    process.env.CHANNEL_CONVERSATION_LEDGER_ENABLED = 'true';
    state.firmEnabled = false;
    expect(await isChannelConversationLedgerEnabledForFirm('firm-1')).toBe(false);

    state.firmEnabled = true;
    expect(await isChannelConversationLedgerEnabledForFirm('firm-1')).toBe(true);
  });

  it('fails closed for a missing or unreadable firm flag', async () => {
    process.env.CHANNEL_CONVERSATION_LEDGER_ENABLED = 'true';
    state.firmError = { message: 'column unavailable' };

    expect(await isChannelConversationLedgerEnabledForFirm('firm-1')).toBe(false);
    await expect(requireChannelConversationLedger('firm-1')).rejects.toThrow(
      'channel conversation ledger unavailable',
    );
  });
});
