/**
 * External, encrypted deletion registry.
 *
 * Redis is deliberately a replay source, not a cache. Every value has a
 * versioned, record-kind-specific payload and AES-GCM AAD binds its kind and
 * stable record id. Do not add subject text, provider selectors, email
 * addresses, telephone numbers, or message bodies here.
 */
import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';

const PREFIX = 'privacy:deletion-registry:v2:';
const ENVELOPE_VERSION = 2;
const KEY_ID = 'v1';
const ENCODED_ENVELOPE_PREFIX = 'enc-v2:';
const MAX_ENCODED_RECORD_LENGTH = 800_000;
const ACTIVATION_KEY = `${PREFIX}activation`;

export type DeletionReason =
  | 'subject_request'
  | 'retention_sweep'
  | 'internal_test_record'
  | 'legacy_anonymization_backfill';

export type RegistryIntent = Readonly<{
  deletionRequestId: string;
  firmId: string;
  /** Stable internal screened_leads.id. Never store the mutable/public lead_id. */
  screenedLeadId: string;
  reason: DeletionReason;
  recordedAt: string;
}>;

export type RegistryOperation = 'backfill' | 'replay';
export type RegistryIntentProgressStatus = 'pending' | 'applied' | 'skipped' | 'failed';

/** Mutable, encrypted checkpoint. Values may contain identifiers because the
 * complete value is ciphertext at rest; callers must never log it. */
export type RegistryOperationState = Readonly<{
  operationId: string;
  /** Recovery-cycle UUID returned by the current database begin RPC. */
  cycleId: string;
  operation: RegistryOperation;
  /** Null denotes the required global replay scan; backfill is one firm. */
  firmId: string | null;
  status: 'running' | 'complete' | 'failed';
  startedAt: string;
  updatedAt: string;
  scanCursor: string;
  scanStarted: boolean;
  scanExhausted: boolean;
  bufferedKeys: string[];
  pendingIntents: RegistryIntent[];
  dbCursorRequestedAt: string | null;
  dbCursorRequestId: string | null;
  dbUpperBoundRequestedAt: string;
  dbExhausted: boolean;
  finalizedAt: string | null;
  scannedCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
}>;

export type RegistryIntentProgress = Readonly<{
  operationId: string;
  operation: RegistryOperation;
  deletionRequestId: string;
  status: RegistryIntentProgressStatus;
  attempts: number;
  updatedAt: string;
  errorCode: 'redaction_failed' | 'registry_write_failed' | null;
}>;

export type RegistryAppliedReceipt = Readonly<{
  deletionRequestId: string;
  redactedCount: number;
  appliedAt: string;
}>;

/** Aggregate-only record: no subject IDs, paths, provider IDs, or payloads. */
export type RegistryBackfillSealInput = Readonly<{
  backfillRunId: string;
  sealedAt: string;
  sourceWindow: string;
  scannedCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
}>;
export type RegistryBackfillSeal = RegistryBackfillSealInput & Readonly<{
  /** HMAC over the aggregate evidence, so a copied ciphertext cannot be
   * re-labelled as a different run without detection after decryption. */
  evidenceDigest: string;
}>;

/** Aggregate-only recovery evidence, never a list of replayed subjects. */
export type RegistryReplayRunInput = Readonly<{
  replayRunId: string;
  startedAt: string;
  finishedAt: string | null;
  candidateCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  outcome: 'started' | 'complete' | 'failed';
}>;
export type RegistryReplayRun = RegistryReplayRunInput & Readonly<{
  evidenceDigest: string;
}>;

export type RegistryRecordByKind = {
  intent: RegistryIntent;
  applied: RegistryAppliedReceipt;
  'backfill-seal': RegistryBackfillSeal;
  'replay-run': RegistryReplayRun;
  'operation-state': RegistryOperationState;
  'intent-progress': RegistryIntentProgress;
};
export type RegistryRecordKind = keyof RegistryRecordByKind;

