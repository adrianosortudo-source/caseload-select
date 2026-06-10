/**
 * Sliding expiry on channel_intake_sessions (launch audit B3, 2026-06-09).
 *
 * Defect: expires_at was set once at insert (now()+24h DB default,
 * migration 20260516_channel_intake_sessions.sql) and updateChannelSession
 * never extended it. A lead actively answering discovery questions at
 * WhatsApp latency crossed the 24h threshold mid-conversation and the
 * hourly sweeper resolved them as abandoned.
 *
 * Fix under test: every state save pushes expires_at forward by
 * SESSION_TTL_MS, so only 24h of true silence expires a session. The
 * insert-time default stays with the database (createChannelSession
 * must NOT write expires_at).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  updateCapture: null as Record<string, unknown> | null,
  insertCapture: null as Record<string, unknown> | null,
  updateErr: null as { message: string } | null,
}));

vi.mock('@/lib/supabase-admin', () => {
  function fromChain(_table: string) {
    return {
      update: (payload: Record<string, unknown>) => {
        mocks.updateCapture = payload;
        return {
          eq: (_field: string, _v: unknown) =>
            mocks.updateErr
              ? Promise.resolve({ error: mocks.updateErr })
              : Promise.resolve({ error: null }),
        };
      },
      insert: (payload: Record<string, unknown>) => {
        mocks.insertCapture = payload;
        return {
          select: (_cols: string) => ({
            single: () =>
              Promise.resolve({ data: { id: 'new-session-id' }, error: null }),
          }),
        };
      },
    };
  }
  return { supabaseAdmin: { from: fromChain } };
});

import {
  updateChannelSession,
  createChannelSession,
  SESSION_TTL_MS,
} from '../channel-intake-session-store';
import type { EngineState } from '../screen-engine/types';

const engineState = { slots: {}, slot_meta: {} } as unknown as EngineState;

beforeEach(() => {
  mocks.updateCapture = null;
  mocks.insertCapture = null;
  mocks.updateErr = null;
});

describe('updateChannelSession sliding expiry', () => {
  it('extends expires_at by SESSION_TTL_MS on every state save', async () => {
    const before = Date.now();
    const r = await updateChannelSession({
      sessionId: 'session-1',
      engineState,
      followUpCount: 2,
    });
    const after = Date.now();

    expect(r.ok).toBe(true);
    const expiresAt = mocks.updateCapture?.expires_at as string;
    expect(expiresAt).toBeDefined();
    const expiresMs = new Date(expiresAt).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + SESSION_TTL_MS);
    expect(expiresMs).toBeLessThanOrEqual(after + SESSION_TTL_MS);
  });

  it('keeps last_activity_at maintained alongside the expiry bump', async () => {
    await updateChannelSession({
      sessionId: 'session-1',
      engineState,
      followUpCount: 1,
    });
    expect(mocks.updateCapture?.last_activity_at).toBeDefined();
    expect(mocks.updateCapture?.engine_state).toBe(engineState);
    expect(mocks.updateCapture?.follow_up_count).toBe(1);
  });

  it('SESSION_TTL_MS mirrors the 24h DB insert default', () => {
    expect(SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('propagates DB errors unchanged', async () => {
    mocks.updateErr = { message: 'RLS denied' };
    const r = await updateChannelSession({
      sessionId: 'session-1',
      engineState,
      followUpCount: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('RLS denied');
  });
});

describe('createChannelSession insert default', () => {
  it('does NOT write expires_at, leaving the DB default in place', async () => {
    const r = await createChannelSession({
      firmId: 'firm-1',
      channel: 'whatsapp',
      senderId: '16475550000',
      engineState,
    });
    expect(r.ok).toBe(true);
    expect(mocks.insertCapture).not.toHaveProperty('expires_at');
  });
});
