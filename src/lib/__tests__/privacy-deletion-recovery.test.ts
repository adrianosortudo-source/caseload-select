import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerIntent: vi.fn(),
  registerSeal: vi.fn(),
  registerReplay: vi.fn(),
  decrypt: vi.fn(),
  assertOpen: vi.fn(),
  assertReplaying: vi.fn(),
  erase: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../privacy-deletion-registry', () => ({
  isPrivacyDeletionRegistryEnabled: () => true,
  registerDeletionIntent: mocks.registerIntent,
  registerBackfillSeal: mocks.registerSeal,
  registerReplayRun: mocks.registerReplay,
  decryptRegistryRecord: mocks.decrypt,
}));
vi.mock('../privacy-recovery-gate', () => ({
  assertPrivacyOperationsOpen: mocks.assertOpen,
  assertPrivacyRecoveryReplaying: mocks.assertReplaying,
}));
vi.mock('../screened-lead-erasure', () => ({ eraseScreenedLead: mocks.erase }));
vi.mock('../supabase-admin', () => ({ supabaseAdmin: { rpc: mocks.rpc } }));

import { backfillDeletionRegistry, RedisRegistryIntentSource, replayDeletionRegistry } from '../privacy-deletion-recovery';

const intent = {
  deletionRequestId: '3dc07b21-525f-4ce1-b0c5-31d2ee2c07fe',
  firmId: 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5',
  screenedLeadId: '44444444-4444-4444-8444-444444444444',
  reason: 'legacy_anonymization_backfill' as const,
  recordedAt: '2026-09-03T14:00:00.000Z',
};

function boundedUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

beforeEach(() => {
  mocks.registerIntent.mockReset().mockResolvedValue('created');
  mocks.registerSeal.mockReset().mockResolvedValue('created');
  mocks.registerReplay.mockReset().mockResolvedValue('created');
  mocks.decrypt.mockReset().mockReturnValue(intent);
  mocks.assertOpen.mockReset().mockResolvedValue(undefined);
  mocks.assertReplaying.mockReset().mockResolvedValue(undefined);
  mocks.erase.mockReset();
});

describe('registry backfill', () => {
  it('enrolls historical deletion requests without attempting a new provider deletion', async () => {
    const result = await backfillDeletionRegistry({
      source: { take: async () => [intent] },
      sourceWindow: 'legacy-redactions-before-2026-09-03',
      now: () => '2026-09-03T15:00:00.000Z',
    });
    expect(result).toMatchObject({ scannedCount: 1, appliedCount: 1, failedCount: 0 });
    expect(mocks.registerIntent).toHaveBeenCalledWith(intent);
    expect(mocks.erase).not.toHaveBeenCalled();
    expect(mocks.registerSeal).toHaveBeenCalledOnce();
  });
});

