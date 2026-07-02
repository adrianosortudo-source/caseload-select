/**
 * Tests for PATCH /api/portal/[firmId]/conflict-checks/[checkId]
 *
 * Covers: auth, validation, the already-dispositioned guard, and the
 * waiver-consent linkage (H4 fix): waiving a check must create a
 * consent_log row with consent_type='conflict_waiver' and write its id
 * onto waiver_consent_id, requires a non-empty note, and never marks the
 * check as waived if the consent_log insert fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const mockGetFirmSession = vi.fn();

const mockCheckMaybeSingle = vi.fn();
const mockCheckEq2 = vi.fn(() => ({ maybeSingle: mockCheckMaybeSingle }));
const mockCheckEq1 = vi.fn(() => ({ eq: mockCheckEq2 }));
const mockCheckSelect = vi.fn(() => ({ eq: mockCheckEq1 }));

const mockUpdateSingle = vi.fn();
const mockUpdateSelect = vi.fn(() => ({ single: mockUpdateSingle }));
const mockUpdateEq = vi.fn(() => ({ select: mockUpdateSelect }));
const mockUpdate = vi.fn((_patch: Record<string, unknown>) => ({ eq: mockUpdateEq }));

const mockConsentSingle = vi.fn();
const mockConsentSelect = vi.fn(() => ({ single: mockConsentSingle }));
const mockConsentInsert = vi.fn((_row: Record<string, unknown>) => ({ select: mockConsentSelect }));

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === 'screened_conflict_checks') {
      return { select: mockCheckSelect, update: mockUpdate };
    }
    if (table === 'consent_log') {
      return { insert: mockConsentInsert };
    }
    return {};
  }),
};

vi.mock('@/lib/portal-auth', () => ({
  getFirmSession: (...args: unknown[]) => mockGetFirmSession(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: mockSupabase,
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/portal/firm-1/conflict-checks/check-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const PARAMS = Promise.resolve({ firmId: 'firm-1', checkId: 'check-1' });

const PENDING_CHECK = {
  id: 'check-1',
  firm_id: 'firm-1',
  screened_lead_id: 'lead-1',
  check_status: 'pending',
};

const LAWYER_SESSION = { role: 'lawyer', lawyer_id: 'lawyer-1', firm_id: 'firm-1' };

describe('PATCH /api/portal/[firmId]/conflict-checks/[checkId]', () => {
  beforeEach(() => {
    mockGetFirmSession.mockResolvedValue(LAWYER_SESSION);
    mockCheckMaybeSingle.mockResolvedValue({ data: PENDING_CHECK, error: null });
    mockConsentSingle.mockResolvedValue({ data: { id: 'consent-1' }, error: null });
    mockUpdateSingle.mockResolvedValue({
      data: { ...PENDING_CHECK, check_status: 'cleared' },
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no session', async () => {
    mockGetFirmSession.mockResolvedValue(null);
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ disposition: 'cleared' }), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid disposition', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ disposition: 'ignored' }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('returns 400 when waiving without notes', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ disposition: 'waived' }), { params: PARAMS });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/notes is required/);
    expect(mockConsentInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when waiving with whitespace-only notes', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ disposition: 'waived', notes: '   ' }), { params: PARAMS });
    expect(res.status).toBe(400);
    expect(mockConsentInsert).not.toHaveBeenCalled();
  });

  it('returns 404 when the check does not exist', async () => {
    mockCheckMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ disposition: 'cleared' }), { params: PARAMS });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the check is already dispositioned', async () => {
    mockCheckMaybeSingle.mockResolvedValue({
      data: { ...PENDING_CHECK, check_status: 'cleared' },
      error: null,
    });
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ disposition: 'cleared' }), { params: PARAMS });
    expect(res.status).toBe(409);
  });

  it('clearing does not touch consent_log', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ disposition: 'cleared', notes: 'no matches' }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(mockConsentInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ check_status: 'cleared', disposition: 'cleared' }),
    );
    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg).not.toHaveProperty('waiver_consent_id');
  });

  it('waiving with notes creates a conflict_waiver consent_log row and links it', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest({ disposition: 'waived', notes: 'Prior matter unrelated; client consents.' }),
      { params: PARAMS },
    );
    expect(res.status).toBe(200);

    expect(mockConsentInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        firm_id: 'firm-1',
        subject_id: 'lead-1',
        consent_type: 'conflict_waiver',
        consent_status: 'granted',
        note: 'Prior matter unrelated; client consents.',
        expires_at: null,
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        check_status: 'waived',
        disposition: 'waived',
        waiver_consent_id: 'consent-1',
      }),
    );
  });

  it('does not disposition the check when the consent_log insert fails', async () => {
    mockConsentSingle.mockResolvedValue({ data: null, error: { message: 'insert failed' } });
    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest({ disposition: 'waived', notes: 'basis' }),
      { params: PARAMS },
    );
    expect(res.status).toBe(500);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
