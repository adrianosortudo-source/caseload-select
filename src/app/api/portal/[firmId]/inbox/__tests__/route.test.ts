import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let session: { firm_id: string; role: string } | null = { firm_id: 'firm-1', role: 'lawyer' };
vi.mock('@/lib/portal-auth', () => ({ getPortalSession: async () => session }));

const listThreadsMock = vi.fn();
vi.mock('@/lib/staff-inbox', () => ({ listInboxThreadsForFirm: (firmId: string) => listThreadsMock(firmId) }));

import { GET } from '../route';

function makeRequest(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/portal/firm-1/inbox${qs}`, { method: 'GET' });
}
function params(firmId = 'firm-1') {
  return { params: Promise.resolve({ firmId }) };
}

const THREADS = [
  { matter: { id: 'm1', matter_stage: 'active' }, lastMessage: { channel_type: 'client' }, messageCount: 2, lastActivityAt: '2026-07-05T00:00:00.000Z' },
  { matter: { id: 'm2', matter_stage: 'closing' }, lastMessage: { channel_type: 'internal' }, messageCount: 1, lastActivityAt: '2026-07-04T00:00:00.000Z' },
];

describe('GET /api/portal/[firmId]/inbox', () => {
  beforeEach(() => {
    session = { firm_id: 'firm-1', role: 'lawyer' };
    listThreadsMock.mockReset();
    listThreadsMock.mockResolvedValue(THREADS);
  });

  it('returns 401 with no session', async () => {
    session = null;
    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(401);
  });

  it('returns 401 for a client session', async () => {
    session = { firm_id: 'firm-1', role: 'client' };
    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(401);
  });

  it('returns 401 when a lawyer session firm_id does not match the path firmId', async () => {
    session = { firm_id: 'other-firm', role: 'lawyer' };
    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(401);
  });

  it('allows an operator session regardless of firm_id', async () => {
    session = { firm_id: 'unrelated', role: 'operator' };
    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(200);
  });

  it('returns all threads with no filters', async () => {
    const res = await GET(makeRequest(), params());
    const body = await res.json();
    expect(body.items).toHaveLength(2);
  });

  it('filters by channel query param', async () => {
    const res = await GET(makeRequest('?channel=client'), params());
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].matter.id).toBe('m1');
  });

  it('filters by matter_stage query param', async () => {
    const res = await GET(makeRequest('?matter_stage=closing'), params());
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].matter.id).toBe('m2');
  });

  it('ignores an invalid channel value', async () => {
    const res = await GET(makeRequest('?channel=not-a-channel'), params());
    const body = await res.json();
    expect(body.items).toHaveLength(2);
  });
});
