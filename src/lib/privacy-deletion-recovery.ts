/** Bounded, idempotent coordinators for restore replay and legacy backfill. */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import {
  decryptRegistryRecord,
  isPrivacyDeletionRegistryEnabled,
  registerDeletionIntent,
  registerBackfillSeal,
  registerReplayRun,
  type RegistryIntent,
} from './privacy-deletion-registry';
import { assertPrivacyOperationsOpen, assertPrivacyRecoveryReplaying } from './privacy-recovery-gate';
import { eraseScreenedLead, type ScreenedLeadErasureInput } from './screened-lead-erasure';

const MAX_BATCH = 100;
const INTENT_KEY_PREFIX = 'privacy:deletion-registry:v2:intent:';
const MAX_SCAN_PAGES_PER_TAKE = 4;

export type RecoveryAggregate = Readonly<{
  scannedCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
}>;

function asIntent(value: unknown): RegistryIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const allowed = ['deletionRequestId', 'firmId', 'leadId', 'reason', 'recordedAt'];
  if (Object.keys(row).length !== allowed.length || Object.keys(row).some((key) => !allowed.includes(key))) return null;
  const validReason = ['subject_request', 'retention_sweep', 'internal_test_record', 'legacy_anonymization_backfill'].includes(String(row.reason));
  if (typeof row.deletionRequestId !== 'string' || typeof row.firmId !== 'string' ||
      typeof row.leadId !== 'string' || !validReason || typeof row.recordedAt !== 'string' ||
      Number.isNaN(Date.parse(row.recordedAt))) return null;
  return row as unknown as RegistryIntent;
}

export interface RegistryIntentSource {
  /** Return decrypted v2 intent records only. The reader must not log raw values. */
  take(limit: number): Promise<unknown[]>;
}

export interface RegistryIntentScanStore {
  get<T>(key: string): Promise<T | null>;
  scan(cursor: number | string, options: { match: string; count: number }): Promise<[number | string, string[]]>;
}

/**
 * Stateful, bounded reader for the external replay source. It deliberately
 * scans only the intent namespace, reads at most `limit` encrypted values, and
 * authenticates each value against the key-derived request id before returning
 * it. Callers keep the instance for a multi-batch recovery run.
 */
export class RedisRegistryIntentSource implements RegistryIntentSource {
  private cursor: number | string = 0;
  private exhausted = false;

  constructor(private readonly client: RegistryIntentScanStore = Redis.fromEnv() as unknown as RegistryIntentScanStore) {}

  async take(limit: number): Promise<unknown[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) {
      throw new Error(`limit must be between 1 and ${MAX_BATCH}`);
    }
    if (this.exhausted) return [];

    const intents: RegistryIntent[] = [];
    for (let page = 0; page < MAX_SCAN_PAGES_PER_TAKE && intents.length < limit; page += 1) {
      const scan = await this.client.scan(this.cursor, { match: `${INTENT_KEY_PREFIX}*`, count: limit });
      if (!Array.isArray(scan) || scan.length !== 2 || !Array.isArray(scan[1])) {
        throw new Error('privacy registry scan returned an invalid page');
      }
      const [nextCursor, keys] = scan;
      if ((typeof nextCursor !== 'number' && typeof nextCursor !== 'string') || keys.length > limit) {
        throw new Error('privacy registry scan returned an invalid page');
      }
      this.cursor = nextCursor;
      for (const key of keys) {
        if (intents.length === limit) break;
        if (typeof key !== 'string' || !key.startsWith(INTENT_KEY_PREFIX)) {
          throw new Error('privacy registry scan returned an unexpected key');
        }
        const deletionRequestId = key.slice(INTENT_KEY_PREFIX.length);
        if (!deletionRequestId) throw new Error('privacy registry scan returned an invalid key');
        const serialized = await this.client.get<unknown>(key);
        if (typeof serialized !== 'string') throw new Error('privacy registry intent is unavailable');
        intents.push(decryptRegistryRecord(serialized, 'intent', deletionRequestId));
      }
      if (String(nextCursor) === '0') {
        this.exhausted = true;
        break;
      }
    }
    return intents;
  }
}

export type ExternalFirstAdapter = NonNullable<ScreenedLeadErasureInput['externalDeletion']>;