describe('bounded encrypted registry source', () => {
  it('scans only the intent prefix and decrypts a bounded key batch', async () => {
    const scan = vi.fn(async () => [0, [`privacy:deletion-registry:v2:intent:${intent.deletionRequestId}`]] as [number, string[]]);
    const get = async <T,>(_key: string): Promise<T | null> => 'encrypted-intent' as T;
    const source = new RedisRegistryIntentSource({ scan, get });
    await expect(source.take(1)).resolves.toEqual([intent]);
    expect(scan).toHaveBeenCalledWith('0', { match: 'privacy:deletion-registry:v2:intent:*', count: 1 });
    expect(mocks.decrypt).toHaveBeenCalledWith('encrypted-intent', 'intent', intent.deletionRequestId);
    await expect(source.take(1)).resolves.toEqual([]);
  });

  it('continues through an empty nonterminal page until cursor zero', async () => {
    const keyName = `privacy:deletion-registry:v2:intent:${intent.deletionRequestId}`;
    const scan = vi.fn()
      .mockResolvedValueOnce(['7', []])
      .mockResolvedValueOnce(['0', [keyName]]);
    const get = async <T,>(): Promise<T | null> => 'encrypted-intent' as T;
    const source = new RedisRegistryIntentSource({ scan, get });
    await expect(source.take(1)).resolves.toEqual([intent]);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(source.exhausted()).toBe(true);
  });

  it('buffers an oversized COUNT-hint page and drains every key without skipping', async () => {
    const other = { ...intent, deletionRequestId: '55c07b21-525f-4ce1-b0c5-31d2ee2c07fe' };
    const keys = [intent, other].map((item) => `privacy:deletion-registry:v2:intent:${item.deletionRequestId}`);
    const scan = vi.fn().mockResolvedValue(['0', keys]);
    const get = vi.fn().mockResolvedValue('encrypted-intent');
    mocks.decrypt.mockImplementation((_value, _kind, id) => id === other.deletionRequestId ? other : intent);
    const first = new RedisRegistryIntentSource({ scan, get });
    await expect(first.take(1)).resolves.toEqual([intent]);
    const resumed = new RedisRegistryIntentSource({ scan, get }, first.snapshot());
    await expect(resumed.take(1)).resolves.toEqual([other]);
    expect(resumed.exhausted()).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('persists and drains the full defensive maximum oversized SCAN page', async () => {
    const keys = Array.from({ length: 10_000 }, (_, index) =>
      `privacy:deletion-registry:v2:intent:${boundedUuid(index + 1)}`);
    const scan = vi.fn().mockResolvedValue(['0', keys]);
    const get = vi.fn().mockResolvedValue('encrypted-intent');
    mocks.decrypt.mockImplementation((_value, _kind, id) => ({ ...intent, deletionRequestId: id }));

    const first = new RedisRegistryIntentSource({ scan, get });
    const collected = await first.take(100);
    const checkpoint = first.snapshot();
    expect(checkpoint.bufferedKeys).toHaveLength(9_900);
    expect(checkpoint.bufferedKeys.every((value) => !value.includes('privacy:'))).toBe(true);

    const resumed = new RedisRegistryIntentSource({ scan, get }, checkpoint);
    while (!resumed.exhausted()) collected.push(...await resumed.take(100));
    expect(collected).toHaveLength(10_000);
    expect(new Set(collected.map((value) => (value as typeof intent).deletionRequestId)).size).toBe(10_000);
    expect(get).toHaveBeenCalledTimes(10_000);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated keys while preserving the next unique key', async () => {
    const other = { ...intent, deletionRequestId: '65c07b21-525f-4ce1-b0c5-31d2ee2c07fe' };
    const firstKey = `privacy:deletion-registry:v2:intent:${intent.deletionRequestId}`;
    const secondKey = `privacy:deletion-registry:v2:intent:${other.deletionRequestId}`;
    const scan = vi.fn()
      .mockResolvedValueOnce(['9', [firstKey, firstKey]])
      .mockResolvedValueOnce(['0', [firstKey, secondKey]]);
    mocks.decrypt.mockImplementation((_value, _kind, id) => id === other.deletionRequestId ? other : intent);
    const get = async <T,>(): Promise<T | null> => 'encrypted-intent' as T;
    const source = new RedisRegistryIntentSource({ scan, get });
    await expect(source.take(2)).resolves.toEqual([intent, other]);
    expect(source.exhausted()).toBe(true);
  });
});

describe('registry replay', () => {
  it('reapplies local redaction from the registry without requiring a provider adapter', async () => {
    mocks.erase.mockResolvedValue({ ok: true, redacted_count: 1 });
    await expect(replayDeletionRegistry({
      source: { take: async () => [intent] },
      now: () => '2026-09-03T15:00:00.000Z',
    })).resolves.toMatchObject({ scannedCount: 1, appliedCount: 1, failedCount: 0 });
    expect(mocks.erase).toHaveBeenCalledWith(expect.objectContaining({
      deletionRequestId: intent.deletionRequestId,
      recoveryReplay: true,
    }));
    expect(mocks.erase.mock.calls[0]?.[0]).not.toHaveProperty('externalDeletion');
  });
});
