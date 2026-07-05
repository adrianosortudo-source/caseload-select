import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let session: { firm_id: string; role: string; lawyer_id?: string } | null = { firm_id: 'firm-1', role: 'lawyer', lawyer_id: 'lawyer-1' };
vi.mock('@/lib/portal-auth', () => ({ getPortalSession: async () => session }));

const computeAllBoardsMock = vi.fn();
const listViewsMock = vi.fn();
const saveViewMock = vi.fn();
vi.mock('@/lib/dashboard-boards', () => ({
  computeAllBoardsForFirm: (firmId: string) => computeAllBoardsMock(firmId),
  listDashboardViews: (firmId: string, owner: string | null) => listViewsMock(firmId, owner),
  saveDashboardView: (input: unknown) => saveViewMock(input),
}));

import { GET, POST } from '../route';

function getRequest(): NextRequest {
  return new NextRequest('http://localhost/api/portal/firm-1/boards', { method: 'GET' });
}
function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/portal/firm-1/boards', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ firmId: 'firm-1' }) };
}

const BOARDS = { triage: { total: 1 }, pipeline: { total: 2 }, health: { totalLeads: 3 } };

describe('GET /api/portal/[firmId]/boards', () => {
  beforeEach(() => {
    session = { firm_id: 'firm-1', role: 'lawyer', lawyer_id: 'lawyer-1' };
    computeAllBoardsMock.mockReset().mockResolvedValue(BOARDS);
    listViewsMock.mockReset().mockResolvedValue([{ id: 'v1', board_key: 'triage' }]);
  });

  it('returns 401 with no session', async () => {
    session = null;
    const res = await GET(getRequest(), params());
    expect(res.status).toBe(401);
  });

  it('returns 401 for a client session', async () => {
    session = { firm_id: 'firm-1', role: 'client' };
    const res = await GET(getRequest(), params());
    expect(res.status).toBe(401);
  });

  it('returns 401 when the lawyer firm_id does not match the path', async () => {
    session = { firm_id: 'other', role: 'lawyer' };
    const res = await GET(getRequest(), params());
    expect(res.status).toBe(401);
  });

  it('allows an operator regardless of firm_id', async () => {
    session = { firm_id: 'unrelated', role: 'operator' };
    const res = await GET(getRequest(), params());
    expect(res.status).toBe(200);
  });

  it('returns all three boards plus saved views', async () => {
    const res = await GET(getRequest(), params());
    const body = await res.json();
    expect(body.triage).toEqual(BOARDS.triage);
    expect(body.pipeline).toEqual(BOARDS.pipeline);
    expect(body.health).toEqual(BOARDS.health);
    expect(body.savedViews).toHaveLength(1);
    expect(listViewsMock).toHaveBeenCalledWith('firm-1', 'lawyer-1');
  });
});

describe('POST /api/portal/[firmId]/boards', () => {
  beforeEach(() => {
    session = { firm_id: 'firm-1', role: 'lawyer', lawyer_id: 'lawyer-1' };
    saveViewMock.mockReset().mockResolvedValue({ ok: true, view: { id: 'v2' } });
  });

  it('returns 400 for an invalid board_key', async () => {
    const res = await POST(postRequest({ board_key: 'nope', name: 'x' }), params());
    expect(res.status).toBe(400);
  });

  it('returns 400 for an empty name', async () => {
    const res = await POST(postRequest({ board_key: 'triage', name: '  ' }), params());
    expect(res.status).toBe(400);
  });

  it('saves a view and returns it', async () => {
    const res = await POST(postRequest({ board_key: 'triage', name: 'My whales', filters: { band: 'A' } }), params());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(saveViewMock).toHaveBeenCalledWith({
      firmId: 'firm-1', owner: 'lawyer-1', boardKey: 'triage', name: 'My whales', filters: { band: 'A' },
    });
  });

  it('returns 500 when the save fails', async () => {
    saveViewMock.mockResolvedValue({ ok: false, error: 'db down' });
    const res = await POST(postRequest({ board_key: 'triage', name: 'x' }), params());
    expect(res.status).toBe(500);
  });
});
