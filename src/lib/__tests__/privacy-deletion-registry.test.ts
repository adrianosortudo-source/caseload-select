import { afterEach, describe, expect, it, vi } from 'vitest';

// `server-only` intentionally throws outside Next's compiler. The registry is
// server-only in production; this lets the Node crypto contract run in Vitest.
vi.mock('server-only', () => ({}));
import {
  decryptRegistryRecord,
  encryptRegistryRecord,
  registerBackfillSeal,
  registerDeletionAppliedReceipt,
  registerDeletionIntent,
  registerDeletionIntentWhenOpen,
  isPrivacyDeletionRegistryActivated,
  markPrivacyDeletionRegistryActivated,
  type RegistryOperationState,
  type RegistryStore,
} from '../privacy-deletion-registry';
import { privacyRecoveryState } from '../privacy-recovery-gate';

const key = Buffer.alloc(32, 7).toString('base64');
const intent = {
  deletionRequestId: '3dc07b21-525f-4ce1-b0c5-31d2ee2c07fe',
  firmId: 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5',
  screenedLeadId: '44444444-4444-4444-8444-444444444444',
  reason: 'subject_request' as const,
  recordedAt: '2026-09-03T14:00:00.000Z',
};

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

function boundedUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function memoryStore(): RegistryStore & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    async set(key, value, options) {
      if (options?.nx && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async get<T>(key: string) {
      const value = values.get(key);
      if (typeof value === 'string') {
        // Match @upstash/redis's default automatic JSON deserialization.
        try { return JSON.parse(value) as T; } catch { return value as T; }
      }
      return (value as T | undefined) ?? null;
    },
  };
}

