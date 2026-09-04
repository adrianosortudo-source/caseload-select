import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assertReplaying: vi.fn(), erase: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../privacy-recovery-gate', () => ({ assertPrivacyRecoveryReplaying: mocks.assertReplaying }));
vi.mock('../screened-lead-erasure', () => ({ eraseScreenedLead: mocks.erase }));
vi.mock('../supabase-admin', () => ({ supabaseAdmin: { rpc: mocks.rpc } }));

import { decryptRegistryRecord, registerDeletionIntent, type RegistryStore } from '../privacy-deletion-registry';
import {
  diagnosePrivacyRecoveryReadiness,
  runPrivacyDeletionRegistryWorkerStep,
  type RegistryIntentScanStore,
} from '../privacy-deletion-recovery';

const encryptionKey = Buffer.alloc(32, 9).toString('base64');
const operationId = '11111111-1111-4111-8111-111111111111';
const cycleId = '22222222-2222-4222-8222-222222222222';
const cycleStartedAt = '2026-09-03T18:30:00.000Z';
const intent = {
  deletionRequestId: '3dc07b21-525f-4ce1-b0c5-31d2ee2c07fe',
  firmId: 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5',
  screenedLeadId: '44444444-4444-4444-8444-444444444444',
  reason: 'subject_request' as const,
  recordedAt: '2026-09-03T14:00:00.000Z',
};

function memoryScanStore(): RegistryIntentScanStore & RegistryStore & { values: Map<string, unknown> } {
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
    async scan() {
      return ['0', [...values.keys()].filter((key) => key.startsWith('privacy:deletion-registry:v2:intent:'))];
    },
    async eval(script, keys, args) {
      if (keys.length === 2 && script.includes("redis.call('del',KEYS[2])")) {
        if (values.get(keys[0]) !== args[0]) return 0;
        values.delete(keys[1]);
        values.delete(keys[0]);
        return 1;
      }
      if (keys.length === 3 && script.includes("redis.call('set',KEYS[3]")) {
        if (values.get(keys[0]) !== args[0]) return 0;
        values.set(keys[1], args[1]);
        values.set(keys[2], args[2]);
        return 1;
      }
      if (keys.length === 2 && script.includes("redis.call('set',KEYS[2],ARGV[2]")) {
        if (values.get(keys[0]) !== args[0]) return 0;
        if (script.includes("'NX'") && values.has(keys[1])) return 0;
        values.set(keys[1], args[1]);
        return 1;
      }
      if (values.get(keys[0]) !== args[0]) return 0;
      if (script.includes("redis.call('del'")) values.delete(keys[0]);
      return 1;
    },
  };
}

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.PRIVACY_DELETION_REGISTRY_ENABLED = 'true';
  process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = encryptionKey;
  mocks.assertReplaying.mockReset().mockResolvedValue(undefined);
  mocks.erase.mockReset().mockResolvedValue({ ok: true, redacted_count: 1 });
  mocks.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});
afterEach(() => { process.env = { ...originalEnv }; });