type Envelope = Readonly<{
  v: typeof ENVELOPE_VERSION;
  kind: RegistryRecordKind;
  kid: typeof KEY_ID;
  iv: string;
  tag: string;
  ciphertext: string;
}>;

export interface RegistryStore {
  set(key: string, value: unknown, options?: { nx?: true; ex?: number }): Promise<unknown>;
  get<T>(key: string): Promise<T | null>;
}

export interface RegistryAtomicStore extends RegistryStore {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export function isPrivacyDeletionRegistryEnabled(): boolean {
  return process.env.PRIVACY_DELETION_REGISTRY_ENABLED === 'true';
}

/** Non-personal external generation marker. Once present, historical seeding
 * cannot be selected again; every restore must use the global replay path. */
export async function isPrivacyDeletionRegistryActivated(store = defaultStore()): Promise<boolean> {
  return await store.get<unknown>(ACTIVATION_KEY) === 'v1';
}

export async function markPrivacyDeletionRegistryActivated(store = defaultStore()): Promise<void> {
  await store.set(ACTIVATION_KEY, 'v1', { nx: true });
  if (await store.get<unknown>(ACTIVATION_KEY) !== 'v1') {
    throw new Error('privacy deletion registry activation marker is unavailable');
  }
}

function encryptionKey(): Buffer {
  const encoded = process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY;
  if (!encoded) throw new Error('privacy deletion registry is not configured');
  const value = Buffer.from(encoded, 'base64');
  if (value.length !== 32 || value.toString('base64') !== encoded) {
    throw new Error('privacy deletion registry key is invalid');
  }
  return value;
}

function recordId<K extends RegistryRecordKind>(kind: K, value: RegistryRecordByKind[K]): string {
  const record = value as RegistryIntent & RegistryAppliedReceipt & RegistryBackfillSeal & RegistryReplayRun & RegistryOperationState & RegistryIntentProgress;
  switch (kind) {
    case 'intent':
    case 'applied': return record.deletionRequestId;
    case 'backfill-seal': return record.backfillRunId;
    case 'replay-run': return record.replayRunId;
    case 'operation-state': return record.operationId;
    case 'intent-progress': return `${record.operationId}:${progressIdentity(record.deletionRequestId)}`;
  }
}

function aad(kind: RegistryRecordKind, id: string): Buffer {
  return Buffer.from(`caseload-select:privacy-registry:${ENVELOPE_VERSION}:${kind}:${id}`, 'utf8');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

function isEnvelopePart(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyKeys(row: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(row);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function digestEvidence(kind: 'backfill-seal' | 'replay-run', value: RegistryBackfillSealInput | RegistryReplayRunInput): string {
  // Domain separation prevents an aggregate with coincidentally identical
  // fields from being accepted as evidence of another record kind.
  return createHmac('sha256', encryptionKey())
    .update(`caseload-select:privacy-registry:${ENVELOPE_VERSION}:${kind}:evidence:`)
    .update(JSON.stringify(value))
    .digest('base64url');
}

function validRecord<K extends RegistryRecordKind>(kind: K, value: unknown): value is RegistryRecordByKind[K] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (kind === 'intent') {
    return hasOnlyKeys(row, ['deletionRequestId', 'firmId', 'screenedLeadId', 'reason', 'recordedAt']) &&
      isUuid(row.deletionRequestId) && isUuid(row.firmId) &&
      isUuid(row.screenedLeadId) && ['subject_request', 'retention_sweep', 'internal_test_record', 'legacy_anonymization_backfill'].includes(String(row.reason)) &&
      isIsoTimestamp(row.recordedAt);
  }
  if (kind === 'applied') return hasOnlyKeys(row, ['deletionRequestId', 'redactedCount', 'appliedAt']) && isNonEmptyString(row.deletionRequestId) && validCount(row.redactedCount) && isIsoTimestamp(row.appliedAt);
  if (kind === 'backfill-seal') {
    const { evidenceDigest, ...evidence } = row;
    return hasOnlyKeys(row, ['backfillRunId', 'sealedAt', 'sourceWindow', 'scannedCount', 'appliedCount', 'skippedCount', 'failedCount', 'evidenceDigest']) &&
      isNonEmptyString(row.backfillRunId) && isIsoTimestamp(row.sealedAt) && isNonEmptyString(row.sourceWindow) && validCount(row.scannedCount) && validCount(row.appliedCount) && validCount(row.skippedCount) && validCount(row.failedCount) &&
      typeof evidenceDigest === 'string' && evidenceDigest === digestEvidence('backfill-seal', evidence as RegistryBackfillSealInput);
  }
  if (kind === 'replay-run') {
    const { evidenceDigest, ...evidence } = row;
    return hasOnlyKeys(row, ['replayRunId', 'startedAt', 'finishedAt', 'candidateCount', 'appliedCount', 'skippedCount', 'failedCount', 'outcome', 'evidenceDigest']) &&
      isNonEmptyString(row.replayRunId) && isIsoTimestamp(row.startedAt) && (row.finishedAt === null || isIsoTimestamp(row.finishedAt)) && validCount(row.candidateCount) && validCount(row.appliedCount) && validCount(row.skippedCount) && validCount(row.failedCount) && ['started', 'complete', 'failed'].includes(String(row.outcome)) &&
      typeof evidenceDigest === 'string' && evidenceDigest === digestEvidence('replay-run', evidence as RegistryReplayRunInput);
  }
  if (kind === 'operation-state') {
    return hasOnlyKeys(row, ['operationId', 'cycleId', 'operation', 'firmId', 'status', 'startedAt', 'updatedAt', 'scanCursor', 'scanStarted', 'scanExhausted', 'bufferedKeys', 'pendingIntents', 'dbCursorRequestedAt', 'dbCursorRequestId', 'dbUpperBoundRequestedAt', 'dbExhausted', 'finalizedAt', 'scannedCount', 'appliedCount', 'skippedCount', 'failedCount']) &&
      isUuid(row.operationId) && isUuid(row.cycleId) && (row.operation === 'backfill' || row.operation === 'replay') && (row.firmId === null || isUuid(row.firmId)) &&
      ['running', 'complete', 'failed'].includes(String(row.status)) && isIsoTimestamp(row.startedAt) && isIsoTimestamp(row.updatedAt) &&
      typeof row.scanCursor === 'string' && row.scanCursor.length <= 128 && typeof row.scanStarted === 'boolean' && typeof row.scanExhausted === 'boolean' &&
      Array.isArray(row.bufferedKeys) && row.bufferedKeys.length <= 10000 && row.bufferedKeys.every(isUuid) &&
      Array.isArray(row.pendingIntents) && row.pendingIntents.length <= 100 && row.pendingIntents.every((item) => validRecord('intent', item)) &&
      (row.dbCursorRequestedAt === null || isIsoTimestamp(row.dbCursorRequestedAt)) && (row.dbCursorRequestId === null || isUuid(row.dbCursorRequestId)) && isIsoTimestamp(row.dbUpperBoundRequestedAt) && typeof row.dbExhausted === 'boolean' &&
      (row.finalizedAt === null || isIsoTimestamp(row.finalizedAt)) &&
      validCount(row.scannedCount) && validCount(row.appliedCount) && validCount(row.skippedCount) && validCount(row.failedCount);
  }
  return hasOnlyKeys(row, ['operationId', 'operation', 'deletionRequestId', 'status', 'attempts', 'updatedAt', 'errorCode']) &&
    isUuid(row.operationId) && (row.operation === 'backfill' || row.operation === 'replay') && isUuid(row.deletionRequestId) &&
    ['pending', 'applied', 'skipped', 'failed'].includes(String(row.status)) && validCount(row.attempts) && row.attempts <= 20 &&
    isIsoTimestamp(row.updatedAt) && (row.errorCode === null || row.errorCode === 'redaction_failed' || row.errorCode === 'registry_write_failed');
}

function decodeBase64(value: string, expectedLength?: number): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('privacy registry envelope is invalid');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || (expectedLength !== undefined && decoded.length !== expectedLength)) throw new Error('privacy registry envelope is invalid');
  return decoded;
}

export function encryptRegistryRecord<K extends RegistryRecordKind>(kind: K, value: RegistryRecordByKind[K]): string {
  if (!validRecord(kind, value)) throw new Error('privacy registry payload is invalid');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(aad(kind, recordId(kind, value)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const envelope: Envelope = { v: ENVELOPE_VERSION, kind, kid: KEY_ID, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  // Upstash automatically JSON-decodes string values that themselves contain
  // valid JSON. Prefix and base64url-wrap the envelope so SDK and Lua reads
  // always return the same opaque string representation.
  const serialized = `${ENCODED_ENVELOPE_PREFIX}${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')}`;
  if (serialized.length > MAX_ENCODED_RECORD_LENGTH) throw new Error('privacy registry record exceeds storage limit');
  return serialized;
}

export function decryptRegistryRecord<K extends RegistryRecordKind>(serialized: string, kind: K, id: string): RegistryRecordByKind[K] {
  let envelope: Envelope;
  if (typeof serialized !== 'string' || serialized.length > MAX_ENCODED_RECORD_LENGTH ||
      !serialized.startsWith(ENCODED_ENVELOPE_PREFIX)) {
    throw new Error('privacy registry record is malformed');
  }
  const encoded = serialized.slice(ENCODED_ENVELOPE_PREFIX.length);
  if (!encoded || encoded.length > 2_000_000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error('privacy registry record is malformed');
  }
  try {
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) throw new Error('non-canonical envelope');
    envelope = JSON.parse(decoded.toString('utf8')) as Envelope;
  } catch {
    throw new Error('privacy registry record is malformed');
  }
  if (!envelope || envelope.v !== ENVELOPE_VERSION || envelope.kind !== kind || envelope.kid !== KEY_ID ||
      !isEnvelopePart(envelope.iv, 64) || !isEnvelopePart(envelope.tag, 64) ||
      !isEnvelopePart(envelope.ciphertext, 1_000_000)) throw new Error('privacy registry envelope is invalid');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), decodeBase64(envelope.iv, 12));
    decipher.setAAD(aad(kind, id));
    decipher.setAuthTag(decodeBase64(envelope.tag, 16));
    const raw = Buffer.concat([decipher.update(decodeBase64(envelope.ciphertext)), decipher.final()]);
    const value = JSON.parse(raw.toString('utf8'));
    if (!validRecord(kind, value) || recordId(kind, value) !== id) throw new Error('privacy registry payload is invalid');
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === 'privacy registry payload is invalid') throw error;
    throw new Error('privacy registry authentication failed');
  }
}

