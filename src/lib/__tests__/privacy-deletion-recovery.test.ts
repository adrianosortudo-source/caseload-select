import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerIntent: vi.fn(),
  registerSeal: vi.fn(),
  registerReplay: vi.fn(),
  decrypt: vi.fn(),
  assertOpen: vi.fn(),
  assertReplaying: vi.fn(),
  erase: vi.fn(),
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

import { backfillDeletionRegistry, RedisRegistryIntentSource } from '../privacy-deletion-recovery';

const intent = {
  deletionRequestId: '3dc07b21-525f-4ce1-b0c5-31d2ee2c07fe',
  firmId: 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5',
  leadId: 'screened-lead-42',
  reason: 'legacy_anonymization_backfill' as const,
  recordedAt: '2026-09-03T14:00:00.000Z',
};

beforeEach(() => {
  mocks.registerIntent.mockReset().mockResolvedValue('created');
  mocks.registerSeal.mockReset().mockResolvedValue('created');
  mocks.decrypt.mockReset().mockReturnValue(intent);
  mocks.assertOpen.mockReset().mockResolvedValue(undefined);
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
    expect(scan).toHaveBeenCalledWith(0, { match: 'privacy:deletion-registry:v2:intent:*', count: 1 });
    expect(mocks.decrypt).toHaveBeenCalledWith('encrypted-intent', 'intent', intent.deletionRequestId);
    await expect(source.take(1)).resolves.toEqual([]);
  });
});
