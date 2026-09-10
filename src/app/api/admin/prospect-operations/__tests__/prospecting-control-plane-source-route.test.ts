import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { role: 'operator'; lawyer_id: string } | null,
  list: vi.fn(() => Promise.resolve({ records: [], page: 1, pageSize: 25, total: 0, pageCount: 1 })),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));
vi.mock('@/lib/portal-auth', () => ({ getOperatorSession: () => Promise.resolve(h.session) }));
vi.mock('@/lib/prospect-source-registry', () => ({
  PROSPECTING_CONTROL_PLANE_DEFAULT_PAGE_SIZE: 25,
  PROSPECTING_CONTROL_PLANE_MAX_PAGE_SIZE: 100,
  listProspectingControlPlaneSources: h.list,
}));

import { GET } from '../sources/route';

function request(query = '') {
  return {
    nextUrl: new URL(`https://admin.caseloadselect.ca/api/admin/prospect-operations/sources${query}`),
  };
}

beforeEach(() => {
  h.session = null;
  h.list.mockClear();
});

describe('prospecting Control Plane source registry route', () => {
  it('rejects unauthenticated reads before the data layer', async () => {
    const response = await GET(request() as never);
    expect(response.status).toBe(401);
    expect(h.list).not.toHaveBeenCalled();
  });

  it('passes bounded pagination to the fixed-source helper', async () => {
    h.session = { role: 'operator', lawyer_id: 'operator-1' };
    const response = await GET(request('?page=2&page_size=50') as never);
    expect(response.status).toBe(200);
    expect(h.list).toHaveBeenCalledWith({ page: 2, pageSize: 50 });
  });

  it('rejects oversized, negative, and non-integer pagination', async () => {
    h.session = { role: 'operator', lawyer_id: 'operator-1' };
    const responses = await Promise.all(['?page=0', '?page=-1', '?page=1.5', '?page_size=101'].map((query) => GET(request(query) as never)));
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(h.list).not.toHaveBeenCalled();
  });
});
