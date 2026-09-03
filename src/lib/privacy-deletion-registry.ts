/**
 * External, encrypted deletion-intent registry.
 *
 * This deliberately stores only replay coordinates, never message content or
 * direct identifiers. It is written before the Supabase redaction saga so a
 * database restore cannot silently resurrect a completed subject request.
 */
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';

const PREFIX = 'privacy:deletion-registry:v1:';
const APPLIED_PREFIX = 'privacy:deletion-registry-applied:v1:';
const VERSION = 1;

export type RegistryIntent = Readonly<{
  deletionRequestId: string;
  firmId: string;
  leadId: string;
  reason: 'subject_request' | 'retention_sweep' | 'internal_test_record' | 'legacy_anonymization_backfill';
  recordedAt: string;
}>;

type Envelope = { v: 1; kind: 'intent' | 'applied' | 'backfill-seal' | 'replay-run'; kid: string; iv: string; tag: string; ciphertext: string };

function key(): Buffer {
  const encoded = process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY;
  if (!encoded) throw new Error('privacy deletion registry is not configured');
  const value = Buffer.from(encoded, 'base64');
  if (value.length !== 32) throw new Error('privacy deletion registry key is invalid');
  return value;
}

function aad(intent: Pick<RegistryIntent, 'deletionRequestId'>, kind: Envelope['kind']): Buffer {
  return Buffer.from(`caseload-select:privacy-registry:${VERSION}:${kind}:${intent.deletionRequestId}`, 'utf8');
}

export function encryptRegistryIntent(intent: RegistryIntent): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(aad(intent, 'intent'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(intent), 'utf8'), cipher.final()]);
  const envelope: Envelope = { v: 1, kind: 'intent', kid: 'v1', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  return JSON.stringify(envelope);
}

export function decryptRegistryIntent(serialized: string, requestId: string): RegistryIntent {
  let envelope: Envelope;
  try { envelope = JSON.parse(serialized) as Envelope; } catch { throw new Error('privacy registry record is malformed'); }
  if (envelope?.v !== 1 || envelope.kind !== 'intent' || envelope.kid !== 'v1' || !envelope.iv || !envelope.tag || !envelope.ciphertext) throw new Error('privacy registry envelope is invalid');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(envelope.iv, 'base64'));
    const candidate = { deletionRequestId: requestId };
    decipher.setAAD(aad(candidate, 'intent'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const raw = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    const intent = JSON.parse(raw.toString('utf8')) as RegistryIntent;
    if (intent.deletionRequestId !== requestId || !intent.firmId || !intent.leadId || !intent.reason || !intent.recordedAt) throw new Error('privacy registry payload is invalid');
    return intent;
  } catch { throw new Error('privacy registry authentication failed'); }
}

function sameIntent(a: RegistryIntent, b: RegistryIntent): boolean {
  return a.deletionRequestId === b.deletionRequestId && a.firmId === b.firmId && a.leadId === b.leadId && a.reason === b.reason;
}

/** Immutable SET NX write. A retry may only reuse an identical request id. */
export async function registerDeletionIntent(intent: RegistryIntent): Promise<'created' | 'existing'> {
  const redis = Redis.fromEnv();
  const registryKey = `${PREFIX}${intent.deletionRequestId}`;
  const encrypted = encryptRegistryIntent(intent);
  const inserted = await redis.set(registryKey, encrypted, { nx: true });
  if (inserted === 'OK') return 'created';
  const existing = await redis.get<string>(registryKey);
  if (!existing || !sameIntent(decryptRegistryIntent(existing, intent.deletionRequestId), intent)) throw new Error('privacy registry request collision');
  return 'existing';
}

/** A separate immutable receipt makes the crash boundary observable without
 * mutating the original intent record. */
export async function registerDeletionAppliedReceipt(input: {
  deletionRequestId: string; redactedCount: number; appliedAt: string;
}): Promise<'created' | 'existing'> {
  if (!Number.isInteger(input.redactedCount) || input.redactedCount < 0) throw new Error('privacy registry receipt is invalid');
  const redis = Redis.fromEnv();
  const keyName = `${APPLIED_PREFIX}${input.deletionRequestId}`;
  const body = encryptRegistryIntent({ deletionRequestId: input.deletionRequestId, firmId: 'receipt', leadId: String(input.redactedCount), reason: 'internal_test_record', recordedAt: input.appliedAt });
  const inserted = await redis.set(keyName, body, { nx: true });
  if (inserted === 'OK') return 'created';
  const existing = await redis.get<string>(keyName);
  const decoded = existing && decryptRegistryIntent(existing, input.deletionRequestId);
  if (!decoded || decoded.firmId !== 'receipt' || decoded.leadId !== String(input.redactedCount)) throw new Error('privacy registry receipt collision');
  return 'existing';
}
