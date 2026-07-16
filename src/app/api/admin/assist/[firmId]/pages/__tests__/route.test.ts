/**
 * Tests for /api/admin/assist/[firmId]/pages (BUILD_PLAN_firm_assist_v1.md
 * section 8 acceptance: "pages PATCH firm-scoping rejection").
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOperatorSession: vi.fn(),
}));

const state = vi.hoisted(() => ({
  listRows: [] as Array<Record<string, unknown>>,
  findRow: null as Record<string, unknown> | null,
  updateCalls: [] as unknown[],
}));

vi.mock('@/lib/portal-auth', () => ({
  getOperatorSession: mocks.getOperatorSession,
}));

vi.mock('@/lib/supabase-admin', () => {
  const from = (table: string) => {
    if (table !== 'assist_corpus_pages') throw new Error(`unexpected table in test: ${table}`);
    return {
      select: (cols: string) => ({
        eq: () => ({
          order: () => Promise.resolve({ data: state.listRows, error: null }),
          maybeSingle: () => Promise.resolve({ data: state.findRow, error: null }),
        }),
      }),
      update: (row: unknown) => ({
        eq: () => {
          state.updateCalls.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
  };
  return { supabaseAdmin: { from } };
});

import { GET, PATCH } from '../route';
import type { NextRequest } from 'next/server';

const FIRM_ID = 'firm-1';
const OTHER_FIRM_ID = 'firm-2';

function makeParams() {
  return { params: Promise.resolve({ firmId: FIRM_ID }) };
}

function makePatchRequest(body: unknown): NextRequest {
  return new Request(`https://app.caseloadselect.ca/api/admin/assist/${FIRM_ID}/pages`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOperatorSession.mockResolvedValue({ role: 'operator' });
  state.listRows = [];
  state.findRow = null;
  state.updateCalls = [];
});

describe('GET /api/admin/assist/[firmId]/pages', () => {
  it('rejects an unauthenticated request', async () => {
    mocks.getOperatorSession.mockResolvedValue(null);
    const res = await GET({} as NextRequest, makeParams());
    expect(res.status).toBe(401);
  });

  it('returns the firm\'s pages', async () => {
    state.listRows = [{ id: 'p1', url: 'https://drglaw.ca/faq', title: 'FAQ', include: true }];
    const res = await GET({} as NextRequest, makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pages).toHaveLength(1);
  });
});

describe('PATCH /api/admin/assist/[firmId]/pages', () => {
  it('rejects an unauthenticated request', async () => {
    mocks.getOperatorSession.mockResolvedValue(null);
    const res = await PATCH(makePatchRequest({ pageId: 'p1', include: false }), makeParams());
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body', async () => {
    const res = await PATCH(makePatchRequest({ pageId: 'p1' }), makeParams());
    expect(res.status).toBe(400);
  });

  it('rejects a pageId that does not exist', async () => {
    state.findRow = null;
    const res = await PATCH(makePatchRequest({ pageId: 'ghost', include: false }), makeParams());
    expect(res.status).toBe(404);
    expect(state.updateCalls).toHaveLength(0);
  });

  it('rejects a pageId that belongs to a different firm (firm-scoping)', async () => {
    state.findRow = { id: 'p1', firm_id: OTHER_FIRM_ID };
    const res = await PATCH(makePatchRequest({ pageId: 'p1', include: false }), makeParams());
    expect(res.status).toBe(404);
    expect(state.updateCalls).toHaveLength(0);
  });

  it('accepts a pageId that belongs to this firm', async () => {
    state.findRow = { id: 'p1', firm_id: FIRM_ID };
    const res = await PATCH(makePatchRequest({ pageId: 'p1', include: false }), makeParams());
    expect(res.status).toBe(200);
    expect(state.updateCalls).toHaveLength(1);
    expect((state.updateCalls[0] as { include: boolean }).include).toBe(false);
  });
});