function registryKey(kind: RegistryRecordKind, id: string): string {
  return `${PREFIX}${kind}:${id}`;
}

function progressIdentity(deletionRequestId: string): string {
  return createHmac('sha256', encryptionKey())
    .update('caseload-select:privacy-registry:progress-key:')
    .update(deletionRequestId)
    .digest('base64url');
}

function defaultStore(): RegistryStore {
  return Redis.fromEnv() as unknown as RegistryStore;
}

async function registerImmutable<K extends RegistryRecordKind>(kind: K, value: RegistryRecordByKind[K], store = defaultStore()): Promise<'created' | 'existing'> {
  const id = recordId(kind, value);
  const key = registryKey(kind, id);
  const inserted = await store.set(key, encryptRegistryRecord(kind, value), { nx: true });
  if (inserted === 'OK' || inserted === true) return 'created';
  const existing = await store.get<string>(key);
  if (!existing) throw new Error('privacy registry immutable write could not be verified');
  const prior = decryptRegistryRecord(existing, kind, id);
  // The initial timestamp is evidence of when an intent first entered the
  // registry, not an idempotency input. Retried redaction calls naturally
  // produce a fresh clock value and must reuse the immutable original record.
  const sameIntent = kind === 'intent' &&
    (prior as RegistryIntent).deletionRequestId === (value as RegistryIntent).deletionRequestId &&
    (prior as RegistryIntent).firmId === (value as RegistryIntent).firmId &&
    (prior as RegistryIntent).screenedLeadId === (value as RegistryIntent).screenedLeadId &&
    (prior as RegistryIntent).reason === (value as RegistryIntent).reason;
  if (!sameIntent && JSON.stringify(prior) !== JSON.stringify(value)) throw new Error('privacy registry record collision');
  return 'existing';
}

