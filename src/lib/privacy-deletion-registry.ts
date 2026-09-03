/**
 * External, encrypted deletion registry.
 *
 * Redis is deliberately a replay source, not a cache. Every value has a
 * versioned, record-kind-specific payload and AES-GCM AAD binds its kind and
 * stable record id. Do not add subject text, provider selectors, email
 * addresses, telephone numbers, or message bodies here.
 */
import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';

const PREFIX = 'privacy:deletion-registry:v2:';
const ENVELOPE_VERSION = 2;
const KEY_ID = 'v1';

export type DeletionReason =
  | 'subject_request'
  | 'retention_sweep'
  | 'internal_test_record'
  | 'legacy_anonymization_backfill';

export type RegistryIntent = Readonly<{
  deletionRequestId: string;
  firmId: string;
  leadId: string;
  reason: DeletionReason;
  recordedAt: string;
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
  set(key: string, value: unknown, options?: { nx?: true }): Promise<unknown>;
  get<T>(key: string): Promise<T | null>;
}

export function isPrivacyDeletionRegistryEnabled(): boolean {
  return process.env.PRIVACY_DELETION_REGISTRY_ENABLED === 'true';
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
  const record = value as RegistryIntent & RegistryAppliedReceipt & RegistryBackfillSeal & RegistryReplayRun;
  switch (kind) {
    case 'intent':
    case 'applied': return record.deletionRequestId;
    case 'backfill-seal': return record.backfillRunId;
    case 'replay-run': return record.replayRunId;
  }
}

function aad(kind: RegistryRecordKind, id: string): Buffer {
  return Buffer.from(`caseload-select:privacy-registry:${ENVELOPE_VERSION}:${kind}:${id}`, 'utf8');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
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
    return hasOnlyKeys(row, ['deletionRequestId', 'firmId', 'leadId', 'reason', 'recordedAt']) &&
      isNonEmptyString(row.deletionRequestId) && isNonEmptyString(row.firmId) &&
      isNonEmptyString(row.leadId) && ['subject_request', 'retention_sweep', 'internal_test_record', 'legacy_anonymization_backfill'].includes(String(row.reason)) &&
      isIsoTimestamp(row.recordedAt);
  }
  if (kind === 'applied') return hasOnlyKeys(row, ['deletionRequestId', 'redactedCount', 'appliedAt']) && isNonEmptyString(row.deletionRequestId) && validCount(row.redactedCount) && isIsoTimestamp(row.appliedAt);
  if (kind === 'backfill-seal') {
    const { evidenceDigest, ...evidence } = row;
    return hasOnlyKeys(row, ['backfillRunId', 'sealedAt', 'sourceWindow', 'scannedCount', 'appliedCount', 'skippedCount', 'failedCount', 'evidenceDigest']) &&
      isNonEmptyString(row.backfillRunId) && isIsoTimestamp(row.sealedAt) && isNonEmptyString(row.sourceWindow) && validCount(row.scannedCount) && validCount(row.appliedCount) && validCount(row.skippedCount) && validCount(row.failedCount) &&
      typeof evidenceDigest === 'string' && evidenceDigest === digestEvidence('backfill-seal', evidence as RegistryBackfillSealInput);
  }
  const { evidenceDigest, ...evidence } = row;
  return hasOnlyKeys(row, ['replayRunId', 'startedAt', 'finishedAt', 'candidateCount', 'appliedCount', 'skippedCount', 'failedCount', 'outcome', 'evidenceDigest']) &&
    isNonEmptyString(row.replayRunId) && isIsoTimestamp(row.startedAt) && (row.finishedAt === null || isIsoTimestamp(row.finishedAt)) && validCount(row.candidateCount) && validCount(row.appliedCount) && validCount(row.skippedCount) && validCount(row.failedCount) && ['started', 'complete', 'failed'].includes(String(row.outcome)) &&
    typeof evidenceDigest === 'string' && evidenceDigest === digestEvidence('replay-run', evidence as RegistryReplayRunInput);
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
  return JSON.stringify(envelope);
}

export function decryptRegistryRecord<K extends RegistryRecordKind>(serialized: string, kind: K, id: string): RegistryRecordByKind[K] {
  let envelope: Envelope;
  try { envelope = JSON.parse(serialized) as Envelope; } catch { throw new Error('privacy registry record is malformed'); }
  if (!envelope || envelope.v !== ENVELOPE_VERSION || envelope.kind !== kind || envelope.kid !== KEY_ID || !isNonEmptyString(envelope.iv) || !isNonEmptyString(envelope.tag) || !isNonEmptyString(envelope.ciphertext)) throw new Error('privacy registry envelope is invalid');
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
  if (JSON.stringify(prior) !== JSON.stringify(value)) throw new Error('privacy registry record collision');
  return 'existing';
}

/** Immutable write before an external deletion attempt or any DB redaction. */
export async function registerDeletionIntent(intent: RegistryIntent, store?: RegistryStore): Promise<'created' | 'existing'> {
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