describe('durable privacy deletion registry worker', () => {
  it('resumes after interruption and applies a global cross-firm scan exactly once per intent', async () => {
    const store = memoryScanStore();
    const second = {
      ...intent,
      deletionRequestId: '55c07b21-525f-4ce1-b0c5-31d2ee2c07fe',
      firmId: 'f65245d9-2fb0-44ee-a41b-0bb6db2090d5',
      screenedLeadId: '55555555-5555-4555-8555-555555555555',
    };
    await registerDeletionIntent(intent, store);
    await registerDeletionIntent(second, store);

    const first = await runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, limit: 1, store,
    });
    expect(first).toMatchObject({ status: 'running', appliedCount: 1, failedCount: 0, hasMore: true });
    const checkpoint = store.values.get(`privacy:deletion-registry:v2:operation-state:${operationId}`);
    expect(typeof checkpoint).toBe('string');
    expect(() => JSON.parse(String(checkpoint))).toThrow();
    expect(decryptRegistryRecord(String(checkpoint), 'operation-state', operationId)).toMatchObject({
      operationId,
      status: 'running',
    });

    const resumed = await runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, limit: 1, store,
    });
    expect(resumed).toMatchObject({ status: 'complete', appliedCount: 2, failedCount: 0, hasMore: false });
    expect(mocks.erase).toHaveBeenCalledTimes(2);
    expect(new Set(mocks.erase.mock.calls.map(([value]) => value.firmId))).toEqual(new Set([intent.firmId, second.firmId]));
    expect(mocks.rpc).toHaveBeenCalledWith('mark_privacy_registry_reconciliation_complete', {
      p_operation: 'replay', p_operation_id: operationId, p_cycle_id: cycleId, p_firm_id: null,
    });
  });

  it('persists a failed attempt and retries it without inflating unresolved failures', async () => {
    const store = memoryScanStore();
    await registerDeletionIntent(intent, store);
    mocks.erase.mockResolvedValueOnce({ ok: false, redacted_count: 0 }).mockResolvedValueOnce({ ok: true, redacted_count: 1 });

    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, store,
    })).resolves.toMatchObject({ status: 'running', failedCount: 0, appliedCount: 0 });
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, store,
    })).resolves.toMatchObject({ status: 'complete', failedCount: 0, appliedCount: 1 });
    expect(mocks.erase).toHaveBeenCalledTimes(2);
  });

  it('fails terminally after retry exhaustion and never acknowledges database completion', async () => {
    const store = memoryScanStore();
    await registerDeletionIntent(intent, store);
    mocks.erase.mockResolvedValue({ ok: false, redacted_count: 0 });
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, maxRetries: 1, store,
    })).resolves.toMatchObject({ status: 'failed', failedCount: 1, hasMore: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a stale-cycle resume and a concurrent lease holder', async () => {
    const store = memoryScanStore();
    await runPrivacyDeletionRegistryWorkerStep({ operation: 'replay', operationId, cycleId, cycleStartedAt, store });
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId: '33333333-3333-4333-8333-333333333333', cycleStartedAt, store,
    })).rejects.toThrow('collision');

    const blockedStore = memoryScanStore();
    await blockedStore.set(`privacy:deletion-registry:v2:worker-lease:${operationId}`, 'another-worker');
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, store: blockedStore,
    })).rejects.toThrow('already running');
  });

  it('cannot commit a stale checkpoint after its lease is replaced', async () => {
    const store = memoryScanStore();
    await registerDeletionIntent(intent, store);
    mocks.erase.mockImplementationOnce(async () => {
      await store.set(`privacy:deletion-registry:v2:worker-lease:${operationId}`, 'replacement-worker');
      return { ok: true, redacted_count: 1 };
    });
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, store,
    })).rejects.toThrow(/lease|checkpoint/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('retries deterministic finalization when the database acknowledgement temporarily fails', async () => {
    const store = memoryScanStore();
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'temporary' } })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, store,
    })).resolves.toMatchObject({ status: 'running', hasMore: true, failedCount: 0 });
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, store,
    })).resolves.toMatchObject({ status: 'complete', hasMore: false, failedCount: 0 });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('marks malformed encrypted intent input failed without logging identifiers', async () => {
    const store = memoryScanStore();
    const malformedId = '77777777-7777-4777-8777-777777777777';
    store.values.set(`privacy:deletion-registry:v2:intent:${malformedId}`, 'not-ciphertext');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'replay', operationId, cycleId, cycleStartedAt, store,
    })).resolves.toMatchObject({ status: 'failed', scannedCount: 1, failedCount: 1 });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it('backfills a DB-owned tenant batch while the operational circuit remains closed', async () => {
    const store = memoryScanStore();
    mocks.rpc
      .mockResolvedValueOnce({ data: { ok: true, candidates: [{
        deletion_request_id: intent.deletionRequestId,
        firm_id: intent.firmId,
        screened_lead_id: intent.screenedLeadId,
        reason: 'legacy_anonymization_backfill',
        recorded_at: intent.recordedAt,
      }] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(runPrivacyDeletionRegistryWorkerStep({
      operation: 'backfill', operationId, cycleId, cycleStartedAt, firmId: intent.firmId, store,
    })).resolves.toMatchObject({ status: 'complete', appliedCount: 1, failedCount: 0 });
    expect(mocks.erase).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'list_privacy_deletion_registry_backfill_candidates',
      expect.objectContaining({ p_firm_id: intent.firmId, p_cycle_id: cycleId, p_before_or_at: cycleStartedAt }));
  });

  it('diagnoses the deployed control, DB-read, Redis-EVAL, and encrypted-checkpoint boundaries without retaining probes', async () => {
    const store = memoryScanStore();
    const source = { take: vi.fn().mockResolvedValue([intent]) };
    await expect(diagnosePrivacyRecoveryReadiness({
      cycleId, cycleStartedAt, firmId: intent.firmId, source, store,
    })).resolves.toEqual({
      ready: true,
      failedStage: null,
      checks: {
        control: true,
        databaseCandidateRead: true,
        redisLeaseEval: true,
        encryptionCheckpoint: true,
      },
    });
    expect(source.take).toHaveBeenCalledWith(1);
    expect([...store.values.keys()].filter((key) => key.includes('diagnostic'))).toEqual([]);
  });

  it('returns a fixed database stage without exposing a raw diagnostic exception', async () => {
    const store = memoryScanStore();
    const source = { take: vi.fn().mockRejectedValue(new Error('sensitive upstream detail')) };
    const result = await diagnosePrivacyRecoveryReadiness({
      cycleId, cycleStartedAt, firmId: intent.firmId, source, store,
    });
    expect(result).toEqual({
      ready: false,
      failedStage: 'database_candidate_read',
      checks: {
        control: true,
        databaseCandidateRead: false,
        redisLeaseEval: false,
        encryptionCheckpoint: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('sensitive upstream detail');
  });

  it('returns a fixed control stage without exposing the circuit exception', async () => {
    mocks.assertReplaying.mockRejectedValueOnce(new Error('sensitive circuit detail'));
    const result = await diagnosePrivacyRecoveryReadiness({
      cycleId, cycleStartedAt, firmId: intent.firmId,
      source: { take: vi.fn().mockResolvedValue([]) }, store: memoryScanStore(),
    });
    expect(result).toEqual({
      ready: false,
      failedStage: 'control',
      checks: {
        control: false,
        databaseCandidateRead: false,
        redisLeaseEval: false,
        encryptionCheckpoint: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('sensitive circuit detail');
  });

  it('maps a Redis exception to a fixed lease stage without leaking storage details', async () => {
    const base = memoryScanStore();
    const store = {
      ...base,
      set: vi.fn().mockRejectedValue(new Error('sensitive Redis endpoint detail')),
    };
    const result = await diagnosePrivacyRecoveryReadiness({
      cycleId, cycleStartedAt, firmId: intent.firmId,
      source: { take: vi.fn().mockResolvedValue([]) }, store,
    });
    expect(result).toMatchObject({
      ready: false,
      failedStage: 'redis_lease_eval',
      checks: { control: true, databaseCandidateRead: true, redisLeaseEval: false, encryptionCheckpoint: false },
    });
    expect(JSON.stringify(result)).not.toContain('sensitive Redis endpoint detail');
  });

  it('separates a valid Redis lease from an invalid encryption/checkpoint configuration', async () => {
    process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = 'invalid';
    const store = memoryScanStore();
    const result = await diagnosePrivacyRecoveryReadiness({
      cycleId, cycleStartedAt, firmId: intent.firmId,
      source: { take: vi.fn().mockResolvedValue([]) }, store,
    });
    expect(result).toMatchObject({
      ready: false,
      failedStage: 'encryption_checkpoint',
      checks: { control: true, databaseCandidateRead: true, redisLeaseEval: true, encryptionCheckpoint: false },
    });
    expect([...store.values.keys()].filter((key) => key.includes('diagnostic'))).toEqual([]);
  });
});
