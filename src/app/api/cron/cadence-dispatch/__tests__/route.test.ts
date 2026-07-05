import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let cronAuthed = true;
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: () => cronAuthed }));

const dispatchMock = vi.fn();
vi.mock('@/lib/cadence-dispatch', () => ({
  dispatchScheduledCadenceMessages: () => dispatchMock(),
}));

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/cadence-dispatch', { method: 'GET' });
}

describe('GET /api/cron/cadence-dispatch', () => {
  it('returns 401 without cron auth', async () => {
    cronAuthed = false;
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('delegates to dispatchScheduledCadenceMessages and returns its summary', async () => {
    cronAuthed = true;
    dispatchMock.mockResolvedValue({ ok: true, attempted: false, sent: 0, failed: 0, capped: 0, blocked: 0 });
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.attempted).toBe(false);
  });
});