/** Immutable write before an external deletion attempt or any DB redaction. */
export async function registerDeletionIntent(intent: RegistryIntent, store?: RegistryStore): Promise<'created' | 'existing'> {
  return registerImmutable('intent', intent, store);
}

/** Normal deletion admission is atomic with the external recovery circuit.
 * Recovery/backfill deliberately use registerDeletionIntent instead because
 * their circuit state is replaying rather than open. */
export async function registerDeletionIntentWhenOpen(
  intent: RegistryIntent,
  store: RegistryAtomicStore = Redis.fromEnv() as unknown as RegistryAtomicStore,
): Promise<'created' | 'existing'> {
  const id = recordId('intent', intent);
  const encrypted = encryptRegistryRecord('intent', intent);
  const result = await store.eval(
    "local raw=redis.call('get',KEYS[1]); if not raw then return -1 end; local ok,value=pcall(cjson.decode,raw); if not ok or value['state']~='open' then return -1 end; if redis.call('set',KEYS[2],ARGV[1],'NX') then return 1 else return 0 end",
    [`${PREFIX}recovery-circuit`, registryKey('intent', id)],
    [encrypted],
  );
  if (Number(result) === 1) return 'created';
  if (Number(result) !== 0) throw new Error('privacy recovery circuit is closed');
  // Verify an existing immutable record has the identical stable coordinate.
  return registerImmutable('intent', intent, store);
}

