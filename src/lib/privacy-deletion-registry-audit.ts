/** Read-only, aggregate integrity audit for a completed initial backfill. */
import 'server-only';
import { Redis } from '@upstash/redis';
import {
  decryptRegistryRecord,
  type RegistryBackfillSeal,
  type RegistryIntent,
  type RegistryIntentProgress,
  type RegistryOperationState,
} from './privacy-deletion-registry';

const PREFIX = 'privacy:deletion-registry:v2:';
const CIRCUIT_KEY = `${PREFIX}recovery-circuit`;
const MAX_SCAN_PAGES = 100;
const MAX_SCAN_KEYS = 1_000;
const SCAN_COUNT = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROGRESS_ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{43})$/i;

export interface PrivacyRegistryAuditStore {
  get<T>(key: string): Promise<T | null>;
  scan(cursor: number | string, options: { match: string; count: number }): Promise<[number | string, string[]]>;
}

export type PrivacyRegistryAuditStage =
  | 'control'
  | 'registry_scan'
  | 'key_shape'
  | 'encrypted_envelope'
  | 'record_linkage';

export type PrivacyRegistryAuditResult = Readonly<{
  valid: boolean;
  failedStage: PrivacyRegistryAuditStage | null;
  counts: Readonly<{
    recordCount: number;
    firmCount: number;
    intentCount: number;
    backfillSealCount: number;
    operationStateCount: number;
    intentProgressCount: number;
  }>;
  checks: Readonly<{
    locked: boolean;
    withinBounds: boolean;
    knownKeyShapes: boolean;
    encryptedEnvelopes: boolean;
    noPlaintextDirectIdentifiers: boolean;
    terminalOperation: boolean;
    cycleLinked: boolean;
    accountingLinked: boolean;
  }>;
}>;

type AuditChecks = {
  -readonly [Key in keyof PrivacyRegistryAuditResult['checks']]: PrivacyRegistryAuditResult['checks'][Key];
};

type EncryptedRecord = Readonly<{
  key: string;
  kind: 'intent' | 'backfill-seal' | 'operation-state' | 'intent-progress';
  id: string;
}>;

function emptyCounts(): PrivacyRegistryAuditResult['counts'] {
  return { recordCount: 0, firmCount: 0, intentCount: 0, backfillSealCount: 0,
    operationStateCount: 0, intentProgressCount: 0 };
}

function freshChecks(): AuditChecks {
  return { locked: false, withinBounds: false, knownKeyShapes: false,
    encryptedEnvelopes: false, noPlaintextDirectIdentifiers: false,
    terminalOperation: false, cycleLinked: false, accountingLinked: false };
}

function failure(
  stage: PrivacyRegistryAuditStage,
  checks: AuditChecks,
): PrivacyRegistryAuditResult {
  return { valid: false, failedStage: stage, counts: emptyCounts(), checks: { ...checks } };
}

