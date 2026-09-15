import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase-admin', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.not = () => chain;
  chain.gte = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: mocks.row, error: null });
  return { supabaseAdmin: { from: () => chain } };
});

import { loadOpenChannelSession } from '../channel-intake-session-store';

function sessionRow(intakeExchanges: unknown): Record<string, unknown> {
  return {
    id: 'session-id',
    firm_id: 'firm-id',
    channel: 'instagram',
    sender_id: 'sender-id',
    engine_state: {},
    intake_exchanges: intakeExchanges,
    follow_up_count: 1,
    max_follow_ups: 3,
    finalized: false,
    screened_lead_id: null,
    expires_at: '2026-09-16T12:00:00.000Z',
    created_at: '2026-09-15T12:00:00.000Z',
  };
}

beforeEach(() => {
  mocks.row = null;
  vi.restoreAllMocks();
});

describe('channel session intake history loading', () => {
  it('marks an invalid stored envelope as incomplete instead of silently treating it as empty', async () => {
    mocks.row = sessionRow({ version: 1, truncated: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const loaded = await loadOpenChannelSession({
      firmId: 'firm-id',
      channel: 'instagram',
      senderId: 'sender-id',
    });

    expect(loaded?.intake_exchanges).toEqual({ version: 1, events: [], truncated: true });
    expect(warn).toHaveBeenCalledWith(
      '[channel-session-store] invalid intake exchange envelope; marking history incomplete',
    );
  });

  it('preserves a valid stored envelope', async () => {
    const envelope = { version: 1 as const, events: [], truncated: false };
    mocks.row = sessionRow(envelope);

    const loaded = await loadOpenChannelSession({
      firmId: 'firm-id',
      channel: 'instagram',
      senderId: 'sender-id',
    });

    expect(loaded?.intake_exchanges).toEqual(envelope);
  });
});