export async function registerDeletionAppliedReceipt(receipt: RegistryAppliedReceipt, store?: RegistryStore): Promise<'created' | 'existing'> {
  return registerImmutable('applied', receipt, store);
}

export async function registerBackfillSeal(seal: RegistryBackfillSealInput, store?: RegistryStore): Promise<'created' | 'existing'> {
  return registerImmutable('backfill-seal', { ...seal, evidenceDigest: digestEvidence('backfill-seal', seal) }, store);
}

export async function registerReplayRun(run: RegistryReplayRunInput, store?: RegistryStore): Promise<'created' | 'existing'> {
  return registerImmutable('replay-run', { ...run, evidenceDigest: digestEvidence('replay-run', run) }, store);
}

async function registerImmutableIfLease<K extends RegistryRecordKind>(
  kind: K,
  value: RegistryRecordByKind[K],
  store: RegistryAtomicStore,
  leaseKey: string,
  leaseToken: string,
): Promise<'created' | 'existing'> {
  const id = recordId(kind, value);
  const result = await store.eval(
    "if redis.call('get',KEYS[1])~=ARGV[1] then return -1 end; if redis.call('set',KEYS[2],ARGV[2],'NX') then return 1 else return 0 end",
    [leaseKey, registryKey(kind, id)],
    [leaseToken, encryptRegistryRecord(kind, value)],
  );
  if (Number(result) === 1) return 'created';
  if (Number(result) !== 0) throw new Error('privacy recovery worker lease was lost');
  return registerImmutable(kind, value, store);
}

export async function registerBackfillSealIfLease(
  seal: RegistryBackfillSealInput, store: RegistryAtomicStore, leaseKey: string, leaseToken: string,
): Promise<'created' | 'existing'> {
  return registerImmutableIfLease('backfill-seal', { ...seal, evidenceDigest: digestEvidence('backfill-seal', seal) }, store, leaseKey, leaseToken);
}

export async function registerReplayRunIfLease(
  run: RegistryReplayRunInput, store: RegistryAtomicStore, leaseKey: string, leaseToken: string,
): Promise<'created' | 'existing'> {
  return registerImmutableIfLease('replay-run', { ...run, evidenceDigest: digestEvidence('replay-run', run) }, store, leaseKey, leaseToken);
}