function isLockedCircuit(value: unknown): boolean {
  if (typeof value === 'string') {
    try { return isLockedCircuit(JSON.parse(value)); } catch { return false; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 2 && Object.keys(row).every((key) => key === 'state' || key === 'changedAt') &&
    row.state === 'locked' && typeof row.changedAt === 'string' && !Number.isNaN(Date.parse(row.changedAt));
}

function classifyKey(key: string): EncryptedRecord | 'control' | null {
  if (key === CIRCUIT_KEY) return 'control';
  if (!key.startsWith(PREFIX)) return null;
  const suffix = key.slice(PREFIX.length);
  for (const kind of ['intent', 'backfill-seal', 'operation-state'] as const) {
    const marker = `${kind}:`;
    if (suffix.startsWith(marker)) {
      const id = suffix.slice(marker.length);
      return UUID_RE.test(id) ? { key, kind, id } : null;
    }
  }
  const progressMarker = 'intent-progress:';
  if (suffix.startsWith(progressMarker)) {
    const id = suffix.slice(progressMarker.length);
    return PROGRESS_ID_RE.test(id) ? { key, kind: 'intent-progress', id } : null;
  }
  // Activation, replay, applied receipts, leases, diagnostics, and any future
  // namespace are outside this initial-backfill proof and fail closed.
  return null;
}

function terminalBackfillState(value: RegistryOperationState, operationId: string, cycleId: string): boolean {
  return value.operationId === operationId && value.cycleId === cycleId && value.operation === 'backfill' &&
    value.firmId !== null && value.status === 'complete' && value.finalizedAt !== null && value.dbExhausted &&
    value.pendingIntents.length === 0 && value.bufferedKeys.length === 0 && value.failedCount === 0 &&
    value.scannedCount === value.appliedCount + value.skippedCount;
}

/**
 * Audit only the locked initial-backfill registry. The store interface exposes
 * GET and SCAN only, so this helper cannot mutate Redis even accidentally.
 * All exceptions collapse to fixed stage codes and no key/value/coordinate is
 * returned to the caller.
 */
export async function auditPrivacyDeletionRegistry(args: {
  cycleId: string;
  operationId: string;
  expectedIntentCount: number;
  store?: PrivacyRegistryAuditStore;
}): Promise<PrivacyRegistryAuditResult> {
  const checks = freshChecks();
  let store: PrivacyRegistryAuditStore;
  try {
    store = args.store ?? Redis.fromEnv() as unknown as PrivacyRegistryAuditStore;
    if (!isLockedCircuit(await store.get<unknown>(CIRCUIT_KEY))) return failure('control', checks);
    checks.locked = true;
  } catch {
    return failure('control', checks);
  }

  const keys = new Set<string>();
  let cursor = '0';
  let pages = 0;
  let scannedEntries = 0;
  try {
    do {
      if (++pages > MAX_SCAN_PAGES) return failure('registry_scan', checks);
      const page = await store.scan(cursor, { match: `${PREFIX}*`, count: SCAN_COUNT });
      if (!Array.isArray(page) || page.length !== 2 ||
          (typeof page[0] !== 'number' && typeof page[0] !== 'string') || !Array.isArray(page[1]) ||
          page[1].some((key) => typeof key !== 'string')) return failure('registry_scan', checks);
      scannedEntries += page[1].length;
      if (scannedEntries > MAX_SCAN_KEYS) return failure('registry_scan', checks);
      for (const key of page[1]) keys.add(key);
      cursor = String(page[0]);
    } while (cursor !== '0');
    checks.withinBounds = true;
  } catch {
    return failure('registry_scan', checks);
  }

  const records: EncryptedRecord[] = [];
  for (const key of keys) {
    const classified = classifyKey(key);
    if (classified === null) return failure('key_shape', checks);
    if (classified !== 'control') records.push(classified);
  }
  if (!keys.has(CIRCUIT_KEY)) return failure('key_shape', checks);
  checks.knownKeyShapes = true;

  const intents: RegistryIntent[] = [];
  const seals: RegistryBackfillSeal[] = [];
  const states: RegistryOperationState[] = [];
  const progress: RegistryIntentProgress[] = [];
  try {
    for (const record of records) {
      const serialized = await store.get<unknown>(record.key);
      if (typeof serialized !== 'string' || !serialized.startsWith('enc-v2:')) {
        return failure('encrypted_envelope', checks);
      }
      if (record.kind === 'intent') intents.push(decryptRegistryRecord(serialized, 'intent', record.id));
      else if (record.kind === 'backfill-seal') seals.push(decryptRegistryRecord(serialized, 'backfill-seal', record.id));
      else if (record.kind === 'operation-state') states.push(decryptRegistryRecord(serialized, 'operation-state', record.id));
      else progress.push(decryptRegistryRecord(serialized, 'intent-progress', record.id));
    }
    checks.encryptedEnvelopes = true;
    checks.noPlaintextDirectIdentifiers = true;
  } catch {
    return failure('encrypted_envelope', checks);
  }

  const counts = {
    recordCount: records.length,
    firmCount: new Set(intents.map((intent) => intent.firmId)).size,
    intentCount: intents.length,
    backfillSealCount: seals.length,
    operationStateCount: states.length,
    intentProgressCount: progress.length,
  };
  const state = states.length === 1 ? states[0] : null;
  const seal = seals.length === 1 ? seals[0] : null;
  checks.terminalOperation = state !== null && terminalBackfillState(state, args.operationId, args.cycleId);
  if (!checks.terminalOperation || !state || !seal || counts.intentCount !== args.expectedIntentCount ||
      counts.firmCount !== 1 || counts.intentProgressCount !== args.expectedIntentCount) {
    return failure('record_linkage', checks);
  }

  const intentIds = new Set(intents.map((intent) => intent.deletionRequestId));
  const progressIds = new Set(progress.map((item) => item.deletionRequestId));
  const firmLinked = intents.every((intent) => intent.firmId === state.firmId &&
    Date.parse(intent.recordedAt) <= Date.parse(state.dbUpperBoundRequestedAt));
  const progressLinked = progress.every((item) => item.operationId === args.operationId && item.operation === 'backfill' &&
    (item.status === 'applied' || item.status === 'skipped') && item.errorCode === null && intentIds.has(item.deletionRequestId));
  checks.cycleLinked = seal.backfillRunId === args.operationId && firmLinked && progressLinked &&
    intentIds.size === args.expectedIntentCount && progressIds.size === args.expectedIntentCount &&
    [...intentIds].every((id) => progressIds.has(id));

  const appliedProgress = progress.filter((item) => item.status === 'applied').length;
  const skippedProgress = progress.filter((item) => item.status === 'skipped').length;
  checks.accountingLinked = state.scannedCount === args.expectedIntentCount &&
    state.appliedCount === appliedProgress && state.skippedCount === skippedProgress &&
    seal.scannedCount === state.scannedCount && seal.appliedCount === state.appliedCount &&
    seal.skippedCount === state.skippedCount && seal.failedCount === 0 &&
    seal.sourceWindow === `through-${state.dbUpperBoundRequestedAt}`;
  if (!checks.cycleLinked || !checks.accountingLinked) return failure('record_linkage', checks);

  try {
    if (!isLockedCircuit(await store.get<unknown>(CIRCUIT_KEY))) return failure('control', checks);
  } catch {
    return failure('control', checks);
  }

  return { valid: true, failedStage: null, counts, checks };
}
