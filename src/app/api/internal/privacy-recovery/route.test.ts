import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), setCircuit: vi.fn(), loadState: vi.fn(), runWorker: vi.fn(), diagnose: vi.fn(),
  auditRegistry: vi.fn(), isActivated: vi.fn(), markActivated: vi.fn(),
}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock('@/lib/privacy-recovery-gate', () => ({ setPrivacyRecoveryCircuit: mocks.setCircuit }));
vi.mock('@/lib/privacy-deletion-registry', () => ({
  loadRegistryOperationState: mocks.loadState,
  isPrivacyDeletionRegistryActivated: mocks.isActivated,
  markPrivacyDeletionRegistryActivated: mocks.markActivated,
}));
vi.mock('@/lib/privacy-deletion-recovery', () => ({
  runPrivacyDeletionRegistryWorkerStep: mocks.runWorker,
  diagnosePrivacyRecoveryReadiness: mocks.diagnose,
}));
vi.mock('@/lib/privacy-deletion-registry-audit', () => ({
  auditPrivacyDeletionRegistry: mocks.auditRegistry,
}));

import { POST } from './route';

const operationId = '11111111-1111-4111-8111-111111111111';
const cycleId = '22222222-2222-4222-8222-222222222222';
const cycleStartedAt = '2026-09-03T18:30:00.000Z';