/** Durable encrypted mutable checkpoint. Mutation is intentionally limited to
 * these two recovery record kinds; immutable intent/evidence writes retain NX. */
export async function saveRegistryOperationState(value: RegistryOperationState, store = defaultStore()): Promise<void> {
  await store.set(registryKey('operation-state', value.operationId), encryptRegistryRecord('operation-state', value));
}

export async function saveRegistryOperationStateIfLease(
  value: RegistryOperationState, store: RegistryAtomicStore, leaseKey: string, leaseToken: string,
): Promise<void> {
  const result = await store.eval(
    "if redis.call('get',KEYS[1])~=ARGV[1] then return 0 end; redis.call('set',KEYS[2],ARGV[2]); return 1",
    [leaseKey, registryKey('operation-state', value.operationId)],
    [leaseToken, encryptRegistryRecord('operation-state', value)],
  );
  if (Number(result) !== 1) throw new Error('privacy recovery worker lease was lost');
}

export type PrivacyRegistryStorageDiagnostic = Readonly<{
  redisLeaseEval: boolean;
  encryptionCheckpoint: boolean;
  failedStage: 'redis_lease_eval' | 'encryption_checkpoint' | null;
}>;

/**
 * Exercise the two storage boundaries that unit mocks cannot prove in the
 * deployed environment. Diagnostic keys contain only random coordinates,
 * expire after 60 seconds, and are compare-and-deleted before return. No
 * secret-derived value, ciphertext, key, or raw exception leaves this helper.
 */
export async function diagnosePrivacyRegistryStorage(
  suppliedStore?: RegistryAtomicStore,
): Promise<PrivacyRegistryStorageDiagnostic> {
  let store: RegistryAtomicStore;
  try {
    store = suppliedStore ?? Redis.fromEnv() as unknown as RegistryAtomicStore;
  } catch {
    return { redisLeaseEval: false, encryptionCheckpoint: false, failedStage: 'redis_lease_eval' };
  }
  const operationId = randomUUID();
  const cycleId = randomUUID();
  const leaseToken = randomUUID();
  const leaseKey = `${PREFIX}diagnostic-lease:${operationId}`;
  const checkpointKey = `${PREFIX}diagnostic-checkpoint:${operationId}`;
  let leaseAcquired = false;
  let redisLeaseEval = false;
  try {
    try {
      const acquired = await store.set(leaseKey, leaseToken, { nx: true, ex: 60 });
      if (acquired !== 'OK' && acquired !== true) throw new Error('unavailable');
      leaseAcquired = true;
      const renewed = await store.eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('expire',KEYS[1],60) else return 0 end",
        [leaseKey], [leaseToken],
      );
      if (Number(renewed) !== 1) throw new Error('unavailable');
      redisLeaseEval = true;
    } catch {
      return { redisLeaseEval: false, encryptionCheckpoint: false, failedStage: 'redis_lease_eval' };
    }

    try {
      const now = new Date().toISOString();
      const checkpoint: RegistryOperationState = {
        operationId, cycleId, operation: 'replay', firmId: null, status: 'running',
        startedAt: now, updatedAt: now, scanCursor: '0', scanStarted: false,
        scanExhausted: false, bufferedKeys: [], pendingIntents: [],
        dbCursorRequestedAt: null, dbCursorRequestId: null,
        dbUpperBoundRequestedAt: now, dbExhausted: false, finalizedAt: null,
        scannedCount: 0, appliedCount: 0, skippedCount: 0, failedCount: 0,
      };
      const encrypted = encryptRegistryRecord('operation-state', checkpoint);
      const written = await store.eval(
        "if redis.call('get',KEYS[1])~=ARGV[1] then return 0 end; redis.call('set',KEYS[2],ARGV[2],'EX',60); return 1",
        [leaseKey, checkpointKey], [leaseToken, encrypted],
      );
      if (Number(written) !== 1) throw new Error('unavailable');
      const stored = await store.get<unknown>(checkpointKey);
      if (typeof stored !== 'string') throw new Error('unavailable');
      const decoded = decryptRegistryRecord(stored, 'operation-state', operationId);
      if (decoded.operationId !== operationId || decoded.cycleId !== cycleId) throw new Error('unavailable');
      return { redisLeaseEval: true, encryptionCheckpoint: true, failedStage: null };
    } catch {
      return { redisLeaseEval, encryptionCheckpoint: false, failedStage: 'encryption_checkpoint' };
    }
  } finally {
    if (leaseAcquired) {
      await store.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then redis.call('del',KEYS[2]); return redis.call('del',KEYS[1]) else return 0 end",
        [leaseKey, checkpointKey], [leaseToken],
      ).catch(() => undefined);
    }
  }
}

