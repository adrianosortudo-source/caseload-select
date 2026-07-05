import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let cronAuthed = false;
let operatorSession: unknown = { role: 'operator' };
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: () => cronAuthed }));
vi.mock('@/lib/portal-auth', () => ({ getOperatorSession: async () => operatorSession }));

const exportMock = vi.fn();
vi.mock('@/lib/ghl-export', () => ({ exportGhlHistoryForFirm: (firmId: string) => exportMock(firmId) }));

import { POST } from '../route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/firms/firm-1/ghl-export', { method: 'POST' });
}
function params() {
  return { params: Promise.resolve({ firmId: 'firm-1' }) };
}

describe('POST /api/admin/firms/[firmId]/ghl-export', () => {
  beforeEach(() => {
    cronAuthed = false;
    operatorSession = { role: 'operator' };
    exportMock.mockReset().mockResolvedValue({ ok: true, contactsImported: 3, conversationsImported: 5 });
  });

  it('returns 401 without cron auth or an operator session', async () => {
    operatorSession = null;
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(401);
  });

  it('allows a bearer cron token even with no operator session', async () => {
    cronAuthed = true;
    operatorSession = null;
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(200);
  });

  it('runs the export and returns the summary', async () => {
    const res = await POST(makeRequest(), params());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, contactsImported: 3, conversationsImported: 5 });
    expect(exportMock).toHaveBeenCalledWith('firm-1');
  });

  it('returns 502 when the export fails entirely', async () => {
    exportMock.mockResolvedValue({ ok: false, contactsImported: 0, conversationsImported: 0, error: 'no_token' });
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(502);
  });
});
