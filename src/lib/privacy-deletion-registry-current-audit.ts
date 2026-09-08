/** Locked, read-only aggregate audit for the durable registry after replay. */
import 'server-only';
import { Redis } from '@upstash/redis';
import {
  decryptRegistryRecord,
  type RegistryAppliedReceipt,
  type RegistryBackfillSeal,
  type RegistryIntent,
  type RegistryIntentProgress,
  type RegistryOperationState,
  type RegistryRecordKind,
  type RegistryReplayRun,
} from './privacy-deletion-registry';

const PREFIX = 'privacy:deletion-registry:v2:';
const CIRCUIT_KEY = `${PREFIX}recovery-circuit`;
const ACTIVATION_KEY = `${PREFIX}activation`;
const MAX_SCAN_PAGES = 100;
const MAX_SCAN_KEYS = 1_000;
const SCAN_COUNT = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROGRESS_ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{43})$/i;

export interface PrivacyRegistryCurrentAuditStore {
  get<T>(key: string): Promise<T | null>;
  scan(cursor: number | string, options: { match: string; count: number }): Promise<[number | string, string[]]>;
}

export type PrivacyRegistryCurrentAuditStage =
  | 'control'
  | 'registry_scan'
  | 'key_shape'
  | 'encrypted_envelope'
  | 'record_linkage';

export type PrivacyRegistryCurrentAuditResult = Readonly<{
  valid: boolean;
  failedStage: PrivacyRegistryCurrentAuditStage | null;
  counts: Readonly<{
    recordCount: number;
    firmCount: number;
    intentCount: number;
    appliedReceiptCount: number;
    backfillSealCount: number;
    replayRunCount: number;
    operationStateCount: number;
    intentProgressCount: number;
  }>;
  checks: Readonly<{
    locked: boolean;
    withinBounds: boolean;
    knownKeyShapes: boolean;
    activationMarkerValid: boolean;
    activationMarkerPresent: boolean;
    encryptedEnvelopes: boolean;
    noPlaintextDirectIdentifiers: boolean;
    receiptsLinked: boolean;
    terminalBackfill: boolean;
    terminalReplay: boolean;
    cycleLinked: boolean;
    evidenceLinked: boolean;
    accountingLinked: boolean;
  }>;
}>;

type CurrentChecks = {
  -readonly [Key in keyof PrivacyRegistryCurrentAuditResult['checks']]: PrivacyRegistryCurrentAuditResult['checks'][Key];
};

type EncryptedRecord = Readonly<{ key: string; kind: RegistryRecordKind; id: string }>;

function emptyCounts(): PrivacyRegistryCurrentAuditResult['counts'] {
  return { recordCount: 0, firmCount: 0, intentCount: 0, appliedReceiptCount: 0,
    backfillSealCount: 0, replayRunCount: 0, operationStateCount: 0, intentProgressCount: 0 };
}

function freshChecks(): CurrentChecks {
  return { locked: false, withinBounds: false, knownKeyShapes: false,
    activationMarkerValid: false, activationMarkerPresent: false, encryptedEnvelopes: false,
    noPlaintextDirectIdentifiers: false, receiptsLinked: false, terminalBackfill: false,
    terminalReplay: false, cycleLinked: false, evidenceLinked: false, accountingLinked: false };
}

