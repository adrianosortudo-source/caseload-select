/** Durable, bounded coordinators for restore replay and historical backfill. */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { supabaseAdmin } from './supabase-admin';
import {
  decryptRegistryRecord,
  diagnosePrivacyRegistryStorage,
  isPrivacyDeletionRegistryEnabled,
  loadRegistryIntentProgress,
  loadRegistryOperationState,
  registerBackfillSeal,
  registerBackfillSealIfLease,
  registerDeletionIntent,
  registerReplayRun,
  registerReplayRunIfLease,
  saveRegistryIntentProgress,
  saveRegistryIntentProgressIfLease,
  saveRegistryIntentOutcome,
  saveRegistryOperationState,
  saveRegistryOperationStateIfLease,
  type RegistryIntent,
  type RegistryOperation,
  type RegistryOperationState,
  type RegistryStore,
} from './privacy-deletion-registry';
import { assertPrivacyRecoveryReplaying } from './privacy-recovery-gate';
import { eraseScreenedLead } from './screened-lead-erasure';

const MAX_BATCH = 100;
const MAX_RETRIES = 3;
const MAX_SCAN_PAGE_KEYS = 10_000;
const MAX_SCAN_PAGES_PER_TAKE = 10_000;
const INTENT_KEY_PREFIX = 'privacy:deletion-registry:v2:intent:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RecoveryAggregate = Readonly<{
  scannedCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
}>;

export type PrivacyRecoveryDiagnosticStage =
  | 'control'
  | 'database_candidate_read'
  | 'redis_lease_eval'
  | 'encryption_checkpoint';

export type PrivacyRecoveryReadinessDiagnostic = Readonly<{
  ready: boolean;
  failedStage: PrivacyRecoveryDiagnosticStage | null;
  checks: Readonly<{
    control: boolean;
    databaseCandidateRead: boolean;
    redisLeaseEval: boolean;
    encryptionCheckpoint: boolean;
  }>;
}>;

function asIntent(value: unknown): RegistryIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const allowed = ['deletionRequestId', 'firmId', 'screenedLeadId', 'reason', 'recordedAt'];
  if (Object.keys(row).length !== allowed.length || Object.keys(row).some((key) => !allowed.includes(key))) return null;
  const validReason = ['subject_request', 'retention_sweep', 'internal_test_record', 'legacy_anonymization_backfill'].includes(String(row.reason));
  if (!UUID_RE.test(String(row.deletionRequestId)) || !UUID_RE.test(String(row.firmId)) ||
      !UUID_RE.test(String(row.screenedLeadId)) || !validReason || typeof row.recordedAt !== 'string' ||
      Number.isNaN(Date.parse(row.recordedAt))) return null;
  return row as unknown as RegistryIntent;
}

export interface RegistryIntentSource {
  take(limit: number): Promise<unknown[]>;
  exhausted?(): boolean;
}

export interface RegistryIntentScanStore extends RegistryStore {
  scan(cursor: number | string, options: { match: string; count: number }): Promise<[number | string, string[]]>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

type RegistryIntentReadStore = Pick<RegistryIntentScanStore, 'get' | 'scan'>;

export type RegistryScanSnapshot = Readonly<{
  cursor: string;
  started: boolean;
  exhausted: boolean;
  /** Stable deletion-request UUID suffixes, never full Redis keys. */
  bufferedKeys: string[];
}>;

/** COUNT is a hint: pages may be empty or oversized. Unconsumed and duplicate
 * keys are handled without dropping records, and cursor 0 is authoritative. */
export class RedisRegistryIntentSource implements RegistryIntentSource {
  private cursor: string;
  private scanStarted: boolean;
  private scanExhausted: boolean;
  private readonly bufferedKeys: string[];
  private readonly seenKeys: Set<string>;

  constructor(
    private readonly client: RegistryIntentReadStore = Redis.fromEnv() as unknown as RegistryIntentReadStore,
    snapshot?: Partial<RegistryScanSnapshot>,
  ) {
    this.cursor = snapshot?.cursor ?? '0';
    this.scanStarted = snapshot?.started ?? false;
    this.scanExhausted = snapshot?.exhausted ?? false;
    this.bufferedKeys = [...(snapshot?.bufferedKeys ?? [])];
    this.seenKeys = new Set(this.bufferedKeys);
  }

  exhausted(): boolean { return this.scanExhausted && this.bufferedKeys.length === 0; }

