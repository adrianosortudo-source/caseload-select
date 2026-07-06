import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let cronAuthed = true;
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: () => cronAuthed }));

const sweepMock = vi.fn();
vi.mock('@/lib/consent-log-repair', () => ({
  runConsentLogRepairSweep: () => sweepMock(),
}));

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/consent-log-repair', { method: 'GET' });
}

describe('GET /api/cron/consent-log-repair', () => {
  it('returns 401 without cron auth', async () => {
    cronAuthed = false;
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns the sweep summary with 200 when authorized', async () => {
    cronAuthed = true;
    sweepMock.mockResolvedValue({ scanned: 10, missing: 2, repaired: 2, failed: 0, errors: [] });
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ scanned: 10, missing: 2, repaired: 2, failed: 0, errors: [] });
  });

  it('returns 500 with an error message when the sweep throws unexpectedly', async () => {
    cronAuthed = true;
    sweepMock.mockRejectedValue(new Error('boom'));
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'boom' });
  });
});