function failure(
  stage: PrivacyRegistryCurrentAuditStage,
  checks: CurrentChecks,
): PrivacyRegistryCurrentAuditResult {
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

function classifyKey(key: string): EncryptedRecord | 'circuit' | 'activation' | null {
  if (key === CIRCUIT_KEY) return 'circuit';
  if (key === ACTIVATION_KEY) return 'activation';
  if (!key.startsWith(PREFIX)) return null;
  const suffix = key.slice(PREFIX.length);
  for (const kind of ['intent', 'applied', 'backfill-seal', 'replay-run', 'operation-state'] as const) {
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
  // Leases and diagnostics are transient and must not remain while locked.
  return null;
}

function terminalState(state: RegistryOperationState): boolean {
  const exhausted = state.operation === 'replay'
    ? state.scanExhausted && state.scanCursor === '0' && state.bufferedKeys.length === 0
    : state.dbExhausted;
  return (state.status === 'complete' || state.status === 'failed') && state.finalizedAt !== null && exhausted &&
    state.pendingIntents.length === 0 &&
    state.scannedCount === state.appliedCount + state.skippedCount + state.failedCount;
}

function evidenceMatchesState(
  state: RegistryOperationState,
  seals: readonly RegistryBackfillSeal[],
  runs: readonly RegistryReplayRun[],
): boolean {
  if (!terminalState(state)) return false;
  if (state.operation === 'backfill') {
    const seal = seals.find((item) => item.backfillRunId === state.operationId);
    return Boolean(seal && seal.sourceWindow === `through-${state.dbUpperBoundRequestedAt}` &&
      seal.scannedCount === state.scannedCount && seal.appliedCount === state.appliedCount &&
      seal.skippedCount === state.skippedCount && seal.failedCount === state.failedCount);
  }
  const run = runs.find((item) => item.replayRunId === state.operationId);
  return Boolean(run && run.finishedAt === state.finalizedAt && run.candidateCount === state.scannedCount &&
    run.appliedCount === state.appliedCount && run.skippedCount === state.skippedCount &&
    run.failedCount === state.failedCount && run.outcome === (state.status === 'complete' ? 'complete' : 'failed'));
}

/**
 * Audit the complete durable namespace after an initial replay. The store type
 * exposes only GET and SCAN, and every failure collapses to fixed aggregate
 * output. No key, coordinate, ciphertext, decrypted record, or raw exception
 * is returned to the caller.
 */
export async function auditPrivacyDeletionRegistryAfterReplay(args: {
  cycleId: string;
  backfillOperationId: string;
  replayOperationId: string;
  expectedIntentCount: number;
  store?: PrivacyRegistryCurrentAuditStore;
}): Promise<PrivacyRegistryCurrentAuditResult> {
  const checks = freshChecks();
  let store: PrivacyRegistryCurrentAuditStore;
  try {
    store = args.store ?? Redis.fromEnv() as unknown as PrivacyRegistryCurrentAuditStore;
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
    if (classified !== 'circuit' && classified !== 'activation') records.push(classified);
  }
  if (!keys.has(CIRCUIT_KEY)) return failure('key_shape', checks);
  checks.knownKeyShapes = true;

  try {
    const activation = await store.get<unknown>(ACTIVATION_KEY);
    checks.activationMarkerPresent = keys.has(ACTIVATION_KEY);
    checks.activationMarkerValid = checks.activationMarkerPresent ? activation === 'v1' : activation === null;
    if (!checks.activationMarkerValid) return failure('control', checks);
  } catch {
    return failure('control', checks);
  }

  const intents: RegistryIntent[] = [];
  const receipts: RegistryAppliedReceipt[] = [];
  const seals: RegistryBackfillSeal[] = [];
  const runs: RegistryReplayRun[] = [];
  const states: RegistryOperationState[] = [];
  const progress: RegistryIntentProgress[] = [];
  try {
    for (const record of records) {
      const serialized = await store.get<unknown>(record.key);
      if (typeof serialized !== 'string' || !serialized.startsWith('enc-v2:')) {
        return failure('encrypted_envelope', checks);
      }
      if (record.kind === 'intent') intents.push(decryptRegistryRecord(serialized, 'intent', record.id));
      else if (record.kind === 'applied') receipts.push(decryptRegistryRecord(serialized, 'applied', record.id));
      else if (record.kind === 'backfill-seal') seals.push(decryptRegistryRecord(serialized, 'backfill-seal', record.id));
      else if (record.kind === 'replay-run') runs.push(decryptRegistryRecord(serialized, 'replay-run', record.id));
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
    appliedReceiptCount: receipts.length,
    backfillSealCount: seals.length,
    replayRunCount: runs.length,
    operationStateCount: states.length,
    intentProgressCount: progress.length,
  };
  const intentIds = new Set(intents.map((intent) => intent.deletionRequestId));
  const receiptIds = new Set(receipts.map((receipt) => receipt.deletionRequestId));
  checks.receiptsLinked = counts.intentCount === args.expectedIntentCount &&
    counts.appliedReceiptCount === args.expectedIntentCount && intentIds.size === args.expectedIntentCount &&
    receiptIds.size === args.expectedIntentCount && [...intentIds].every((id) => receiptIds.has(id));

  const backfillState = states.find((state) => state.operationId === args.backfillOperationId);
  const replayState = states.find((state) => state.operationId === args.replayOperationId);
  checks.terminalBackfill = Boolean(backfillState && backfillState.operation === 'backfill' &&
    backfillState.firmId !== null && backfillState.status === 'complete' && backfillState.failedCount === 0 &&
    terminalState(backfillState));
  checks.terminalReplay = Boolean(replayState && replayState.operation === 'replay' && replayState.firmId === null &&
    replayState.status === 'complete' && replayState.failedCount === 0 && replayState.scannedCount === args.expectedIntentCount &&
    terminalState(replayState));
  checks.cycleLinked = Boolean(backfillState && replayState &&
    backfillState.cycleId === args.cycleId && replayState.cycleId === args.cycleId);

  const stateIds = new Set(states.map((state) => state.operationId));
  const progressLinked = progress.every((item) => {
    const state = states.find((candidate) => candidate.operationId === item.operationId);
    return stateIds.has(item.operationId) && state?.operation === item.operation && intentIds.has(item.deletionRequestId);
  });
  checks.evidenceLinked = progressLinked &&
    runs.every((run) => {
      const state = states.find((item) => item.operationId === run.replayRunId);
      return Boolean(state && state.operation === 'replay' && evidenceMatchesState(state, seals, runs));
    }) && seals.every((seal) => {
      const state = states.find((item) => item.operationId === seal.backfillRunId);
      return Boolean(state && state.operation === 'backfill' && evidenceMatchesState(state, seals, runs));
    }) && Boolean(backfillState && replayState &&
      evidenceMatchesState(backfillState, seals, runs) && evidenceMatchesState(replayState, seals, runs));

  const replayProgress = progress.filter((item) => item.operationId === args.replayOperationId);
  const replayProgressIds = new Set(replayProgress.map((item) => item.deletionRequestId));
  const currentRun = runs.find((run) => run.replayRunId === args.replayOperationId);
  checks.accountingLinked = Boolean(replayState && currentRun && replayProgress.length === args.expectedIntentCount &&
    replayProgressIds.size === args.expectedIntentCount && replayProgress.every((item) =>
      (item.status === 'applied' || item.status === 'skipped') && item.errorCode === null) &&
    replayState.appliedCount === replayProgress.filter((item) => item.status === 'applied').length &&
    replayState.skippedCount === replayProgress.filter((item) => item.status === 'skipped').length &&
    currentRun.candidateCount === replayState.scannedCount && currentRun.appliedCount === replayState.appliedCount &&
    currentRun.skippedCount === replayState.skippedCount && currentRun.failedCount === 0 && currentRun.outcome === 'complete');

  if (!checks.receiptsLinked || !checks.terminalBackfill || !checks.terminalReplay || !checks.cycleLinked ||
      !checks.evidenceLinked || !checks.accountingLinked) return failure('record_linkage', checks);

  try {
    if (!isLockedCircuit(await store.get<unknown>(CIRCUIT_KEY))) return failure('control', checks);
  } catch {
    return failure('control', checks);
  }
  return { valid: true, failedStage: null, counts, checks };
}