  snapshot(): RegistryScanSnapshot {
    return { cursor: this.cursor, started: this.scanStarted, exhausted: this.scanExhausted,
      bufferedKeys: [...this.bufferedKeys] };
  }

  async take(limit: number): Promise<unknown[]> {
    validateLimit(limit);
    const intents: unknown[] = [];
    let pages = 0;
    while (intents.length < limit) {
      while (this.bufferedKeys.length > 0 && intents.length < limit) {
        // Checkpoints store only the UUID suffix. The full Redis key is
        // reconstructed at read time so even the 10,000-key defensive SCAN
        // ceiling remains below the encrypted value-size cap.
        const deletionRequestId = this.bufferedKeys.shift()!;
        const key = `${INTENT_KEY_PREFIX}${deletionRequestId}`;
        try {
          const serialized = await this.client.get<unknown>(key);
          if (typeof serialized !== 'string') throw new Error('unavailable');
          intents.push(decryptRegistryRecord(serialized, 'intent', deletionRequestId));
        } catch {
          // The worker counts only a sanitized failure. Never log the key,
          // ciphertext, request id, or decryption error.
          intents.push(null);
        }
      }
      if (intents.length >= limit || this.scanExhausted) break;
      if (++pages > MAX_SCAN_PAGES_PER_TAKE) throw new Error('privacy registry scan did not converge');
      const page = await this.client.scan(this.cursor, { match: `${INTENT_KEY_PREFIX}*`, count: limit });
      if (!Array.isArray(page) || page.length !== 2 || !Array.isArray(page[1])) {
        throw new Error('privacy registry scan returned an invalid page');
      }
      const [nextCursor, keys] = page;
      if ((typeof nextCursor !== 'number' && typeof nextCursor !== 'string') || keys.length > MAX_SCAN_PAGE_KEYS) {
        throw new Error('privacy registry scan returned an invalid page');
      }
      this.scanStarted = true;
      this.cursor = String(nextCursor);
      for (const key of keys) {
        const deletionRequestId = typeof key === 'string' && key.startsWith(INTENT_KEY_PREFIX)
          ? key.slice(INTENT_KEY_PREFIX.length)
          : '';
        if (!UUID_RE.test(deletionRequestId)) {
          throw new Error('privacy registry scan returned an unexpected key');
        }
        if (!this.seenKeys.has(deletionRequestId)) {
          this.seenKeys.add(deletionRequestId);
          this.bufferedKeys.push(deletionRequestId);
        }
      }
      if (this.cursor === '0') this.scanExhausted = true;
    }
    return intents;
  }
}

type BackfillCursor = Readonly<{
  requestedAt: string | null;
  requestId: string | null;
  upperBoundRequestedAt: string;
  exhausted: boolean;
}>;

/** Authoritative tenant-scoped historical source with a stable keyset cursor. */
export class SupabaseHistoricalIntentSource implements RegistryIntentSource {
  private cursor: BackfillCursor;
  constructor(private readonly firmId: string, private readonly cycleId: string, cursor: BackfillCursor, private readonly client = supabaseAdmin) {
    this.cursor = { ...cursor };
  }
  exhausted(): boolean { return this.cursor.exhausted; }
  snapshot(): BackfillCursor { return { ...this.cursor }; }

  async take(limit: number): Promise<unknown[]> {
    validateLimit(limit);
    if (this.cursor.exhausted) return [];
    const { data, error } = await this.client.rpc('list_privacy_deletion_registry_backfill_candidates', {
      p_firm_id: this.firmId,
      p_cycle_id: this.cycleId,
      p_after_requested_at: this.cursor.requestedAt,
      p_after_request_id: this.cursor.requestId,
      p_before_or_at: this.cursor.upperBoundRequestedAt,
      p_limit: limit,
    });
    if (error) throw new Error('privacy backfill source is unavailable');
    const payload = (data ?? {}) as { ok?: boolean; candidates?: unknown };
    if (payload.ok !== true || !Array.isArray(payload.candidates) || payload.candidates.length > limit) {
      throw new Error('privacy backfill source returned an invalid batch');
    }
    const intents = payload.candidates.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
      const row = candidate as Record<string, unknown>;
      const intent = asIntent({ deletionRequestId: row.deletion_request_id, firmId: row.firm_id,
        screenedLeadId: row.screened_lead_id, reason: row.reason, recordedAt: row.recorded_at });
      return intent?.firmId === this.firmId ? intent : null;
    });
    if (intents.some((intent) => intent === null)) throw new Error('privacy backfill source returned an invalid candidate');
    const last = intents.at(-1) as RegistryIntent | undefined;
    if (last) this.cursor = { ...this.cursor, requestedAt: last.recordedAt, requestId: last.deletionRequestId };
    if (intents.length < limit) this.cursor = { ...this.cursor, exhausted: true };
    return intents;
  }
}