function request(body: unknown, token = 'test-token'): NextRequest {
  return new NextRequest('https://example.test/api/internal/privacy-recovery', {
    method: 'POST', headers: { 'x-privacy-recovery-token': token }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.PRIVACY_RECOVERY_CONTROL_TOKEN = 'test-token';
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.setCircuit.mockResolvedValue(undefined);
  mocks.isActivated.mockResolvedValue(false);
  mocks.markActivated.mockResolvedValue(undefined);
  mocks.diagnose.mockResolvedValue({ ready: true, failedStage: null, checks: {
    control: true, databaseCandidateRead: true, redisLeaseEval: true, encryptionCheckpoint: true,
  } });
  mocks.auditRegistry.mockResolvedValue({ valid: true, failedStage: null,
    counts: { recordCount: 6, firmCount: 1, intentCount: 2, backfillSealCount: 1,
      operationStateCount: 1, intentProgressCount: 2 },
    checks: { locked: true, withinBounds: true, knownKeyShapes: true, encryptedEnvelopes: true,
      noPlaintextDirectIdentifiers: true, terminalOperation: true, cycleLinked: true, accountingLinked: true },
  });
});

describe('privacy recovery control route', () => {
  it('hides the service endpoint from unauthorized callers', async () => {
    const response = await POST(request({ action: 'lock' }, 'wrong-token'));
    expect(response.status).toBe(404);
    expect(mocks.setCircuit).not.toHaveBeenCalled();
  });

  it('rejects extra JSON payload fields before a circuit or database mutation', async () => {
    const response = await POST(request({ action: 'lock', extra: true }));
    expect(response.status).toBe(400);
    expect(mocks.setCircuit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns the database cycle and frozen start time when reconciliation begins', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, cycle_id: cycleId, cycle_started_at: cycleStartedAt }, error: null });
    const response = await POST(request({ action: 'begin', operation: 'replay' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ cycleId, cycleStartedAt, operation: 'replay' });
  });

  it('cannot begin first replay when the database reports incomplete historical seeding', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, error: 'initial registry backfill is incomplete' }, error: null });
    const response = await POST(request({ action: 'begin', operation: 'replay' }));
    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledWith('begin_privacy_registry_reconciliation', {
      p_operation: 'replay', p_registry_activated: false,
    });
    expect(mocks.markActivated).not.toHaveBeenCalled();
  });

  it('rejects historical backfill after the external registry has been activated', async () => {
    mocks.isActivated.mockResolvedValue(true);
    const response = await POST(request({ action: 'begin', operation: 'backfill' }));
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.setCircuit).not.toHaveBeenCalled();
  });

  it('discovers every eligible historical firm through a cycle-bound keyset page', async () => {
    const firmId = 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5';
    mocks.rpc.mockResolvedValue({ data: { ok: true, firm_ids: [firmId], exhausted: true }, error: null });
    const response = await POST(request({ action: 'listBackfillFirms', cycleId, limit: 100 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, firmIds: [firmId], exhausted: true });
    expect(mocks.rpc).toHaveBeenCalledWith('list_privacy_deletion_registry_backfill_firms', {
      p_cycle_id: cycleId, p_after_firm_id: null, p_limit: 100,
    });
  });

  it('binds worker execution to the cycle and clearly reports terminal failure', async () => {
    mocks.runWorker.mockResolvedValue({ status: 'failed', hasMore: false, scannedCount: 1,
      appliedCount: 0, skippedCount: 0, failedCount: 1 });
    const response = await POST(request({ action: 'run', operation: 'replay', operationId, cycleId, cycleStartedAt }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, status: 'failed', failedCount: 1 });
    expect(mocks.runWorker).toHaveBeenCalledWith({
      operation: 'replay', operationId, cycleId, cycleStartedAt, firmId: null, limit: undefined,
    });
  });

  it('returns only bounded readiness stage codes to an authorized caller', async () => {
    const firmId = 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5';
    mocks.diagnose.mockResolvedValue({ ready: false, failedStage: 'redis_lease_eval', checks: {
      control: true, databaseCandidateRead: true, redisLeaseEval: false, encryptionCheckpoint: false,
    } });
    const response = await POST(request({
      action: 'diagnose', operation: 'backfill', cycleId, cycleStartedAt, firmId,
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false, status: 'not_ready', failedStage: 'redis_lease_eval', checks: {
        authorization: true, control: true, databaseCandidateRead: true,
        redisLeaseEval: false, encryptionCheckpoint: false,
      },
    });
  });

  it('keeps the diagnostic enumeration-safe for unauthorized callers', async () => {
    const response = await POST(request({
      action: 'diagnose', operation: 'backfill', cycleId, cycleStartedAt,
      firmId: 'e65245d9-2fb0-44ee-a41b-0bb6db2090d5',
    }, 'wrong-token'));
    expect(response.status).toBe(404);
    expect(mocks.diagnose).not.toHaveBeenCalled();
  });

  it('returns only aggregate registry-audit counts and fixed booleans', async () => {
    const response = await POST(request({
      action: 'auditBackfillRegistry', cycleId, operationId, expectedIntentCount: 2,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true, status: 'valid', failedStage: null,
      counts: { recordCount: 6, firmCount: 1, intentCount: 2, backfillSealCount: 1,
        operationStateCount: 1, intentProgressCount: 2 },
      checks: { authorization: true, locked: true, withinBounds: true, knownKeyShapes: true,
        encryptedEnvelopes: true, noPlaintextDirectIdentifiers: true, terminalOperation: true,
        cycleLinked: true, accountingLinked: true },
    });
    expect(mocks.auditRegistry).toHaveBeenCalledWith({ cycleId, operationId, expectedIntentCount: 2 });
  });

  it('rejects wrong, extra, and unauthorized registry-audit requests without scanning', async () => {
    expect((await POST(request({ action: 'auditBackfillRegistry', cycleId, operationId }))).status).toBe(400);
    expect((await POST(request({ action: 'auditBackfillRegistry', cycleId, operationId,
      expectedIntentCount: 2, extra: true }))).status).toBe(400);
    expect((await POST(request({ action: 'auditBackfillRegistry', cycleId, operationId,
      expectedIntentCount: 2 }, 'wrong-token'))).status).toBe(404);
    expect(mocks.auditRegistry).not.toHaveBeenCalled();
  });

  it('refuses to open until the same cycle has an exhausted zero-failure global replay', async () => {
    mocks.loadState.mockResolvedValue({ operationId, cycleId, operation: 'replay', firmId: null,
      status: 'running', failedCount: 0, pendingIntents: [], scanExhausted: true, bufferedKeys: [] });
    const response = await POST(request({ action: 'open', operation: 'replay', operationId, cycleId }));
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('opens DB idempotently, persists activation, then opens the external circuit', async () => {
    const sequence: string[] = [];
    mocks.loadState.mockResolvedValue({ operationId, cycleId, operation: 'replay', firmId: null,
      status: 'complete', failedCount: 0, pendingIntents: [], scanExhausted: true, bufferedKeys: [] });
    mocks.rpc.mockImplementation(async () => { sequence.push('database'); return { data: { ok: true, state: 'open' }, error: null }; });
    mocks.markActivated.mockImplementation(async () => { sequence.push('activation'); });
    mocks.setCircuit.mockImplementation(async () => { sequence.push('circuit'); });
    const response = await POST(request({ action: 'open', operation: 'replay', operationId, cycleId }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('open_privacy_recovery', { p_cycle_id: cycleId, p_operation_id: operationId });
    expect(sequence).toEqual(['database', 'activation', 'circuit']);
  });

  it('keeps the circuit closed when activation persistence fails after DB open', async () => {
    mocks.loadState.mockResolvedValue({ operationId, cycleId, operation: 'replay', firmId: null,
      status: 'complete', failedCount: 0, pendingIntents: [], scanExhausted: true, bufferedKeys: [] });
    mocks.rpc.mockResolvedValue({ data: { ok: true, state: 'open' }, error: null });
    mocks.markActivated.mockRejectedValue(new Error('unavailable'));
    const response = await POST(request({ action: 'open', operation: 'replay', operationId, cycleId }));
    expect(response.status).toBe(503);
    expect(mocks.setCircuit).not.toHaveBeenCalledWith('open');
  });
});
