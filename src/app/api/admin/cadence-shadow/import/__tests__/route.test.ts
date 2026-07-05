import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let cronAuthed = true;
let operatorSession: unknown = { role: 'operator' };
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: () => cronAuthed }));
vi.mock('@/lib/portal-auth', () => ({ getOperatorSession: async () => operatorSession }));

const insertMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (_table: string) => ({ insert: (rows: unknown[]) => insertMock(rows) }) },
}));

function makeMultipartRequest(csv: string, firmId: string): NextRequest {
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'sends.csv');
  form.set('firm_id', firmId);
  return new NextRequest('http://localhost/api/admin/cadence-shadow/import', { method: 'POST', body: form });
}

describe('POST /api/admin/cadence-shadow/import', () => {
  beforeEach(() => {
    cronAuthed = true;
    operatorSession = { role: 'operator' };
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
  });

  it('returns 401 without cron auth or an operator session', async () => {
    cronAuthed = false;
    operatorSession = null;
    const { POST } = await import('../route');
    const res = await POST(makeMultipartRequest('cadence_key,sent_at\nJ9,2026-07-01T00:00:00.000Z', 'firm-1'));
    expect(res.status).toBe(401);
  });

  it('parses and inserts valid rows', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeMultipartRequest(
      'cadence_key,sent_at,recipient_email\nJ9,2026-07-01T00:00:00.000Z,a@example.com\nJ6,2026-07-02T00:00:00.000Z,b@example.com',
      'firm-1',
    ));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.inserted).toBe(2);
    expect(body.errors).toEqual([]);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    expect(inserted[0].firm_id).toBe('firm-1');
  });

  it('rejects a non-multipart request', async () => {
    const { POST } = await import('../route');
    const res = await POST(new NextRequest('http://localhost/api/admin/cadence-shadow/import', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(400);
  });

  it('returns 400 with no valid rows', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeMultipartRequest('cadence_key,sent_at\n,bad-date', 'firm-1'));
    expect(res.status).toBe(400);
  });
});
