import { afterEach, describe, expect, it, vi } from 'vitest';

// `server-only` intentionally throws outside Next's compiler. The registry is
// server-only in production; this lets the Node crypto contract run in Vitest.
vi.mock('server-only', () => ({}));
import {
  decryptRegistryRecord,
  encryptRegistryRecord,
  registerBackfillSeal,
  registerDeletionIntent,
  type RegistryStore,
} from '../privacy-deletion-registry';
import { privacyRecoveryState } from '../privacy-recovery-gate';

const key = Buffer.alloc(32, 7).toString('base64');
const intent = {
  deletionRequestId: '3dc07b21-525f-4ce1-b0c5-31d2ee2c07fe',
  firmId: 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5',
  leadId: 'screened-lead-42',
  reason: 'subject_request' as const,
  recordedAt: '2026-09-03T14:00:00.000Z',
};

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

function memoryStore(): RegistryStore & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    async set(key, value, options) {
      if (options?.nx && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async get<T>(key: string) { return (values.get(key) as T | undefined) ?? null; },
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
    const envelope = JSON.parse(encrypted) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    expect(() => decryptRegistryRecord(JSON.stringify(envelope), 'intent', intent.deletionRequestId)).toThrow();
    expect(() => decryptRegistryRecord(encrypted, 'intent', 'another-request')).toThrow();
    expect(() => decryptRegistryRecord(encrypted, 'applied', intent.deletionRequestId)).toThrow();
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
    await expect(registerDeletionIntent({ ...intent, leadId: 'other-lead' }, store)).rejects.toThrow('collision');
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