async function applyIntent(intent: RegistryIntent, externalDeletion: ExternalFirstAdapter): Promise<'applied' | 'skipped' | 'failed'> {
  const outcome = await eraseScreenedLead({
    firmId: intent.firmId,
    leadId: intent.leadId,
    reason: intent.reason,
    deletionRequestId: intent.deletionRequestId,
    externalDeletion,
    recoveryReplay: true,
  });
  if (!outcome.ok) return 'failed';
  return outcome.redacted_count > 0 ? 'applied' : 'skipped';
}

async function runBounded(source: RegistryIntentSource, externalDeletion: ExternalFirstAdapter, limit: number): Promise<RecoveryAggregate> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) throw new Error(`limit must be between 1 and ${MAX_BATCH}`);
  const values = await source.take(limit);
  if (!Array.isArray(values) || values.length > limit) throw new Error('recovery source returned an invalid batch');
  const result = { scannedCount: values.length, appliedCount: 0, skippedCount: 0, failedCount: 0 };
  for (const value of values) {
    const intent = asIntent(value);
    if (!intent) { result.failedCount += 1; continue; }
    try {
      const state = await applyIntent(intent, externalDeletion);
      if (state === 'applied') result.appliedCount += 1;
      else if (state === 'skipped') result.skippedCount += 1;
      else result.failedCount += 1;
    } catch {
      // The aggregate preserves evidence without retaining/printing subject data.
      result.failedCount += 1;
    }
  }
  return result;
}

/**
 * Replay after a restore. The caller must set the recovery state to
 * `replaying` first; replay never opens the circuit. Each original request id
 * is reused, so database and provider retry paths remain idempotent.
 */
export async function replayDeletionRegistry(args: {
  source: RegistryIntentSource;
  externalDeletion: ExternalFirstAdapter;
  limit?: number;
  now?: () => string;
}): Promise<RecoveryAggregate & { replayRunId: string }> {
  if (!isPrivacyDeletionRegistryEnabled()) throw new Error('privacy deletion registry is disabled');
  await assertPrivacyRecoveryReplaying();
  const now = args.now ?? (() => new Date().toISOString());
  const replayRunId = randomUUID();
  const result = await runBounded(args.source, args.externalDeletion, args.limit ?? MAX_BATCH);
  await registerReplayRun({
    replayRunId,
    startedAt: now(),
    finishedAt: now(),
    candidateCount: result.scannedCount,
    appliedCount: result.appliedCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    outcome: result.failedCount === 0 ? 'complete' : 'failed',
  });
  return { replayRunId, ...result };
}

/**
 * Bounded legacy enrollment. This reconciles completed historical deletion
 * requests into the replay registry only. It never invokes a provider or a
 * new local redaction: those operations would be both incorrect and unsafe
 * for an already-processed request. A seal is aggregate evidence, not a
 * replacement for each immutable subject intent.
 */
export async function backfillDeletionRegistry(args: {
  source: RegistryIntentSource;
  sourceWindow: string;
  limit?: number;
  now?: () => string;
}): Promise<RecoveryAggregate & { backfillRunId: string }> {
  if (!isPrivacyDeletionRegistryEnabled()) throw new Error('privacy deletion registry is disabled');
  await assertPrivacyOperationsOpen();
  const now = args.now ?? (() => new Date().toISOString());
  const backfillRunId = randomUUID();
  const limit = args.limit ?? MAX_BATCH;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) throw new Error(`limit must be between 1 and ${MAX_BATCH}`);
  const values = await args.source.take(limit);
  if (!Array.isArray(values) || values.length > limit) throw new Error('recovery source returned an invalid batch');
  const result = { scannedCount: values.length, appliedCount: 0, skippedCount: 0, failedCount: 0 };
  for (const value of values) {
    const intent = asIntent(value);
    if (!intent) { result.failedCount += 1; continue; }
    try {
      const enrollment = await registerDeletionIntent(intent);
      if (enrollment === 'created') result.appliedCount += 1;
      else result.skippedCount += 1;
    } catch {
      result.failedCount += 1;
    }
  }
  await registerBackfillSeal({ backfillRunId, sealedAt: now(), sourceWindow: args.sourceWindow,
    scannedCount: result.scannedCount, appliedCount: result.appliedCount,
    skippedCount: result.skippedCount, failedCount: result.failedCount });
  return { backfillRunId, ...result };
}