/** Service-only, bounded readiness check. It reads at most one already-redacted
 * historical coordinate and discards it, then uses random expiring Redis keys.
 * Only fixed stage codes are returned; raw errors and coordinates never leave. */
export async function diagnosePrivacyRecoveryReadiness(args: {
  cycleId: string;
  cycleStartedAt: string;
  firmId: string;
  source?: RegistryIntentSource;
  store?: RegistryIntentScanStore;
}): Promise<PrivacyRecoveryReadinessDiagnostic> {
  const checks = {
    control: false,
    databaseCandidateRead: false,
    redisLeaseEval: false,
    encryptionCheckpoint: false,
  };
  try {
    await assertPrivacyRecoveryReplaying();
    checks.control = true;
  } catch {
    return { ready: false, failedStage: 'control', checks };
  }
  try {
    const source = args.source ?? new SupabaseHistoricalIntentSource(args.firmId, args.cycleId, {
      requestedAt: null, requestId: null, upperBoundRequestedAt: args.cycleStartedAt, exhausted: false,
    });
    await source.take(1);
    checks.databaseCandidateRead = true;
  } catch {
    return { ready: false, failedStage: 'database_candidate_read', checks };
  }
  const storage = await diagnosePrivacyRegistryStorage(args.store);
  checks.redisLeaseEval = storage.redisLeaseEval;
  checks.encryptionCheckpoint = storage.encryptionCheckpoint;
  return { ready: storage.failedStage === null, failedStage: storage.failedStage, checks };
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) throw new Error(`limit must be between 1 and ${MAX_BATCH}`);
}

function initialState(args: { operationId: string; cycleId: string; cycleStartedAt: string; operation: RegistryOperation; firmId: string | null; now: string }): RegistryOperationState {
  return { operationId: args.operationId, cycleId: args.cycleId, operation: args.operation, firmId: args.firmId, status: 'running',
    startedAt: args.now, updatedAt: args.now, scanCursor: '0', scanStarted: false, scanExhausted: false,
    bufferedKeys: [], pendingIntents: [], dbCursorRequestedAt: null, dbCursorRequestId: null,
    dbUpperBoundRequestedAt: args.cycleStartedAt, dbExhausted: false, finalizedAt: null, scannedCount: 0,
    appliedCount: 0, skippedCount: 0, failedCount: 0 };
}

function aggregate(state: RegistryOperationState): RecoveryAggregate {
  return { scannedCount: state.scannedCount, appliedCount: state.appliedCount, skippedCount: state.skippedCount, failedCount: state.failedCount };
}

function withOutcome(state: RegistryOperationState, intent: RegistryIntent, outcome: 'applied' | 'skipped' | 'failed', now: string): RegistryOperationState {
  return { ...state, updatedAt: now,
    pendingIntents: state.pendingIntents.filter((item) => item.deletionRequestId !== intent.deletionRequestId),
    appliedCount: state.appliedCount + (outcome === 'applied' ? 1 : 0),
    skippedCount: state.skippedCount + (outcome === 'skipped' ? 1 : 0),
    failedCount: state.failedCount + (outcome === 'failed' ? 1 : 0) };
}

async function renewLease(store: RegistryIntentScanStore, leaseKey: string, leaseToken: string): Promise<void> {
  const renewed = await store.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], 60) else return 0 end",
    [leaseKey], [leaseToken],
  );
  if (Number(renewed) !== 1) throw new Error('privacy recovery worker lease was lost');
}

