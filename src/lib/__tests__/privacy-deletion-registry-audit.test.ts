import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  registerBackfillSeal,
  registerDeletionIntent,
  saveRegistryIntentProgress,
  saveRegistryOperationState,
  type RegistryStore,
} from '../privacy-deletion-registry';
import {
  auditPrivacyDeletionRegistry,
  type PrivacyRegistryAuditStore,
} from '../privacy-deletion-registry-audit';

const prefix = 'privacy:deletion-registry:v2:';
const cycleId = '22222222-2222-4222-8222-222222222222';
const operationId = '11111111-1111-4111-8111-111111111111';
const firmId = 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5';
const startedAt = '2026-09-03T18:30:00.000Z';
const finishedAt = '2026-09-03T18:31:00.000Z';
const encryptionKey = Buffer.alloc(32, 4).toString('base64');
const originalEnv = { ...process.env };

type SetupStore = PrivacyRegistryAuditStore & RegistryStore & {
  values: Map<string, unknown>;
  set: ReturnType<typeof vi.fn>;
  scan: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function setupStore(): SetupStore {
  const values = new Map<string, unknown>();
  const set = vi.fn(async (key: string, value: unknown, options?: { nx?: true }) => {
    if (options?.nx && values.has(key)) return null;
    values.set(key, value);
    return 'OK';
  });
  return {
    values,
    set,
    async get<T>(key: string) {
      const value = values.get(key);
      if (typeof value === 'string') {
        try { return JSON.parse(value) as T; } catch { return value as T; }
      }
      return (value as T | undefined) ?? null;
    },
    scan: vi.fn(async (): Promise<[string, string[]]> =>
      ['0', [...values.keys()].filter((key) => key.startsWith(prefix))]),
    eval: vi.fn(),
    del: vi.fn(),
  };
}

const intents = [
  { deletionRequestId: '3dc07b21-525f-4ce1-b0c5-31d2ee2c07fe', firmId,
    screenedLeadId: '44444444-4444-4444-8444-444444444444', reason: 'legacy_anonymization_backfill' as const,
    recordedAt: '2026-09-03T14:00:00.000Z' },
  { deletionRequestId: '55c07b21-525f-4ce1-b0c5-31d2ee2c07fe', firmId,
    screenedLeadId: '55555555-5555-4555-8555-555555555555', reason: 'legacy_anonymization_backfill' as const,
    recordedAt: '2026-09-03T14:01:00.000Z' },
];

async function seedCompletedBackfill(store: SetupStore): Promise<void> {
  await store.set(`${prefix}recovery-circuit`, { state: 'locked', changedAt: finishedAt });
  for (const intent of intents) await registerDeletionIntent(intent, store);
  for (const intent of intents) {
    await saveRegistryIntentProgress({ operationId, operation: 'backfill', deletionRequestId: intent.deletionRequestId,
      status: 'applied', attempts: 1, updatedAt: finishedAt, errorCode: null }, store);
  }
  await saveRegistryOperationState({ operationId, cycleId, operation: 'backfill', firmId, status: 'complete',
    startedAt, updatedAt: finishedAt, scanCursor: '0', scanStarted: false, scanExhausted: false,
    bufferedKeys: [], pendingIntents: [], dbCursorRequestedAt: intents[1].recordedAt,
    dbCursorRequestId: intents[1].deletionRequestId, dbUpperBoundRequestedAt: startedAt, dbExhausted: true,
    finalizedAt: finishedAt, scannedCount: 2, appliedCount: 2, skippedCount: 0, failedCount: 0 }, store);
  await registerBackfillSeal({ backfillRunId: operationId, sealedAt: finishedAt,
    sourceWindow: `through-${startedAt}`, scannedCount: 2, appliedCount: 2, skippedCount: 0, failedCount: 0 }, store);
}

beforeEach(() => { process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = encryptionKey; });
afterEach(() => { process.env = { ...originalEnv }; vi.restoreAllMocks(); });

describe('aggregate privacy deletion registry audit', () => {
  it('validates a paginated encrypted terminal backfill without any storage mutation', async () => {
    const store = setupStore();
    await seedCompletedBackfill(store);
    const keys = [...store.values.keys()];
    store.set.mockClear();
    store.scan.mockImplementationOnce(async () => ['17', keys.slice(0, 3)])
      .mockImplementationOnce(async () => ['0', keys.slice(3)]);

    const result = await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store });

    expect(result).toEqual({
      valid: true, failedStage: null,
      counts: { recordCount: 6, firmCount: 1, intentCount: 2, backfillSealCount: 1,
        operationStateCount: 1, intentProgressCount: 2 },
      checks: { locked: true, withinBounds: true, knownKeyShapes: true, encryptedEnvelopes: true,
        noPlaintextDirectIdentifiers: true, terminalOperation: true, cycleLinked: true, accountingLinked: true },
    });
    expect(store.scan).toHaveBeenNthCalledWith(1, '0', { match: `${prefix}*`, count: 100 });
    expect(store.set).not.toHaveBeenCalled();
    expect(store.eval).not.toHaveBeenCalled();
    expect(store.del).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/@|screenedLeadId|deletionRequestId|ciphertext|redis:/i);
  });

  it('refuses to scan unless the external circuit has an exact locked record', async () => {
    const store = setupStore();
    await store.set(`${prefix}recovery-circuit`, { state: 'replaying', changedAt: finishedAt });
    store.set.mockClear();
    const result = await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store });
    expect(result).toMatchObject({ valid: false, failedStage: 'control', checks: { locked: false } });
    expect(store.scan).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('fails closed at the page and key ceilings without leaking a cursor or raw exception', async () => {
    const store = setupStore();
    await store.set(`${prefix}recovery-circuit`, { state: 'locked', changedAt: finishedAt });
    store.scan.mockImplementation(async (cursor: string | number) => [String(Number(cursor) + 1), []]);
    const capped = await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store });
    expect(capped).toMatchObject({ valid: false, failedStage: 'registry_scan', checks: { withinBounds: false } });
    expect(store.scan).toHaveBeenCalledTimes(100);

    store.scan.mockReset().mockRejectedValue(new Error('sensitive Upstash endpoint and token detail'));
    const failed = await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store });
    expect(failed.failedStage).toBe('registry_scan');
    expect(JSON.stringify(failed)).not.toContain('sensitive Upstash endpoint and token detail');
  });

  it('rejects an oversized page and any unknown or transient namespace', async () => {
    const oversized = setupStore();
    await oversized.set(`${prefix}recovery-circuit`, { state: 'locked', changedAt: finishedAt });
    oversized.scan.mockResolvedValue(['0', Array.from({ length: 1_001 }, (_, index) =>
      `${prefix}intent:00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`)]);
    expect(await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store: oversized }))
      .toMatchObject({ valid: false, failedStage: 'registry_scan' });

    const unknown = setupStore();
    await seedCompletedBackfill(unknown);
    unknown.values.set(`${prefix}worker-lease:${operationId}`, 'sensitive transient value');
    const result = await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store: unknown });
    expect(result).toMatchObject({ valid: false, failedStage: 'key_shape' });
    expect(JSON.stringify(result)).not.toContain('sensitive transient value');
  });

  it('rejects plaintext, malformed, or record-id-swapped envelopes with one fixed stage', async () => {
    const plaintext = setupStore();
    await seedCompletedBackfill(plaintext);
    const intentKey = [...plaintext.values.keys()].find((key) => key.startsWith(`${prefix}intent:`))!;
    plaintext.values.set(intentKey, 'name=Sensitive Person;email=secret@example.test');
    const plainResult = await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store: plaintext });
    expect(plainResult).toMatchObject({ valid: false, failedStage: 'encrypted_envelope',
      checks: { noPlaintextDirectIdentifiers: false } });
    expect(JSON.stringify(plainResult)).not.toContain('secret@example.test');

    const swapped = setupStore();
    await seedCompletedBackfill(swapped);
    const intentKeys = [...swapped.values.keys()].filter((key) => key.startsWith(`${prefix}intent:`));
    const first = swapped.values.get(intentKeys[0]);
    swapped.values.set(intentKeys[0], swapped.values.get(intentKeys[1]));
    swapped.values.set(intentKeys[1], first);
    expect(await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store: swapped }))
      .toMatchObject({ valid: false, failedStage: 'encrypted_envelope' });
  });

  it('rejects cycle, operation, progress, and aggregate accounting drift', async () => {
    const wrongCycle = setupStore();
    await seedCompletedBackfill(wrongCycle);
    expect(await auditPrivacyDeletionRegistry({
      cycleId: '33333333-3333-4333-8333-333333333333', operationId, expectedIntentCount: 2, store: wrongCycle,
    })).toMatchObject({ valid: false, failedStage: 'record_linkage', checks: { terminalOperation: false } });

    const missingProgress = setupStore();
    await seedCompletedBackfill(missingProgress);
    const progressKey = [...missingProgress.values.keys()].find((key) => key.startsWith(`${prefix}intent-progress:`))!;
    missingProgress.values.delete(progressKey);
    expect(await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount: 2, store: missingProgress }))
      .toMatchObject({ valid: false, failedStage: 'record_linkage' });
  });
});
