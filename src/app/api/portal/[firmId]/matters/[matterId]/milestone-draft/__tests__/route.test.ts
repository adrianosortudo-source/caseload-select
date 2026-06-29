/**
 * Tests for POST /api/portal/[firmId]/matters/[matterId]/milestone-draft
 *
 * Covers: auth gates, input validation, Gemini call, DB side-effect,
 * happy path response shape, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// ── Mocks ────────────────────────────────────────────────────────────────

const mockGetFirmSession = vi.fn();
const mockGetMatterById = vi.fn();

const mockEqChain = vi.fn().mockResolvedValue({});
const mockUpdate = vi.fn(() => ({ eq: mockEqChain }));

const mockMaybeSingle = vi.fn();
const mockInnerEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockOuterEq = vi.fn(() => ({ eq: mockInnerEq }));
const mockSelect = vi.fn(() => ({ eq: mockOuterEq }));

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === 'client_matters') return { update: mockUpdate };
    if (table === 'firm_lawyers') return { select: mockSelect };
    return {};
  }),
};

const mockGoogleaiCreate = vi.fn();

vi.mock('@/lib/portal-auth', () => ({
  getFirmSession: (...args: unknown[]) => mockGetFirmSession(...args),
}));

vi.mock('@/lib/matter-stage', () => ({
  getMatterById: (...args: unknown[]) => mockGetMatterById(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: mockSupabase,
}));

vi.mock('@/lib/openrouter', () => ({
  googleai: {
    chat: {
      completions: {
        create: (...args: unknown[]) => mockGoogleaiCreate(...args),
      },
    },
  },
  MODELS: { STANDARD: 'gemini-2.5-flash' },
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/portal/firm-1/matters/matter-1/milestone-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const PARAMS = Promise.resolve({ firmId: 'firm-1', matterId: 'matter-1' });

const ACTIVE_MATTER = {
  id: 'matter-1',
  firm_id: 'firm-1',
  matter_stage: 'active',
  matter_type: 'Residential purchase',
  practice_area: 'real_estate',
  primary_name: 'Ana Santos',
  primary_email: 'ana@example.com',
  primary_phone: null,
  matter_milestone: null,
  matter_milestone_note: null,
};

const LAWYER_SESSION = { role: 'lawyer', lawyer_id: 'lawyer-1', firm_id: 'firm-1' };

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/portal/[firmId]/matters/[matterId]/milestone-draft', () => {
  beforeEach(async () => {
    mockGetFirmSession.mockResolvedValue(LAWYER_SESSION);
    mockGetMatterById.mockResolvedValue(ACTIVE_MATTER);
    mockMaybeSingle.mockResolvedValue({ data: { display_name: 'Damaris Regina Guimaraes' } });
    mockGoogleaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'Good news: conditions are waived. Damaris.' } }],
    });
    process.env.GOOGLE_AI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.GOOGLE_AI_API_KEY;
  });

  it('returns 401 when no session', async () => {
    mockGetFirmSession.mockResolvedValue(null);
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'Conditions waived' }), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it('returns 403 for client session', async () => {
    mockGetFirmSession.mockResolvedValue({ role: 'client', firm_id: 'firm-1' });
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'Conditions waived' }), { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it('returns 404 when matter not found', async () => {
    mockGetMatterById.mockResolvedValue(null);
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'Conditions waived' }), { params: PARAMS });
    expect(res.status).toBe(404);
  });

  it('returns 422 for non-active matter', async () => {
    mockGetMatterById.mockResolvedValue({ ...ACTIVE_MATTER, matter_stage: 'intake' });
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'Conditions waived' }), { params: PARAMS });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/active matters/);
  });

  it('returns 503 when GOOGLE_AI_API_KEY is absent', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'Conditions waived' }), { params: PARAMS });
    expect(res.status).toBe(503);
  });

  it('returns 400 when milestone is missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ note: 'good stuff' }), { params: PARAMS });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/milestone is required/);
  });

  it('returns 400 when milestone exceeds 120 chars', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'a'.repeat(121) }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('returns 502 when Gemini returns empty response', async () => {
    mockGoogleaiCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'Conditions waived' }), { params: PARAMS });
    expect(res.status).toBe(502);
  });

  it('returns 502 when Gemini throws', async () => {
    mockGoogleaiCreate.mockRejectedValue(new Error('network timeout'));
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'Conditions waived' }), { params: PARAMS });
    expect(res.status).toBe(502);
  });

  it('returns 200 with draft and milestone on happy path', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ milestone: 'Conditions waived' }), { params: PARAMS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toBe('Good news: conditions are waived. Damaris.');
    expect(body.milestone).toBe('Conditions waived');
  });

  it('passes note to Gemini when provided', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ milestone: 'Conditions waived', note: 'congrats!' }), { params: PARAMS });
    const call = mockGoogleaiCreate.mock.calls[0][0];
    const userMsg = call.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('congrats!');
  });

  it('updates matter_milestone and matter_milestone_note on success', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ milestone: 'Conditions waived', note: 'great!' }), { params: PARAMS });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ matter_milestone: 'Conditions waived', matter_milestone_note: 'great!' }),
    );
  });

  it('omits matter_milestone_note when note is blank', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ milestone: 'Conditions waived', note: '   ' }), { params: PARAMS });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ matter_milestone: 'Conditions waived', matter_milestone_note: null }),
    );
  });
});
