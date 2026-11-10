import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialiseState } from '../extractor';
import { llmExtract } from '../llm/extractor';

function pendingFetch(): typeof fetch {
  return vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')));
  })) as typeof fetch;
}

describe('family extraction timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it.each([false, true])('retains the family request through 12 seconds and aborts at 45 seconds (follow-up=%s)', async (followUp) => {
    vi.stubGlobal('fetch', pendingFetch());
    const state = { ...initialiseState('A family law inquiry'), family_enabled: true };
    const result = llmExtract(state.input, state, followUp ? { pendingSlotId: 'family_children', reply: 'Yes' } : undefined);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(32_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ mode: 'error', reason: 'request aborted' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the legacy 12-second deadline for the default profile', async () => {
    vi.stubGlobal('fetch', pendingFetch());
    const state = initialiseState('A business invoice is unpaid');
    const result = llmExtract(state.input, state);
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(result).resolves.toMatchObject({ mode: 'error', reason: 'request aborted' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears its timer after an early network rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const state = { ...initialiseState('A family law inquiry'), family_enabled: true };
    await expect(llmExtract(state.input, state)).resolves.toMatchObject({ mode: 'error', reason: 'offline' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears its timer after a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: 'live', extracted: {} }) }));
    const state = { ...initialiseState('A family law inquiry'), family_enabled: true };
    await expect(llmExtract(state.input, state)).resolves.toMatchObject({ mode: 'live' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