describe('privacy deletion registry crypto', () => {
  it('round trips an intent with record-kind-bound AAD', () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const encrypted = encryptRegistryRecord('intent', intent);
    expect(decryptRegistryRecord(encrypted, 'intent', intent.deletionRequestId)).toEqual(intent);
  });

  it('rejects ciphertext tampering, a wrong request ID, and a wrong record kind', () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const encrypted = encryptRegistryRecord('intent', intent);
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;
    expect(() => decryptRegistryRecord(tampered, 'intent', intent.deletionRequestId)).toThrow();
    expect(() => decryptRegistryRecord(encrypted, 'intent', 'another-request')).toThrow();
    expect(() => decryptRegistryRecord(encrypted, 'applied', intent.deletionRequestId)).toThrow();
  });

  it('survives Upstash automatic JSON deserialization for immutable retry', async () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const store = memoryStore();
    await expect(registerDeletionIntent(intent, store)).resolves.toBe('created');
    const raw = [...store.values.values()][0];
    expect(typeof raw).toBe('string');
    expect(() => JSON.parse(raw as string)).toThrow();
    await expect(registerDeletionIntent({ ...intent, recordedAt: '2026-09-03T14:01:00.000Z' }, store)).resolves.toBe('existing');
  });

  it('round trips the maximum persisted oversized-SCAN checkpoint below the storage cap', () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const maximum: RegistryOperationState = {
      operationId: boundedUuid(20_001),
      cycleId: boundedUuid(20_002),
      operation: 'replay',
      firmId: null,
      status: 'running',
      startedAt: '2026-09-03T14:00:00.000Z',
      updatedAt: '2026-09-03T14:01:00.000Z',
      scanCursor: '991',
      scanStarted: true,
      scanExhausted: false,
      // A 10,000-key SCAN page can leave 9,900 IDs buffered after a
      // 100-record worker batch; the processed 100 remain pending atomically.
      bufferedKeys: Array.from({ length: 9_900 }, (_, index) => boundedUuid(index + 1)),
      pendingIntents: Array.from({ length: 100 }, (_, index) => ({
        deletionRequestId: boundedUuid(10_001 + index),
        firmId: boundedUuid(11_001 + index),
        screenedLeadId: boundedUuid(12_001 + index),
        reason: 'subject_request' as const,
        recordedAt: '2026-09-03T14:00:00.000Z',
      })),
      dbCursorRequestedAt: null,
      dbCursorRequestId: null,
      dbUpperBoundRequestedAt: '2026-09-03T14:00:00.000Z',
      dbExhausted: false,
      finalizedAt: null,
      scannedCount: 100,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
    const encrypted = encryptRegistryRecord('operation-state', maximum);
    expect(encrypted.length).toBeLessThan(800_000);
    expect(decryptRegistryRecord(encrypted, 'operation-state', maximum.operationId)).toEqual(maximum);
  });

  it('rejects extra payload keys even when the envelope authenticates', () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    expect(() => encryptRegistryRecord('intent', { ...intent, unexpected: 'nope' } as typeof intent)).toThrow('payload is invalid');
  });

  it('uses immutable collision detection rather than replacing an existing intent', async () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const store = memoryStore();
    await expect(registerDeletionIntent(intent, store)).resolves.toBe('created');
    await expect(registerDeletionIntent(intent, store)).resolves.toBe('existing');
    await expect(registerDeletionIntent({ ...intent, screenedLeadId: '55555555-5555-4555-8555-555555555555' }, store)).rejects.toThrow('collision');
  });

  it('treats a retry with a fresh recordedAt timestamp as the same intent', async () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const store = memoryStore();
    await expect(registerDeletionIntent(intent, store)).resolves.toBe('created');
    await expect(registerDeletionIntent({ ...intent, recordedAt: '2026-09-03T14:01:00.000Z' }, store)).resolves.toBe('existing');
  });

  it('keeps the first applied receipt when restore replay produces a later timestamp', async () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const store = memoryStore();
    const first = {
      deletionRequestId: intent.deletionRequestId,
      redactedCount: 1,
      appliedAt: '2026-09-03T14:00:00.000Z',
    };
    await expect(registerDeletionAppliedReceipt(first, store)).resolves.toBe('created');
    const originalCiphertext = [...store.values.values()][0];

    await expect(registerDeletionAppliedReceipt({
      ...first,
      appliedAt: '2026-09-04T16:00:00.000Z',
    }, store)).resolves.toBe('existing');
    expect([...store.values.values()][0]).toBe(originalCiphertext);
    expect(decryptRegistryRecord(
      String(originalCiphertext),
      'applied',
      first.deletionRequestId,
    )).toEqual(first);
  });

  it('rejects an applied receipt retry with a different terminal result', async () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const store = memoryStore();
    const first = {
      deletionRequestId: intent.deletionRequestId,
      redactedCount: 1,
      appliedAt: '2026-09-03T14:00:00.000Z',
    };
    await registerDeletionAppliedReceipt(first, store);
    await expect(registerDeletionAppliedReceipt({
      ...first,
      redactedCount: 0,
      appliedAt: '2026-09-04T16:00:00.000Z',
    }, store)).rejects.toThrow('collision');
  });

  it('atomically refuses a normal intent when the external circuit is not open', async () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const base = memoryStore();
    const store = {
      ...base,
      async eval(_script: string, keys: string[], args: string[]) {
        const circuit = base.values.get(keys[0]) as { state?: string } | undefined;
        if (circuit?.state !== 'open') return -1;
        if (base.values.has(keys[1])) return 0;
        base.values.set(keys[1], args[0]);
        return 1;
      },
    };
    await expect(registerDeletionIntentWhenOpen(intent, store)).rejects.toThrow('circuit is closed');
    await store.set('privacy:deletion-registry:v2:recovery-circuit', { state: 'open' });
    await expect(registerDeletionIntentWhenOpen(intent, store)).resolves.toBe('created');
  });

  it('persists a one-way external activation marker', async () => {
    const store = memoryStore();
    await expect(isPrivacyDeletionRegistryActivated(store)).resolves.toBe(false);
    await markPrivacyDeletionRegistryActivated(store);
    await expect(isPrivacyDeletionRegistryActivated(store)).resolves.toBe(true);
  });

  it('adds a keyed digest to aggregate backfill evidence before sealing it', async () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = key;
    const store = memoryStore();
    await registerBackfillSeal({
      backfillRunId: 'backfill-run-1', sealedAt: '2026-09-03T14:00:00.000Z', sourceWindow: 'legacy-window',
      scannedCount: 2, appliedCount: 1, skippedCount: 1, failedCount: 0,
    }, store);
    const serialized = [...store.values.values()][0] as string;
    expect(decryptRegistryRecord(serialized, 'backfill-seal', 'backfill-run-1').evidenceDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('privacy recovery circuit', () => {
  it('is disabled by default and fails closed when enabled state is missing or malformed', async () => {
    delete process.env.PRIVACY_DELETION_REGISTRY_ENABLED;
    expect(await privacyRecoveryState()).toBe('disabled');
    process.env.PRIVACY_DELETION_REGISTRY_ENABLED = 'true';
    const store = memoryStore();
    expect(await privacyRecoveryState(store)).toBe('locked');
    await store.set('privacy:deletion-registry:v2:recovery-circuit', { state: 'open' });
    expect(await privacyRecoveryState(store)).toBe('open');
    await store.set('privacy:deletion-registry:v2:recovery-circuit', JSON.stringify({ state: 'open' }));
    expect(await privacyRecoveryState(store)).toBe('open');
    await store.set('privacy:deletion-registry:v2:recovery-circuit', { state: 'unknown' });
    expect(await privacyRecoveryState(store)).toBe('locked');
  });
});