export async function loadRegistryOperationState(operationId: string, store = defaultStore()): Promise<RegistryOperationState | null> {
  if (!isUuid(operationId)) throw new Error('privacy registry operation id is invalid');
  const value = await store.get<unknown>(registryKey('operation-state', operationId));
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('privacy registry operation checkpoint is invalid');
  return decryptRegistryRecord(value, 'operation-state', operationId);
}

export async function saveRegistryIntentProgress(value: RegistryIntentProgress, store = defaultStore()): Promise<void> {
  const id = `${value.operationId}:${progressIdentity(value.deletionRequestId)}`;
  await store.set(registryKey('intent-progress', id), encryptRegistryRecord('intent-progress', value));
}

export async function saveRegistryIntentProgressIfLease(
  value: RegistryIntentProgress, store: RegistryAtomicStore, leaseKey: string, leaseToken: string,
): Promise<void> {
  const id = `${value.operationId}:${progressIdentity(value.deletionRequestId)}`;
  const result = await store.eval(
    "if redis.call('get',KEYS[1])~=ARGV[1] then return 0 end; redis.call('set',KEYS[2],ARGV[2]); return 1",
    [leaseKey, registryKey('intent-progress', id)],
    [leaseToken, encryptRegistryRecord('intent-progress', value)],
  );
  if (Number(result) !== 1) throw new Error('privacy recovery worker lease was lost');
}

/** Commit terminal per-intent progress and its aggregate operation checkpoint
 * in one Redis transaction. This removes the crash window where a terminal
 * progress record existed but its aggregate outcome had not been counted. */
export async function saveRegistryIntentOutcome(
  progress: RegistryIntentProgress,
  operation: RegistryOperationState,
  store: RegistryAtomicStore,
  leaseKey: string,
  leaseToken: string,
): Promise<void> {
  if (progress.status === 'pending' || progress.operationId !== operation.operationId ||
      progress.operation !== operation.operation) throw new Error('privacy registry outcome is invalid');
  const progressId = `${progress.operationId}:${progressIdentity(progress.deletionRequestId)}`;
  const result = await store.eval(
    "if redis.call('get',KEYS[1])~=ARGV[1] then return 0 end; redis.call('set',KEYS[2],ARGV[2]); redis.call('set',KEYS[3],ARGV[3]); return 1",
    [leaseKey, registryKey('intent-progress', progressId), registryKey('operation-state', operation.operationId)],
    [leaseToken, encryptRegistryRecord('intent-progress', progress), encryptRegistryRecord('operation-state', operation)],
  );
  if (Number(result) !== 1) throw new Error('privacy registry outcome checkpoint failed');
}

export async function loadRegistryIntentProgress(operationId: string, deletionRequestId: string, store = defaultStore()): Promise<RegistryIntentProgress | null> {
  if (!isUuid(operationId) || !isUuid(deletionRequestId)) throw new Error('privacy registry progress coordinate is invalid');
  const id = `${operationId}:${progressIdentity(deletionRequestId)}`;
  const value = await store.get<unknown>(registryKey('intent-progress', id));
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('privacy registry intent progress is invalid');
  return decryptRegistryRecord(value, 'intent-progress', id);
}
