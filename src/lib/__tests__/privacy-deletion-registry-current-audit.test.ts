import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  registerBackfillSeal,
  registerDeletionAppliedReceipt,
  registerDeletionIntent,
  registerReplayRun,
  saveRegistryIntentProgress,
  saveRegistryOperationState,
  type RegistryOperationState,
  type RegistryStore,
} from '../privacy-deletion-registry';
import {
  auditPrivacyDeletionRegistryAfterReplay,
  type PrivacyRegistryCurrentAuditStore,
} from '../privacy-deletion-registry-current-audit';

const prefix = 'privacy:deletion-registry:v2:';
const cycleId = '22222222-2222-4222-8222-222222222222';
const backfillOperationId = '11111111-1111-4111-8111-111111111111';
const replayOperationId = '33333333-3333-4333-8333-333333333333';
const abandonedOperationId = '66666666-6666-4666-8666-666666666666';
const firmId = 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5';
const startedAt = '2026-09-03T18:30:00.000Z';
const finishedAt = '2026-09-03T18:31:00.000Z';
const encryptionKey = Buffer.alloc(32, 4).toString('base64');
const originalEnv = { ...process.env };

type SetupStore = PrivacyRegistryCurrentAuditStore & RegistryStore & {
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

function state(args: Partial<RegistryOperationState> & Pick<RegistryOperationState, 'operationId' | 'operation' | 'firmId'>): RegistryOperationState {
  const status = args.status ?? 'complete';
  const terminal = status === 'complete' || status === 'failed';
  return { operationId: args.operationId, cycleId, operation: args.operation, firmId: args.firmId,
    status, startedAt, updatedAt: finishedAt, scanCursor: '0',
    scanStarted: args.operation === 'replay', scanExhausted: args.operation === 'replay' && terminal,
    bufferedKeys: [], pendingIntents: [], dbCursorRequestedAt: args.operation === 'backfill' ? intents[1].recordedAt : null,
    dbCursorRequestId: args.operation === 'backfill' ? intents[1].deletionRequestId : null,
    dbUpperBoundRequestedAt: startedAt, dbExhausted: args.operation === 'backfill' && terminal,
    finalizedAt: terminal ? finishedAt : null, scannedCount: args.scannedCount ?? 2,
    appliedCount: args.appliedCount ?? 0, skippedCount: args.skippedCount ?? 2,
    failedCount: args.failedCount ?? 0 };
}

async function seedCompletedReplay(store: SetupStore): Promise<void> {
  await store.set(`${prefix}recovery-circuit`, { state: 'locked', changedAt: finishedAt });
  for (const intent of intents) {
    await registerDeletionIntent(intent, store);
    await registerDeletionAppliedReceipt({ deletionRequestId: intent.deletionRequestId,
      redactedCount: 0, appliedAt: finishedAt }, store);
    await saveRegistryIntentProgress({ operationId: backfillOperationId, operation: 'backfill',
      deletionRequestId: intent.deletionRequestId, status: 'applied', attempts: 1,
      updatedAt: finishedAt, errorCode: null }, store);
    await saveRegistryIntentProgress({ operationId: replayOperationId, operation: 'replay',
      deletionRequestId: intent.deletionRequestId, status: 'skipped', attempts: 1,
      updatedAt: finishedAt, errorCode: null }, store);
  }
  await saveRegistryOperationState(state({ operationId: backfillOperationId, operation: 'backfill', firmId,
    appliedCount: 2, skippedCount: 0 }), store);
  await registerBackfillSeal({ backfillRunId: backfillOperationId, sealedAt: finishedAt,
    sourceWindow: `through-${startedAt}`, scannedCount: 2, appliedCount: 2,
    skippedCount: 0, failedCount: 0 }, store);
  await saveRegistryOperationState(state({ operationId: replayOperationId, operation: 'replay', firmId: null }), store);
  await registerReplayRun({ replayRunId: replayOperationId, startedAt, finishedAt,
    candidateCount: 2, appliedCount: 0, skippedCount: 2, failedCount: 0, outcome: 'complete' }, store);
  // A locked registry may retain a valid checkpoint from an abandoned attempt.
  await saveRegistryOperationState(state({ operationId: abandonedOperationId, operation: 'replay', firmId: null,
    status: 'running', scannedCount: 1, skippedCount: 0 }), store);
  await saveRegistryIntentProgress({ operationId: abandonedOperationId, operation: 'replay',
    deletionRequestId: intents[0].deletionRequestId, status: 'failed', attempts: 1,
    updatedAt: finishedAt, errorCode: 'redaction_failed' }, store);
}

beforeEach(() => { process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = encryptionKey; });
afterEach(() => { process.env = { ...originalEnv }; vi.restoreAllMocks(); });

describe('locked post-replay deletion registry audit', () => {
  it('validates every durable namespace while allowing an encrypted abandoned checkpoint', async () => {
    const store = setupStore();
    await seedCompletedReplay(store);
    const keys = [...store.values.keys()];
    store.set.mockClear();
    store.scan.mockImplementationOnce(async () => ['9', keys.slice(0, 5)])
      .mockImplementationOnce(async () => ['0', keys.slice(5)]);

    const result = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store,
    });

    expect(result).toEqual({
      valid: true, failedStage: null,
      counts: { recordCount: 14, firmCount: 1, intentCount: 2, appliedReceiptCount: 2,
        backfillSealCount: 1, replayRunCount: 1, operationStateCount: 3, intentProgressCount: 5 },
      checks: { locked: true, withinBounds: true, knownKeyShapes: true,
        activationMarkerValid: true, activationMarkerPresent: false, encryptedEnvelopes: true,
        noPlaintextDirectIdentifiers: true, receiptsLinked: true, terminalBackfill: true,
        terminalReplay: true, cycleLinked: true, evidenceLinked: true, accountingLinked: true },
    });
    expect(store.scan).toHaveBeenNthCalledWith(1, '0', { match: `${prefix}*`, count: 100 });
    expect(store.set).not.toHaveBeenCalled();
    expect(store.eval).not.toHaveBeenCalled();
    expect(store.del).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/@|screenedLeadId|deletionRequestId|ciphertext|redis:/i);
  });

  it('accepts only the exact non-personal activation marker', async () => {
    const store = setupStore();
    await seedCompletedReplay(store);
    await store.set(`${prefix}activation`, 'v1');
    const valid = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store,
    });
    expect(valid).toMatchObject({ valid: true, checks: { activationMarkerValid: true, activationMarkerPresent: true } });

    store.values.set(`${prefix}activation`, 'sensitive invalid value');
    const invalid = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store,
    });
    expect(invalid).toMatchObject({ valid: false, failedStage: 'control' });
    expect(JSON.stringify(invalid)).not.toContain('sensitive invalid value');
  });

  it('fails before scanning unless the circuit is exactly locked', async () => {
    const store = setupStore();
    await store.set(`${prefix}recovery-circuit`, { state: 'replaying', changedAt: finishedAt });
    store.set.mockClear();
    const result = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store,
    });
    expect(result).toMatchObject({ valid: false, failedStage: 'control', checks: { locked: false } });
    expect(store.scan).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('rejects transient, unknown, plaintext, and swapped durable records without leakage', async () => {
    const transient = setupStore();
    await seedCompletedReplay(transient);
    transient.values.set(`${prefix}worker-lease:${replayOperationId}`, 'sensitive lease');
    const transientResult = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store: transient,
    });
    expect(transientResult).toMatchObject({ valid: false, failedStage: 'key_shape' });
    expect(JSON.stringify(transientResult)).not.toContain('sensitive lease');

    const plaintext = setupStore();
    await seedCompletedReplay(plaintext);
    const appliedKey = [...plaintext.values.keys()].find((key) => key.startsWith(`${prefix}applied:`))!;
    plaintext.values.set(appliedKey, 'email=secret@example.test');
    const plainResult = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store: plaintext,
    });
    expect(plainResult).toMatchObject({ valid: false, failedStage: 'encrypted_envelope' });
    expect(JSON.stringify(plainResult)).not.toContain('secret@example.test');

    const swapped = setupStore();
    await seedCompletedReplay(swapped);
    const intentKeys = [...swapped.values.keys()].filter((key) => key.startsWith(`${prefix}intent:`));
    const first = swapped.values.get(intentKeys[0]);
    swapped.values.set(intentKeys[0], swapped.values.get(intentKeys[1]));
    swapped.values.set(intentKeys[1], first);
    expect(await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store: swapped,
    })).toMatchObject({ valid: false, failedStage: 'encrypted_envelope' });
  });

  it('rejects bounded-scan and current replay linkage drift with fixed output', async () => {
    const store = setupStore();
    await seedCompletedReplay(store);
    store.scan.mockImplementation(async (cursor: string | number) => [String(Number(cursor) + 1), []]);
    const capped = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store,
    });
    expect(capped).toMatchObject({ valid: false, failedStage: 'registry_scan', checks: { withinBounds: false } });
    expect(store.scan).toHaveBeenCalledTimes(100);

    const oversized = setupStore();
    await oversized.set(`${prefix}recovery-circuit`, { state: 'locked', changedAt: finishedAt });
    oversized.scan.mockResolvedValue(['0', Array.from({ length: 1_001 }, (_, index) =>
      `${prefix}intent:00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`)]);
    expect(await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store: oversized,
    })).toMatchObject({ valid: false, failedStage: 'registry_scan' });

    const exception = setupStore();
    await exception.set(`${prefix}recovery-circuit`, { state: 'locked', changedAt: finishedAt });
    exception.scan.mockRejectedValue(new Error('sensitive Upstash URL and token'));
    const exceptionResult = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId, replayOperationId, expectedIntentCount: 2, store: exception,
    });
    expect(exceptionResult).toMatchObject({ valid: false, failedStage: 'registry_scan' });
    expect(JSON.stringify(exceptionResult)).not.toContain('sensitive Upstash URL and token');

    const drift = setupStore();
    await seedCompletedReplay(drift);
    const result = await auditPrivacyDeletionRegistryAfterReplay({
      cycleId, backfillOperationId,
      replayOperationId: '77777777-7777-4777-8777-777777777777',
      expectedIntentCount: 2, store: drift,
    });
    expect(result).toMatchObject({ valid: false, failedStage: 'record_linkage', checks: { terminalReplay: false } });
    expect(JSON.stringify(result)).not.toMatch(/3dc07b21|55c07b21|screenedLeadId/i);
  });
});