async function finishOperation(
  state: RegistryOperationState,
  store: RegistryIntentScanStore,
  now: string,
  leaseKey: string,
  leaseToken: string,
): Promise<RegistryOperationState> {
  if (state.pendingIntents.length !== 0 || state.scannedCount !== state.appliedCount + state.skippedCount + state.failedCount) {
    throw new Error('privacy recovery accounting is incomplete');
  }
  const failed = state.failedCount > 0;
  const finalizedAt = state.finalizedAt ?? now;
  await renewLease(store, leaseKey, leaseToken);
  if (state.finalizedAt === null) {
    state = { ...state, finalizedAt, updatedAt: finalizedAt };
    await saveRegistryOperationStateIfLease(state, store, leaseKey, leaseToken);
  }
  if (state.operation === 'replay') {
    await registerReplayRunIfLease({ replayRunId: state.operationId, startedAt: state.startedAt, finishedAt: finalizedAt,
      candidateCount: state.scannedCount, appliedCount: state.appliedCount, skippedCount: state.skippedCount,
      failedCount: state.failedCount, outcome: failed ? 'failed' : 'complete' }, store, leaseKey, leaseToken);
  } else {
    await registerBackfillSealIfLease({ backfillRunId: state.operationId, sealedAt: finalizedAt,
      sourceWindow: `through-${state.dbUpperBoundRequestedAt}`, scannedCount: state.scannedCount,
      appliedCount: state.appliedCount, skippedCount: state.skippedCount, failedCount: state.failedCount }, store, leaseKey, leaseToken);
  }
  await renewLease(store, leaseKey, leaseToken);
  if (failed) {
    const terminal: RegistryOperationState = { ...state, status: 'failed', updatedAt: finalizedAt };
    await saveRegistryOperationStateIfLease(terminal, store, leaseKey, leaseToken);
    return terminal;
  }
  let completed: RegistryOperationState = state;
  if (!failed) {
    const { data, error } = await supabaseAdmin.rpc('mark_privacy_registry_reconciliation_complete', {
      p_operation: state.operation, p_operation_id: state.operationId, p_cycle_id: state.cycleId,
      p_firm_id: state.firmId,
    });
    if (error || (data as { ok?: boolean } | null)?.ok !== true) {
      // Keep the deterministic finalized checkpoint resumable. A later call
      // retries only the DB acknowledgement and reuses identical evidence.
      await saveRegistryOperationStateIfLease(completed, store, leaseKey, leaseToken);
      return completed;
    }
  }
  completed = { ...state, status: 'complete', updatedAt: finalizedAt };
  await saveRegistryOperationStateIfLease(completed, store, leaseKey, leaseToken);
  return completed;
}

export type WorkerStepResult = RecoveryAggregate & Readonly<{ operationId: string; status: 'running' | 'complete' | 'failed'; hasMore: boolean }>;

