import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authorized: true,
  runDataRetention: vi.fn(),
  dedupError: null as { message: string } | null,
}));

vi.mock('@/lib/cron-auth', () => ({
  isCronAuthorized: vi.fn(() => mocks.authorized),
}));
vi.mock('@/lib/data-retention', () => ({
  runDataRetention: mocks.runDataRetention,
}));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      delete: vi.fn(() => ({
        lt: vi.fn(() => Promise.resolve({ error: mocks.dedupError })),
      })),
    })),
  },
}));

import { GET } from '../route';

function request(): NextRequest {
  return new Request('https://app.caseloadselect.ca/api/cron/data-retention') as unknown as NextRequest;
}

function retentionResult(errors: string[] = []) {
  return {
    leads_anonymized: 0,
    sessions_cleared: 0,
    screened_leads_anonymized: 1,
    caseload_prospects_anonymized: 0,
    privacy_audit_requests_expired: 2,
    privacy_audit_events_purged: 7,
    privacy_cleanup_retries: 1,
    privacy_cleanup_completed: 0,
    errors,
  };
}

beforeEach(() => {
  mocks.authorized = true;
  mocks.dedupError = null;
  mocks.runDataRetention.mockReset().mockResolvedValue(retentionResult());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/cron/data-retention', () => {
  it('rejects unauthorized calls before running retention', async () => {
    mocks.authorized = false;

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.runDataRetention).not.toHaveBeenCalled();
  });

  it('reports database-controlled privacy audit expiry counts', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      privacy_audit_requests_expired: 2,
      privacy_audit_events_purged: 7,
    });
  });

  it('fails the run when privacy audit expiry fails', async () => {
    mocks.runDataRetention.mockResolvedValueOnce(
      retentionResult(['privacy audit expiry: database unavailable']),
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      errors: ['privacy audit expiry: database unavailable'],
    });
  });

  it('reports dedup cleanup separately without hiding retention success', async () => {
    mocks.dedupError = { message: 'dedup table unavailable' };

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.channel_message_dedup_cleanup).toEqual({
      ok: false,
      error: 'dedup table unavailable',
    });
  });
});
