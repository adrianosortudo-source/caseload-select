import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  isPrivacyDeletionRegistryActivated,
  loadRegistryOperationState,
  markPrivacyDeletionRegistryActivated,
  type RegistryOperation,
} from '@/lib/privacy-deletion-registry';
import { diagnosePrivacyRecoveryReadiness, runPrivacyDeletionRegistryWorkerStep } from '@/lib/privacy-deletion-recovery';
import { auditPrivacyDeletionRegistry } from '@/lib/privacy-deletion-registry-audit';
import { auditPrivacyDeletionRegistryAfterReplay } from '@/lib/privacy-deletion-registry-current-audit';
import { setPrivacyRecoveryCircuit } from '@/lib/privacy-recovery-gate';

export const runtime = 'nodejs';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorized(request: NextRequest): boolean {
  const expected = process.env.PRIVACY_RECOVERY_CONTROL_TOKEN;
  const supplied = request.headers.get('x-privacy-recovery-token');
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function operation(value: unknown): RegistryOperation | null {
  return value === 'backfill' || value === 'replay' ? value : null;
}

/** Distinct service-only recovery control plane. It returns aggregate state
 * only and never logs/returns candidate identifiers, ciphertext, or errors. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: 'invalid recovery request' }, { status: 400 }); }

  try {
    if (body.action === 'lock' && exactKeys(body, ['action'])) {
      await setPrivacyRecoveryCircuit('locked');
      const { data, error } = await supabaseAdmin.rpc('set_privacy_recovery_state', { p_state: 'locked' });
      if (error || (data as { ok?: boolean } | null)?.ok !== true) {
        return NextResponse.json({ error: 'recovery state was not persisted' }, { status: 503 });
      }
      return NextResponse.json({ ok: true, state: 'locked' });
    }

    if (body.action === 'begin' && exactKeys(body, ['action', 'operation'])) {
      const selected = operation(body.operation);
      if (!selected) return NextResponse.json({ error: 'invalid recovery operation' }, { status: 400 });
      const registryActivated = await isPrivacyDeletionRegistryActivated();
      if (selected === 'backfill' && registryActivated) {
        return NextResponse.json({ error: 'activated registries require global replay' }, { status: 409 });
      }
      await setPrivacyRecoveryCircuit('replaying');
      const { data, error } = await supabaseAdmin.rpc('begin_privacy_registry_reconciliation', {
        p_operation: selected, p_registry_activated: registryActivated,
      });
      const started = data as { ok?: boolean; cycle_id?: unknown; cycle_started_at?: unknown } | null;
      if (error || started?.ok !== true || typeof started.cycle_id !== 'string' || !UUID_RE.test(started.cycle_id) ||
          typeof started.cycle_started_at !== 'string' || Number.isNaN(Date.parse(started.cycle_started_at))) {
        await setPrivacyRecoveryCircuit('locked').catch(() => undefined);
        return NextResponse.json({ error: 'reconciliation was not started' }, { status: 503 });
      }
      return NextResponse.json({ ok: true, state: 'replaying', operation: selected,
        cycleId: started.cycle_id, cycleStartedAt: started.cycle_started_at });
    }

    if (body.action === 'listBackfillFirms' && (
        exactKeys(body, ['action', 'cycleId']) ||
        exactKeys(body, ['action', 'cycleId', 'afterFirmId']) ||
        exactKeys(body, ['action', 'cycleId', 'limit']) ||
        exactKeys(body, ['action', 'cycleId', 'afterFirmId', 'limit']))) {
      const cycleId = typeof body.cycleId === 'string' ? body.cycleId : '';
      const afterFirmId = body.afterFirmId === undefined ? null : String(body.afterFirmId);
      const limit = body.limit === undefined ? 100 : Number(body.limit);
      if (!UUID_RE.test(cycleId) || (afterFirmId !== null && !UUID_RE.test(afterFirmId)) ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return NextResponse.json({ error: 'invalid firm discovery cursor' }, { status: 400 });
      }
      const { data, error } = await supabaseAdmin.rpc('list_privacy_deletion_registry_backfill_firms', {
        p_cycle_id: cycleId, p_after_firm_id: afterFirmId, p_limit: limit,
      });
      const result = data as { ok?: boolean; firm_ids?: unknown; exhausted?: unknown } | null;
      if (error || result?.ok !== true || !Array.isArray(result.firm_ids) || result.firm_ids.length > limit ||
          result.firm_ids.some((firmId) => typeof firmId !== 'string' || !UUID_RE.test(firmId)) ||
          typeof result.exhausted !== 'boolean') {
        return NextResponse.json({ error: 'firm discovery is unavailable' }, { status: 503 });
      }
      return NextResponse.json({ ok: true, firmIds: result.firm_ids, exhausted: result.exhausted });
    }

    if (body.action === 'diagnose' && exactKeys(body, [
      'action', 'cycleId', 'cycleStartedAt', 'firmId', 'operation',
    ])) {
      const selected = operation(body.operation);
      const cycleId = typeof body.cycleId === 'string' ? body.cycleId : '';
      const cycleStartedAt = typeof body.cycleStartedAt === 'string' ? body.cycleStartedAt : '';
      const firmId = typeof body.firmId === 'string' ? body.firmId : '';
      if (selected !== 'backfill' || !UUID_RE.test(cycleId) || Number.isNaN(Date.parse(cycleStartedAt)) ||
          !UUID_RE.test(firmId)) {
        return NextResponse.json({ error: 'invalid recovery coordinate' }, { status: 400 });
      }
      const diagnostic = await diagnosePrivacyRecoveryReadiness({ cycleId, cycleStartedAt, firmId });
      return NextResponse.json({
        ok: diagnostic.ready,
        status: diagnostic.ready ? 'ready' : 'not_ready',
        failedStage: diagnostic.failedStage,
        checks: { authorization: true, ...diagnostic.checks },
      }, { status: diagnostic.ready ? 200 : 503 });
    }

    if (body.action === 'auditBackfillRegistry' && exactKeys(body, [
      'action', 'cycleId', 'operationId', 'expectedIntentCount',
    ])) {
      const cycleId = typeof body.cycleId === 'string' ? body.cycleId : '';
      const operationId = typeof body.operationId === 'string' ? body.operationId : '';
      const expectedIntentCount = Number(body.expectedIntentCount);
      if (!UUID_RE.test(cycleId) || !UUID_RE.test(operationId) || !Number.isSafeInteger(expectedIntentCount) ||
          expectedIntentCount < 1 || expectedIntentCount > 1_000) {
        return NextResponse.json({ error: 'invalid registry audit coordinate' }, { status: 400 });
      }
      const audit = await auditPrivacyDeletionRegistry({ cycleId, operationId, expectedIntentCount });
      return NextResponse.json({
        ok: audit.valid,
        status: audit.valid ? 'valid' : 'invalid',
        failedStage: audit.failedStage,
        counts: audit.counts,
        checks: { authorization: true, ...audit.checks },
      }, { status: audit.valid ? 200 : 503 });
    }

    if (body.action === 'auditReplayedRegistry' && exactKeys(body, [
      'action', 'backfillOperationId', 'cycleId', 'expectedIntentCount', 'replayOperationId',
    ])) {
      const cycleId = typeof body.cycleId === 'string' ? body.cycleId : '';
      const backfillOperationId = typeof body.backfillOperationId === 'string' ? body.backfillOperationId : '';
      const replayOperationId = typeof body.replayOperationId === 'string' ? body.replayOperationId : '';
      const expectedIntentCount = Number(body.expectedIntentCount);
      if (!UUID_RE.test(cycleId) || !UUID_RE.test(backfillOperationId) || !UUID_RE.test(replayOperationId) ||
          backfillOperationId === replayOperationId || !Number.isSafeInteger(expectedIntentCount) ||
          expectedIntentCount < 1 || expectedIntentCount > 1_000) {
        return NextResponse.json({ error: 'invalid registry audit coordinate' }, { status: 400 });
      }
      const audit = await auditPrivacyDeletionRegistryAfterReplay({
        cycleId, backfillOperationId, replayOperationId, expectedIntentCount,
      });
      return NextResponse.json({
        ok: audit.valid,
        status: audit.valid ? 'valid' : 'invalid',
        failedStage: audit.failedStage,
        counts: audit.counts,
        checks: { authorization: true, ...audit.checks },
      }, { status: audit.valid ? 200 : 503 });
    }

    if (body.action === 'run' && (
        exactKeys(body, ['action', 'cycleId', 'cycleStartedAt', 'operation', 'operationId']) ||
        exactKeys(body, ['action', 'cycleId', 'cycleStartedAt', 'operation', 'operationId', 'limit']) ||
        exactKeys(body, ['action', 'cycleId', 'cycleStartedAt', 'operation', 'operationId', 'firmId']) ||
        exactKeys(body, ['action', 'cycleId', 'cycleStartedAt', 'operation', 'operationId', 'firmId', 'limit']))) {
      const selected = operation(body.operation);
      const operationId = typeof body.operationId === 'string' ? body.operationId : '';
      const cycleId = typeof body.cycleId === 'string' ? body.cycleId : '';
      const cycleStartedAt = typeof body.cycleStartedAt === 'string' ? body.cycleStartedAt : '';
      const firmId = typeof body.firmId === 'string' ? body.firmId : null;
      const limit = body.limit === undefined ? undefined : Number(body.limit);
      if (!selected || !UUID_RE.test(operationId) || !UUID_RE.test(cycleId) || Number.isNaN(Date.parse(cycleStartedAt)) ||
          (selected === 'backfill' ? !firmId || !UUID_RE.test(firmId) : firmId !== null) ||
          (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100))) {
        return NextResponse.json({ error: 'invalid recovery coordinate' }, { status: 400 });
      }
      const result = await runPrivacyDeletionRegistryWorkerStep({ operation: selected, operationId, cycleId, cycleStartedAt, firmId, limit });
      return NextResponse.json({ ok: result.status !== 'failed', status: result.status, hasMore: result.hasMore,
        scannedCount: result.scannedCount, appliedCount: result.appliedCount,
        skippedCount: result.skippedCount, failedCount: result.failedCount }, { status: result.status === 'failed' ? 409 : 200 });
    }

    if (body.action === 'open' && exactKeys(body, ['action', 'cycleId', 'operation', 'operationId'])) {
      const selected = operation(body.operation);
      const operationId = typeof body.operationId === 'string' ? body.operationId : '';
      const cycleId = typeof body.cycleId === 'string' ? body.cycleId : '';
      if (selected !== 'replay' || !UUID_RE.test(operationId) || !UUID_RE.test(cycleId)) {
        return NextResponse.json({ error: 'invalid recovery coordinate' }, { status: 400 });
      }
      const checkpoint = await loadRegistryOperationState(operationId);
      const sourceExhausted = checkpoint?.operation === 'replay'
        ? checkpoint.scanExhausted && checkpoint.bufferedKeys.length === 0
        : checkpoint?.dbExhausted;
      if (!checkpoint || checkpoint.cycleId !== cycleId || checkpoint.operation !== selected || checkpoint.firmId !== null ||
          checkpoint.status !== 'complete' || checkpoint.failedCount !== 0 || checkpoint.pendingIntents.length !== 0 || !sourceExhausted) {
        return NextResponse.json({ error: 'reconciliation is incomplete' }, { status: 409 });
      }
      const { data, error } = await supabaseAdmin.rpc('open_privacy_recovery', {
        p_cycle_id: cycleId, p_operation_id: operationId,
      });
      if (error || (data as { ok?: boolean } | null)?.ok !== true) {
        return NextResponse.json({ error: 'not all firms are reconciled' }, { status: 409 });
      }
      // Persist the external generation marker before opening the external
      // circuit. If this write fails, DB open is safely retryable and normal
      // traffic remains blocked.
      await markPrivacyDeletionRegistryActivated();
      await setPrivacyRecoveryCircuit('open');
      return NextResponse.json({ ok: true, state: 'open' });
    }
  } catch {
    return NextResponse.json({ error: 'recovery control is unavailable' }, { status: 503 });
  }
  return NextResponse.json({ error: 'invalid recovery request' }, { status: 400 });
}
