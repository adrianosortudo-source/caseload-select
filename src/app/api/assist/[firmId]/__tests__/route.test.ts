/**
 * Tests for POST /api/assist/[firmId] (Firm Assist answer route, DR-100,
 * DR-102). Covers the acceptance list from BUILD_PLAN_firm_assist_v1.md
 * section 6: CORS accept/reject, each of the three intents, logging
 * failure never fails the response, and the disabled/error degradation
 * paths return a clean status instead of leaking an internal error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  ipFromRequest: vi.fn(() => '203.0.113.9'),
  embedQuery: vi.fn(),
  retrieveChunks: vi.fn(),
  generateAnswer: vi.fn(),
}));

const state = vi.hoisted(() => ({
  firmRow: null as Record<string, unknown> | null,
  pageRows: [] as Array<Record<string, unknown>>,
  insertCalls: [] as unknown[],
  insertShouldThrow: false,
  dailyCount: 0 as number | null,
  dailyCountError: null as { message: string } | null,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: mocks.ipFromRequest,
  rateLimitHeaders: () => ({}),
}));

vi.mock('@/lib/assist/gemini-embed', () => ({
  embedQuery: mocks.embedQuery,
}));

vi.mock('@/lib/assist/retrieve', () => ({
  retrieveChunks: mocks.retrieveChunks,
}));

vi.mock('@/lib/assist/generate-answer', () => ({
  generateAnswer: mocks.generateAnswer,
}));

vi.mock('@/lib/supabase-admin', () => {
  const from = (table: string) => {
    if (table === 'intake_firms') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: state.firmRow, error: null }),
          }),
        }),
      };
    }
    if (table === 'assist_corpus_pages') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: state.pageRows, error: null }),
        }),
      };
    }
    if (table === 'assist_queries') {
      return {
        // Ses.18 audit F1: fail-closed daily ceiling count query.
        select: () => ({
          eq: () => ({
            gte: () => Promise.resolve({ count: state.dailyCount, error: state.dailyCountError }),
          }),
        }),
        insert: (row: unknown) => {
          state.insertCalls.push(row);
          if (state.insertShouldThrow) return Promise.reject(new Error('insert failed'));
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    throw new Error(`unexpected table in test: ${table}`);
  };
  return { supabaseAdmin: { from } };
});

import { POST, OPTIONS } from '../route';
import type { NextRequest } from 'next/server';

const ALLOWED = { ok: true, active: false, remaining: 8, reset: 0, limit: 8 };
const FIRM_ID = 'firm-1';

function makeRequest(body: unknown, origin: string | null = 'https://drglaw.ca'): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  return new Request(`https://app.caseloadselect.ca/api/assist/${FIRM_ID}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeParams() {
  return { params: Promise.resolve({ firmId: FIRM_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(ALLOWED);
  mocks.ipFromRequest.mockReturnValue('203.0.113.9');
  state.firmRow = {
    id: FIRM_ID,
    name: 'DRG Law Professional Corporation',
    branding: null,
    embed_origins: ['https://drglaw.ca'],
    custom_domain: null,
  };
  state.pageRows = [];
  state.insertCalls = [];
  state.insertShouldThrow = false;
  state.dailyCount = 0;
  state.dailyCountError = null;
});

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  consoleWarnSpy.mockRestore();
});

describe('OPTIONS /api/assist/[firmId]', () => {
  it('returns 204 with CORS headers for an allowed origin', async () => {
    const res = await OPTIONS(makeRequest({}), makeParams());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://drglaw.ca');
  });

  it('returns 403 for a disallowed origin', async () => {
    const res = await OPTIONS(makeRequest({}, 'https://evil.example'), makeParams());
    expect(res.status).toBe(403);
  });
});

describe('POST /api/assist/[firmId]', () => {
  it('rejects a request with no Origin header', async () => {
    const res = await POST(makeRequest({ question: 'Do you handle leases?' }, null), makeParams());
    expect(res.status).toBe(403);
  });

  it('rejects a request from an origin not on the allow-list', async () => {
    const res = await POST(makeRequest({ question: 'Do you handle leases?' }, 'https://evil.example'), makeParams());
    expect(res.status).toBe(403);
  });

  it('returns 404 when the firm does not exist', async () => {
    state.firmRow = null;
    const res = await POST(makeRequest({ question: 'Do you handle leases?' }), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 400 for a too-short question', async () => {
    const res = await POST(makeRequest({ question: 'hi' }), makeParams());
    expect(res.status).toBe(400);
    expect(mocks.embedQuery).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, active: true, remaining: 0, reset: Date.now() + 1000, limit: 8 });
    const res = await POST(makeRequest({ question: 'Do you handle leases?' }), makeParams());
    expect(res.status).toBe(429);
    expect(mocks.embedQuery).not.toHaveBeenCalled();
  });

  describe('daily ceiling (Ses.18 audit F1)', () => {
    it('returns 429 when the daily ceiling is already reached, without calling embedQuery', async () => {
      state.dailyCount = 500; // DEFAULT_DAILY_CEILING
      const res = await POST(makeRequest({ question: 'Do you handle leases?' }), makeParams());
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/daily limit/);
      expect(mocks.embedQuery).not.toHaveBeenCalled();
    });

    it('proceeds when under the daily ceiling', async () => {
      state.dailyCount = 499;
      mocks.embedQuery.mockResolvedValue({ mode: 'live', vectors: [[0.1, 0.2, 0.3]] });
      mocks.retrieveChunks.mockResolvedValue([]);
      mocks.generateAnswer.mockResolvedValue({
        mode: 'live',
        response: { intent: 'out_of_corpus', answer_html: '', source_page_ids: [] },
      });
      const res = await POST(makeRequest({ question: 'What is the capital of France?' }), makeParams());
      expect(res.status).toBe(200);
      expect(mocks.embedQuery).toHaveBeenCalled();
    });

    it('allows the request through and warns when the count query itself errors', async () => {
      state.dailyCountError = { message: 'connection reset' };
      mocks.embedQuery.mockResolvedValue({ mode: 'live', vectors: [[0.1, 0.2, 0.3]] });
      mocks.retrieveChunks.mockResolvedValue([]);
      mocks.generateAnswer.mockResolvedValue({
        mode: 'live',
        response: { intent: 'out_of_corpus', answer_html: '', source_page_ids: [] },
      });
      const res = await POST(makeRequest({ question: 'What is the capital of France?' }), makeParams());
      expect(res.status).toBe(200);
      expect(mocks.embedQuery).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });

  it('returns 503 when Gemini is not configured (embedding disabled)', async () => {
    mocks.embedQuery.mockResolvedValue({ mode: 'disabled', vectors: [], reason: 'no key' });
    const res = await POST(makeRequest({ question: 'Do you handle leases?' }), makeParams());
    expect(res.status).toBe(503);
  });

  it('returns 502 on an embedding error', async () => {
    mocks.embedQuery.mockResolvedValue({ mode: 'error', vectors: [], reason: 'boom' });
    const res = await POST(makeRequest({ question: 'Do you handle leases?' }), makeParams());
    expect(res.status).toBe(502);
  });

  it('answered: informational question returns sources and logs the query', async () => {
    mocks.embedQuery.mockResolvedValue({ mode: 'live', vectors: [[0.1, 0.2, 0.3]] });
    mocks.retrieveChunks.mockResolvedValue([{ page_id: 'page-1', heading: 'Leases', chunk_text: 'The firm reviews leases.' }]);
    mocks.generateAnswer.mockResolvedValue({
      mode: 'live',
      response: { intent: 'informational', answer_html: '<p>The firm reviews commercial leases.</p>', source_page_ids: ['page-1'] },
    });
    state.pageRows = [{ id: 'page-1', title: 'Commercial Leases', url: 'https://drglaw.ca/journal/leases' }];

    const res = await POST(makeRequest({ question: 'Do you handle commercial leases?' }), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.exit).toBe('answered');
    expect(json.sources).toEqual([{ title: 'Commercial Leases', url: 'https://drglaw.ca/journal/leases' }]);
    expect(state.insertCalls).toHaveLength(1);
    expect((state.insertCalls[0] as { intent: string }).intent).toBe('informational');
    // Ses.18 audit F4: source_page_ids logs real assist_corpus_pages ids,
    // not URLs (the column is id-typed).
    expect((state.insertCalls[0] as { source_page_ids: string[] }).source_page_ids).toEqual(['page-1']);
  });

  it('F4: drops a hallucinated source_page_id from the logged row (never logs an id absent from pagesById)', async () => {
    mocks.embedQuery.mockResolvedValue({ mode: 'live', vectors: [[0.1, 0.2, 0.3]] });
    mocks.retrieveChunks.mockResolvedValue([{ page_id: 'page-1', heading: 'Leases', chunk_text: 'The firm reviews leases.' }]);
    mocks.generateAnswer.mockResolvedValue({
      mode: 'live',
      response: { intent: 'informational', answer_html: '<p>Some answer.</p>', source_page_ids: ['page-1', 'page-does-not-exist'] },
    });
    state.pageRows = [{ id: 'page-1', title: 'Commercial Leases', url: 'https://drglaw.ca/journal/leases' }];

    const res = await POST(makeRequest({ question: 'Do you handle commercial leases?' }), makeParams());
    expect(res.status).toBe(200);
    expect((state.insertCalls[0] as { source_page_ids: string[] }).source_page_ids).toEqual(['page-1']);
  });

  it('screen_handoff: case-specific question never returns model-authored text', async () => {
    mocks.embedQuery.mockResolvedValue({ mode: 'live', vectors: [[0.1, 0.2, 0.3]] });
    mocks.retrieveChunks.mockResolvedValue([]);
    mocks.generateAnswer.mockResolvedValue({
      mode: 'live',
      response: { intent: 'case_specific', answer_html: 'should never appear', source_page_ids: [] },
    });

    const res = await POST(makeRequest({ question: 'My landlord locked me out, can I sue?' }), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.exit).toBe('screen_handoff');
    expect(json.message).not.toContain('should never appear');
  });

  it('no_coverage: out-of-corpus question returns the fixed miss copy', async () => {
    mocks.embedQuery.mockResolvedValue({ mode: 'live', vectors: [[0.1, 0.2, 0.3]] });
    mocks.retrieveChunks.mockResolvedValue([]);
    mocks.generateAnswer.mockResolvedValue({
      mode: 'live',
      response: { intent: 'out_of_corpus', answer_html: '', source_page_ids: [] },
    });

    const res = await POST(makeRequest({ question: 'What is the capital of France?' }), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.exit).toBe('no_coverage');
  });

  it('a logging failure never fails the response to the visitor', async () => {
    mocks.embedQuery.mockResolvedValue({ mode: 'live', vectors: [[0.1, 0.2, 0.3]] });
    mocks.retrieveChunks.mockResolvedValue([]);
    mocks.generateAnswer.mockResolvedValue({
      mode: 'live',
      response: { intent: 'out_of_corpus', answer_html: '', source_page_ids: [] },
    });
    state.insertShouldThrow = true;

    const res = await POST(makeRequest({ question: 'What is the capital of France?' }), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.exit).toBe('no_coverage');
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});