/** Execute one resumable service-only batch without logging candidate data. */
async function runWorkerStepUnderLease(args: {
  operationId: string; cycleId: string; cycleStartedAt: string; operation: RegistryOperation; firmId?: string | null; limit?: number;
  store?: RegistryIntentScanStore; now?: () => string; maxRetries?: number;
  leaseKey?: string; leaseToken?: string;
}): Promise<WorkerStepResult> {
  if (!isPrivacyDeletionRegistryEnabled()) throw new Error('privacy deletion registry is disabled');
  if (!UUID_RE.test(args.operationId) || !UUID_RE.test(args.cycleId) || Number.isNaN(Date.parse(args.cycleStartedAt)) ||
      (args.operation === 'backfill' ? !args.firmId || !UUID_RE.test(args.firmId) : args.firmId != null)) {
    throw new Error('privacy recovery coordinate is invalid');
  }
  const limit = args.limit ?? MAX_BATCH;
  validateLimit(limit);
  const maxRetries = args.maxRetries ?? MAX_RETRIES;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 1 || maxRetries > 10) throw new Error('max retries is invalid');
  await assertPrivacyRecoveryReplaying();
  const store = args.store ?? Redis.fromEnv() as unknown as RegistryIntentScanStore;
  const clock = args.now ?? (() => new Date().toISOString());
  const firmId = args.operation === 'replay' ? null : args.firmId!;
  let state = await loadRegistryOperationState(args.operationId, store) ?? initialState({ operationId: args.operationId, cycleId: args.cycleId,
    cycleStartedAt: args.cycleStartedAt, operation: args.operation, firmId, now: clock() });
  if (state.cycleId !== args.cycleId || state.dbUpperBoundRequestedAt !== args.cycleStartedAt ||
      state.operation !== args.operation || state.firmId !== firmId) throw new Error('privacy recovery operation collision');
  if (state.status !== 'running') return { operationId: state.operationId, status: state.status, hasMore: false, ...aggregate(state) };

  if (state.pendingIntents.length === 0) {
    if (!args.leaseKey || !args.leaseToken) throw new Error('privacy recovery worker lease is unavailable');
    await renewLease(store, args.leaseKey, args.leaseToken);
    let values: unknown[];
    if (state.operation === 'replay') {
      const source = new RedisRegistryIntentSource(store, { cursor: state.scanCursor, started: state.scanStarted,
        exhausted: state.scanExhausted, bufferedKeys: state.bufferedKeys });
      values = await source.take(limit);
      const snapshot = source.snapshot();
      state = { ...state, scanCursor: snapshot.cursor, scanStarted: snapshot.started, scanExhausted: snapshot.exhausted,
        bufferedKeys: snapshot.bufferedKeys };
    } else {
      const source = new SupabaseHistoricalIntentSource(state.firmId!, state.cycleId, { requestedAt: state.dbCursorRequestedAt,
        requestId: state.dbCursorRequestId, upperBoundRequestedAt: state.dbUpperBoundRequestedAt, exhausted: state.dbExhausted });
      values = await source.take(limit);
      const snapshot = source.snapshot();
      state = { ...state, dbCursorRequestedAt: snapshot.requestedAt, dbCursorRequestId: snapshot.requestId, dbExhausted: snapshot.exhausted };
    }
    await renewLease(store, args.leaseKey, args.leaseToken);
    const intents = values.map(asIntent);
    state = { ...state, pendingIntents: intents.filter((intent): intent is RegistryIntent => intent !== null),
      scannedCount: state.scannedCount + values.length, failedCount: state.failedCount + intents.filter((intent) => intent === null).length,
      updatedAt: clock() };
    await saveRegistryOperationStateIfLease(state, store, args.leaseKey, args.leaseToken); // before any irreversible work
  }

  for (const intent of [...state.pendingIntents]) {
    if (args.leaseKey && args.leaseToken) {
      await renewLease(store, args.leaseKey, args.leaseToken);
    }
    if (state.operation === 'backfill' && intent.firmId !== state.firmId) throw new Error('privacy backfill tenant mismatch');
    const prior = await loadRegistryIntentProgress(state.operationId, intent.deletionRequestId, store);
    if (prior && (prior.status === 'applied' || prior.status === 'skipped')) {
      // A duplicate SCAN result was already accounted in this run. Remove the
      // duplicate occurrence from the unique-candidate denominator as well.
      state = { ...state, scannedCount: state.scannedCount - 1,
        pendingIntents: state.pendingIntents.filter((item) => item.deletionRequestId !== intent.deletionRequestId), updatedAt: clock() };
      await saveRegistryOperationStateIfLease(state, store, args.leaseKey!, args.leaseToken!);
      continue;
    }
    const attempts = (prior?.attempts ?? 0) + 1;
    await saveRegistryIntentProgressIfLease({ operationId: state.operationId, operation: state.operation,
      deletionRequestId: intent.deletionRequestId, status: 'pending', attempts, updatedAt: clock(), errorCode: null },
      store, args.leaseKey!, args.leaseToken!);
    let outcome: 'applied' | 'skipped' | 'failed';
    try {
      if (state.operation === 'backfill') outcome = await registerDeletionIntent(intent, store) === 'created' ? 'applied' : 'skipped';
      else {
        const result = await eraseScreenedLead({ firmId: intent.firmId, leadId: '[recovery-by-stable-id]',
          screenedLeadId: intent.screenedLeadId, reason: intent.reason, deletionRequestId: intent.deletionRequestId, recoveryReplay: true });
        outcome = result.ok ? (result.redacted_count > 0 ? 'applied' : 'skipped') : 'failed';
      }
    } catch { outcome = 'failed'; }
    if (outcome === 'failed' && attempts < maxRetries) {
      await saveRegistryIntentProgressIfLease({ operationId: state.operationId, operation: state.operation,
        deletionRequestId: intent.deletionRequestId, status: outcome, attempts, updatedAt: clock(),
        errorCode: state.operation === 'backfill' ? 'registry_write_failed' : 'redaction_failed' },
        store, args.leaseKey!, args.leaseToken!);
      state = { ...state, updatedAt: clock() };
      await saveRegistryOperationStateIfLease(state, store, args.leaseKey!, args.leaseToken!);
      return { operationId: state.operationId, status: 'running', hasMore: true, ...aggregate(state) };
    }
    state = withOutcome(state, intent, outcome, clock());
    await saveRegistryIntentOutcome({ operationId: state.operationId, operation: state.operation,
      deletionRequestId: intent.deletionRequestId, status: outcome, attempts, updatedAt: state.updatedAt,
      errorCode: outcome === 'failed' ? (state.operation === 'backfill' ? 'registry_write_failed' : 'redaction_failed') : null },
      state, store, args.leaseKey!, args.leaseToken!);
  }

  const exhausted = state.operation === 'replay' ? state.scanExhausted && state.bufferedKeys.length === 0 : state.dbExhausted;
  if (state.pendingIntents.length === 0 && exhausted) {
    if (!args.leaseKey || !args.leaseToken) throw new Error('privacy recovery worker lease is unavailable');
    state = await finishOperation(state, store, clock(), args.leaseKey, args.leaseToken);
  }
  return { operationId: state.operationId, status: state.status, hasMore: state.status === 'running', ...aggregate(state) };
}

