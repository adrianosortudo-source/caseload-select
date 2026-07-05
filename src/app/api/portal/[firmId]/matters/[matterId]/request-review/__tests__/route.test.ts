import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let session: { firm_id: string; role: string } | null = { firm_id: 'firm-1', role: 'lawyer' };
vi.mock('@/lib/portal-auth', () => ({ getFirmSession: async (firmId: string) => (session && session.firm_id === firmId ? session : null) }));

let matter: { id: string; firm_id: string; source_screened_lead_id: string | null } | null = {
  id: 'matter-1', firm_id: 'firm-1', source_screened_lead_id: 'lead-1',
};
vi.mock('@/lib/matter-stage', () => ({ getMatterById: async () => matter }));

const enrollMock = vi.fn();
vi.mock('@/lib/cadence-runner', () => ({ enrollMatterInCadence: (opts: unknown) => enrollMock(opts) }));

import { POST } from '../route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/portal/firm-1/matters/matter-1/request-review', { method: 'POST' });
}
function params() {
  return { params: Promise.resolve({ firmId: 'firm-1', matterId: 'matter-1' }) };
}

describe('POST /api/portal/[firmId]/matters/[matterId]/request-review', () => {
  beforeEach(() => {
    session = { firm_id: 'firm-1', role: 'lawyer' };
    matter = { id: 'matter-1', firm_id: 'firm-1', source_screened_lead_id: 'lead-1' };
    enrollMock.mockReset();
    enrollMock.mockResolvedValue({ ok: true, alreadyEnrolled: false });
  });

  it('returns 401 without a firm session', async () => {
    session = null;
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the matter does not belong to this firm', async () => {
    matter = { id: 'matter-1', firm_id: 'other-firm', source_screened_lead_id: null };
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(404);
  });

  it('enrolls the matter into J9 and returns ok', async () => {
    const res = await POST(makeRequest(), params());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, alreadyEnrolled: false });
    expect(enrollMock).toHaveBeenCalledWith({
      matterId: 'matter-1', firmId: 'firm-1', screenedLeadId: 'lead-1', cadenceKey: 'J9',
    });
  });

  it('reports alreadyEnrolled true on a repeat request', async () => {
    enrollMock.mockResolvedValue({ ok: true, alreadyEnrolled: true });
    const res = await POST(makeRequest(), params());
    const body = await res.json();
    expect(body.alreadyEnrolled).toBe(true);
  });

  it('returns 500 when enrollment fails', async () => {
    enrollMock.mockResolvedValue({ ok: false, error: 'db down' });
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(500);
  });
});
