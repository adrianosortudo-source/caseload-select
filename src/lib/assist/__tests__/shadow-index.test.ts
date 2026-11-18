import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIST_SHADOW_MODEL, ASSIST_SHADOW_VERSION, embedAssistShadowTexts } from '../openai-embed';
import { backfillAssistShadow } from '../shadow-index';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc } }));
const vector = (position: number) => Array.from({ length: 768 }, (_, i) => Number(i === position));
const fetchMock = vi.fn();
const document = (id: string, hash: string) => ({ chunk_id: id, source_hash: hash, chunk_text: 'Fictional ' + id });
const modelResponse = (data: unknown, model = ASSIST_SHADOW_MODEL) => Response.json({ model, data });
const pending = (data: unknown[]) => Promise.resolve({ data, error: null });
const stored = (count: number) => Promise.resolve({ data: count, error: null });
const readiness = { included_pages: 1, unavailable_pages: 0, source_chunks: 1, indexed_chunks: 1, ready: true };
beforeEach(() => {
  vi.stubEnv('CASELOAD_OPENAI_API_KEY', 'fictional-key');
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); rpc.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('direct 768d shadow embedding channel', () => {
  it('returns the original order and uses only the fixed project endpoint and model', async () => {
    fetchMock.mockResolvedValue(modelResponse([{ index: 1, embedding: vector(1) }, { index: 0, embedding: vector(0) }]));
    expect(await embedAssistShadowTexts(['A', 'B'])).toEqual([vector(0), vector(1)]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(options).toMatchObject({ redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer fictional-key' } });
    expect(JSON.parse(options.body)).toEqual({ model: ASSIST_SHADOW_MODEL, input: ['A', 'B'], dimensions: 768, encoding_format: 'float' });
  });
  it('refuses unexpected models, invalid vectors, duplicate indexes and provider errors without echoing provider text', async () => {
    for (const response of [
      modelResponse([{ index: 0, embedding: vector(0) }], 'other-model'),
      modelResponse([{ index: 0, embedding: [1, 0] }]), modelResponse([{ index: 1, embedding: vector(0) }]),
      modelResponse([{ index: 0, embedding: Array(768).fill(0) }]),
      modelResponse([{ index: 0, embedding: Array(768).fill(1e100) }]),
      modelResponse([{ index: 0, embedding: vector(0) }, { index: 0, embedding: vector(1) }]),
      new Response('Fictional privileged body', { status: 503 }), new Response('Fictional guarded answer'),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      const texts = (await response.clone().json().catch(() => ({}))).data?.length === 2 ? ['a', 'b'] : ['a'];
      await expect(embedAssistShadowTexts(texts)).rejects.toThrow(/Unexpected Assist|Invalid Assist|HTTP 503/);
    }
    fetchMock.mockClear(); vi.stubEnv('CASELOAD_OPENAI_API_KEY', '');
    await expect(embedAssistShadowTexts(['a'])).rejects.toThrow('project key');
    await expect(embedAssistShadowTexts([])).rejects.toThrow('nonempty'); expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('per-firm shadow worker', () => {
  it('continues to the new source after a stale result, then reports fresh DB readiness', async () => {
    const old = document('A','old'), current = document('B','new');
    rpc.mockReturnValueOnce(pending([old])).mockReturnValueOnce(stored(0))
      .mockReturnValueOnce(pending([current])).mockReturnValueOnce(stored(1))
      .mockReturnValueOnce(pending([])).mockReturnValueOnce({ single: () => Promise.resolve({ data: readiness }) });
    fetchMock.mockImplementation(() => Promise.resolve(modelResponse([{ index: 0, embedding: vector(0) }])));
    const result = await backfillAssistShadow('firm-A', 5);
    expect(result).toEqual({ batches: 2, offered: 2, saved: 1, readiness });
    expect(rpc.mock.calls.every(([, args]) => args.p_firm_id === 'firm-A' && args.p_version === ASSIST_SHADOW_VERSION)).toBe(true);
    expect(rpc.mock.calls.filter(([name]) => name === 'assist_shadow_store').map(([, args]) => args.p_rows[0].source_hash)).toEqual(['old','new']);
  });
  it('stops before repeating an identical unresolved batch and never assumes a missing batch was saved', async () => {
    const work = [document('A','old')];
    rpc.mockReturnValueOnce(pending(work)).mockReturnValueOnce(stored(0)).mockReturnValueOnce(pending(work))
      .mockReturnValueOnce({ single: () => Promise.resolve({ data: { ...readiness, ready: false } }) });
    fetchMock.mockImplementation(() => Promise.resolve(modelResponse([{ index: 0, embedding: vector(0) }])));
    expect((await backfillAssistShadow('firm-A', 100)).readiness.ready).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rpc.mockReturnValueOnce(pending(work)).mockReturnValueOnce({ data: null, error: { code: 'unavailable' } });
    await expect(backfillAssistShadow('firm-A', 1)).rejects.toThrow('confirm');
    await expect(backfillAssistShadow('firm-A', 0)).rejects.toThrow('batch limit');
  });
});
