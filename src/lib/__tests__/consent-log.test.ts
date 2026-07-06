/**
 * logIntakeConsent I/O wrapper tests. Covers the return-type contract only
 * (resolves true on a successful insert, false on a Supabase error or a
 * thrown exception, never throws either way). Row-shape assertions live in
 * consent-log-pure.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state: { shouldError: boolean; shouldThrow: boolean } = {
    shouldError: false,
    shouldThrow: false,
  };
  return {
    state,
    supabaseAdmin: {
      from: () => ({
        insert: () => {
          if (state.shouldThrow) {
            throw new Error('unexpected throw');
          }
          if (state.shouldError) {
            return Promise.resolve({ error: { message: 'insert boom' } });
          }
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: h.supabaseAdmin }));

import { logIntakeConsent } from '@/lib/consent-log';

beforeEach(() => {
  h.state.shouldError = false;
  h.state.shouldThrow = false;
});

const baseInput = {
  firmId: 'firm-1',
  screenedLeadId: 'lead-1',
  explicit: true,
  capturedAtIso: '2026-07-05T00:00:00.000Z',
  sixMonthExpiryIso: null,
  ipAddress: '1.2.3.4',
  userAgent: 'test-agent',
};

describe('logIntakeConsent', () => {
  it('resolves true on a successful insert', async () => {
    await expect(logIntakeConsent(baseInput)).resolves.toBe(true);
  });

  it('resolves false (never throws) on a Supabase error', async () => {
    h.state.shouldError = true;
    await expect(logIntakeConsent(baseInput)).resolves.toBe(false);
  });

  it('resolves false (never throws) when the insert call throws unexpectedly', async () => {
    h.state.shouldThrow = true;
    await expect(logIntakeConsent(baseInput)).resolves.toBe(false);
  });
});