export async function runPrivacyDeletionRegistryWorkerStep(args: {
  operationId: string; cycleId: string; cycleStartedAt: string; operation: RegistryOperation; firmId?: string | null; limit?: number;
  store?: RegistryIntentScanStore; now?: () => string; maxRetries?: number;
}): Promise<WorkerStepResult> {
  const store = args.store ?? Redis.fromEnv() as unknown as RegistryIntentScanStore;
  if (!UUID_RE.test(args.operationId)) throw new Error('privacy recovery coordinate is invalid');
  const leaseKey = `privacy:deletion-registry:v2:worker-lease:${args.operationId}`;
  const leaseToken = randomUUID();
  const acquired = await store.set(leaseKey, leaseToken, { nx: true, ex: 60 });
  if (acquired !== 'OK' && acquired !== true) throw new Error('privacy recovery operation is already running');
  try {
    return await runWorkerStepUnderLease({ ...args, store, leaseKey, leaseToken });
  } finally {
    // Compare-and-delete prevents an expired/reacquired lease from being
    // removed by the older worker. The token is ephemeral and never logged.
    await store.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      [leaseKey],
      [leaseToken],
    ).catch(() => undefined);
  }
}

/** Compatibility wrappers for focused unit callers. Production uses the durable worker. */
export async function replayDeletionRegistry(args: { source: RegistryIntentSource; limit?: number; now?: () => string }): Promise<RecoveryAggregate & { replayRunId: string }> {
  if (!isPrivacyDeletionRegistryEnabled()) throw new Error('privacy deletion registry is disabled');
  await assertPrivacyRecoveryReplaying();
  const now = args.now ?? (() => new Date().toISOString());
  const values = await args.source.take(args.limit ?? MAX_BATCH);
  const result = { scannedCount: values.length, appliedCount: 0, skippedCount: 0, failedCount: 0 };
  for (const value of values) {
    const intent = asIntent(value);
    if (!intent) { result.failedCount += 1; continue; }
    try {
      const outcome = await eraseScreenedLead({ firmId: intent.firmId, leadId: '[recovery-by-stable-id]', screenedLeadId: intent.screenedLeadId,
        reason: intent.reason, deletionRequestId: intent.deletionRequestId, recoveryReplay: true });
      if (!outcome.ok) result.failedCount += 1; else if (outcome.redacted_count > 0) result.appliedCount += 1; else result.skippedCount += 1;
    } catch { result.failedCount += 1; }
  }
  const replayRunId = randomUUID();
  await registerReplayRun({ replayRunId, startedAt: now(), finishedAt: now(), candidateCount: result.scannedCount,
    appliedCount: result.appliedCount, skippedCount: result.skippedCount, failedCount: result.failedCount,
    outcome: result.failedCount ? 'failed' : 'complete' });
  return { replayRunId, ...result };
}

export async function backfillDeletionRegistry(args: { source: RegistryIntentSource; sourceWindow: string; limit?: number; now?: () => string }): Promise<RecoveryAggregate & { backfillRunId: string }> {
  if (!isPrivacyDeletionRegistryEnabled()) throw new Error('privacy deletion registry is disabled');
  await assertPrivacyRecoveryReplaying();
  const now = args.now ?? (() => new Date().toISOString());
  const values = await args.source.take(args.limit ?? MAX_BATCH);
  const result = { scannedCount: values.length, appliedCount: 0, skippedCount: 0, failedCount: 0 };
  for (const value of values) {
    const intent = asIntent(value);
    if (!intent) { result.failedCount += 1; continue; }
    try { (await registerDeletionIntent(intent)) === 'created' ? result.appliedCount += 1 : result.skippedCount += 1; } catch { result.failedCount += 1; }
  }
  const backfillRunId = randomUUID();
  await registerBackfillSeal({ backfillRunId, sealedAt: now(), sourceWindow: args.sourceWindow, ...result });
  return { backfillRunId, ...result };
}
