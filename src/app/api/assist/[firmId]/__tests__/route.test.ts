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
  pageReadError: false,
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
          eq: (field: string, id: string) => ({
            eq: (included: string, flag: boolean) => {
              if (field !== 'firm_id' || included !== 'include' || flag !== true) throw Error('Expected firm and inclusion filters');
              const pages = state.pageRows.filter(page => (page.firm_id ?? FIRM_ID) === id && (page.include ?? true) === true);
              return {
                count: pages.length,
                in: (_key: string, ids: string[]) => Promise.resolve({
                  data: pages.filter(page => ids.includes(String(page.id))),
                  error: state.pageReadError ? { message: 'fixture unavailable' } : null,
                }),
              };
            },
          }),
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
import { GET as getConfig } from '../config/route';
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
  state.pageReadError = false;
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
  vi.unstubAllEnvs();
});

describe('scoped Firm Assist answer provider', () => {
  const version = 'firm-assist-openai-answer-v1';
  const question = 'When is the fictional office open?';

  beforeEach(() => {
    vi.stubEnv('FIRM_ASSIST_ANSWER_AI_PROVIDER', 'openai');
    vi.stubEnv('FIRM_ASSIST_OPENAI_FIRM_IDS', 'other-id, firm-1');
    vi.stubEnv('CASELOAD_OPENAI_API_KEY', 'fixture');
    vi.stubEnv('GOOGLE_AI_API_KEY', 'fixture');
    state.firmRow = { id: FIRM_ID, name: 'Example Office', branding: null, embed_origins: ['https://demo.example'] };
    state.pageRows = [
      { id: 'hours', firm_id: FIRM_ID, include: true, title: 'Hours', url: 'https://demo.example/hours' },
      { id: 'hidden', firm_id: FIRM_ID, include: false },
      { id: 'foreign', firm_id: 'second-firm', include: true },
    ];
    mocks.embedQuery.mockResolvedValue({ mode: 'live', vectors: [[1]] });
    mocks.retrieveChunks.mockResolvedValue(state.pageRows.map(page => ({ page_id: page.id, chunk_text: page.id })));
    mocks.generateAnswer.mockResolvedValue({ mode: 'live', response: { intent: 'case_specific', answer_html: 'fixture', source_page_ids: [] } });
  });

  const req = (extra = {}) => makeRequest({ question, ...extra }, 'https://demo.example');

  it('advertises both providers and permits only the enrolled firm’s included sources on an affirmative request', async () => {
    const config = await (await getConfig(req(), makeParams())).json();
    expect(config.openaiAnswerOption).toMatchObject({ consentVersion: version });
    expect(config.openaiAnswerOption.disclosure).toMatch(/Google.+OpenAI/);
    const res = await POST(req({ openaiAnswerConsent: version }), makeParams());
    expect((await res.json()).exit).toBe('screen_handoff');
    expect(mocks.generateAnswer).toHaveBeenCalledWith(question, 'Example Office', [{ page_id: 'hours', chunk_text: 'hours' }], 'openai');
    expect(mocks.retrieveChunks).toHaveBeenCalledWith(FIRM_ID, [1]);
  });

  it('uses Gemini for an existing widget, including at an enrolled firm', async () => {
    await POST(req({provider: 'openai'}), makeParams());
    expect(mocks.generateAnswer).toHaveBeenCalledWith(question, 'Example Office', expect.any(Array), 'gemini');
  });

  it('rejects a stale choice and cross-firm provider override before embedding', async () => {
    expect((await POST(req({ openaiAnswerConsent: 'old' }), makeParams())).status).toBe(409);
    state.firmRow = { ...state.firmRow, id: 'second-firm' };
    const before = await (await getConfig(req(), {params:Promise.resolve({firmId:'second-firm'})})).json();
    expect(before).toEqual({ ok: true, enabled: true });
    expect((await POST(req({ openaiAnswerConsent: version, firmId: FIRM_ID }), {params:Promise.resolve({firmId:'second-firm'})})).status).toBe(409);
    expect(mocks.embedQuery).not.toHaveBeenCalled();
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it.each([
    ['FIRM_ASSIST_OPENAI_FIRM_IDS', ''],
    ['FIRM_ASSIST_OPENAI_FIRM_IDS', '*'],
    ['FIRM_ASSIST_ANSWER_AI_PROVIDER', 'gemini'],
    ['CASELOAD_OPENAI_API_KEY', ''],
  ])('omits an unavailable option when %s is %s', async (key, value) => {
    vi.stubEnv(key, value);
    expect(await (await getConfig(req(), makeParams())).json()).toEqual({ok:true, enabled:true});
    expect((await POST(req({openaiAnswerConsent:version}), makeParams())).status).toBe(409);
    expect(mocks.embedQuery).not.toHaveBeenCalled();
  });

  it('sends no chunks when the current source-page check fails', async () => {
    state.pageReadError = true;
    expect((await POST(req({ openaiAnswerConsent: version }), makeParams())).status).toBe(502);
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it('returns fixed no-coverage copy if GPT cites only a retired or different firm’s page', async () => {
    mocks.generateAnswer.mockResolvedValue({
      mode: 'live',
      response: { intent: 'informational', answer_html: '<p>Unsupported answer</p>', source_page_ids: ['hidden', 'foreign'] },
    });
    const res = await POST(req({ openaiAnswerConsent: version }), makeParams());
    expect(await res.json()).toMatchObject({ok:true, exit:'no_coverage'});
    expect(state.insertCalls).toMatchObject([{intent:'out_of_corpus', answer_html:null}]);
  });
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
