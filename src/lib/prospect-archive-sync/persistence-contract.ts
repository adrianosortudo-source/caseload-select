import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type {
  ArchiveSyncHistoryObservation,
  ArchiveSyncPreview,
  ArchiveSyncProposedActivity,
  ArchiveSyncProviderEvent,
} from './types';

export const ARCHIVE_SYNC_BUNDLE_SCHEMA = 'prospect-archive-sync-bundle.v1' as const;
export const ARCHIVE_SYNC_APPLY_SCHEMA = 'prospect-archive-sync-apply.v1' as const;
export const ARCHIVE_SYNC_REVIEW_PERMIT_SCHEMA = 'prospect-archive-sync-review-permit.v1' as const;

const MAX_EVENTS = 5_000;
const MAX_OBSERVATIONS = 200;

export type ArchiveSyncBundle = {
  schema_version: typeof ARCHIVE_SYNC_BUNDLE_SCHEMA;
  highlevel_location_id: string;
  provider_events: ArchiveSyncProviderEvent[];
  history_observations: ArchiveSyncHistoryObservation[];
};

export type ArchiveSyncReviewPermit = {
  schema_version: typeof ARCHIVE_SYNC_REVIEW_PERMIT_SCHEMA;
  bundle_digest: string;
  preview_digest: string;
  issued_at: string;
  expires_at: string;
};

export type ArchiveSyncApplyEvent = ArchiveSyncProposedActivity & {
  highlevel_location_id: string;
  highlevel_contact_id: string;
  event_digest: string;
};

export type ArchiveSyncApplyPayload = {
  schema_version: typeof ARCHIVE_SYNC_APPLY_SCHEMA;
  provider: 'highlevel';
  highlevel_location_id: string;
  events: ArchiveSyncApplyEvent[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonBlankText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

/** Stable representation so reordered JSON object keys cannot invalidate review. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function archiveSyncDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function parseArchiveSyncBundle(value: unknown): ArchiveSyncBundle {
  if (!isPlainObject(value)
    || Object.keys(value).some((key) => !['schema_version', 'highlevel_location_id', 'provider_events', 'history_observations'].includes(key))
    || value.schema_version !== ARCHIVE_SYNC_BUNDLE_SCHEMA
    || !nonBlankText(value.highlevel_location_id, 200)
    || !Array.isArray(value.provider_events)
    || value.provider_events.length > MAX_EVENTS
    || !Array.isArray(value.history_observations)
    || value.history_observations.length > MAX_OBSERVATIONS) {
    throw new Error(`Archive bundle must use ${ARCHIVE_SYNC_BUNDLE_SCHEMA} and contain only supported fields.`);
  }
  return {
    schema_version: ARCHIVE_SYNC_BUNDLE_SCHEMA,
    highlevel_location_id: value.highlevel_location_id.trim(),
    provider_events: value.provider_events as ArchiveSyncProviderEvent[],
    history_observations: value.history_observations as ArchiveSyncHistoryObservation[],
  };
}

function permitPayload(permit: ArchiveSyncReviewPermit): string {
  return canonicalJson(permit);
}

function reviewSecret(explicitSecret?: string): string {
  const secret = explicitSecret ?? process.env.ARCHIVE_SYNC_REVIEW_SECRET;
  if (!nonBlankText(secret, 4096)) throw new Error('ARCHIVE_SYNC_REVIEW_SECRET is required to issue or apply archive-review permits.');
  return secret;
}

/**
 * The permit binds an operator-reviewed preview to the exact uploaded bundle.
 * It is server-minted; a browser can carry it but cannot create or alter it.
 */
export function createArchiveSyncReviewPermit(
  input: { bundleDigest: string; previewDigest: string; now?: Date; ttlMs?: number; secret?: string },
): string {
  if (!/^[0-9a-f]{64}$/.test(input.bundleDigest) || !/^[0-9a-f]{64}$/.test(input.previewDigest)) {
    throw new Error('Archive review permits require SHA-256 bundle and preview digests.');
  }
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > 30 * 60 * 1000) throw new Error('Archive review permit lifetime must be between 1ms and 30 minutes.');
  const permit: ArchiveSyncReviewPermit = {
    schema_version: ARCHIVE_SYNC_REVIEW_PERMIT_SCHEMA,
    bundle_digest: input.bundleDigest,
    preview_digest: input.previewDigest,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  };
  const payload = Buffer.from(permitPayload(permit)).toString('base64url');
  const signature = createHmac('sha256', reviewSecret(input.secret)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyArchiveSyncReviewPermit(
  encoded: string,
  expected: { bundleDigest: string; previewDigest: string; now?: Date; secret?: string },
): ArchiveSyncReviewPermit {
  const separator = encoded.lastIndexOf('.');
  if (separator < 1) throw new Error('Archive review permit is malformed.');
  const payload = encoded.slice(0, separator);
  const signature = encoded.slice(separator + 1);
  const expectedSignature = createHmac('sha256', reviewSecret(expected.secret)).update(payload).digest('base64url');
  if (signature.length !== expectedSignature.length
    || !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('Archive review permit is invalid.');
  }
  let permit: unknown;
  try { permit = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new Error('Archive review permit payload is invalid.'); }
  if (!isPlainObject(permit)
    || permit.schema_version !== ARCHIVE_SYNC_REVIEW_PERMIT_SCHEMA
    || !nonBlankText(permit.bundle_digest, 64)
    || !nonBlankText(permit.preview_digest, 64)
    || !nonBlankText(permit.issued_at, 80)
    || !nonBlankText(permit.expires_at, 80)
    || !/^[0-9a-f]{64}$/.test(permit.bundle_digest)
    || !/^[0-9a-f]{64}$/.test(permit.preview_digest)
    || permit.bundle_digest !== expected.bundleDigest
    || permit.preview_digest !== expected.previewDigest) {
    throw new Error('Archive review permit does not match this exact bundle and preview.');
  }
  const issuedAt = Date.parse(permit.issued_at);
  const expiresAt = Date.parse(permit.expires_at);
  const now = (expected.now ?? new Date()).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || now < issuedAt || now > expiresAt) {
    throw new Error('Archive review permit has expired or is not yet valid.');
  }
  return permit as ArchiveSyncReviewPermit;
}

function serverApplyDirection(kind: ArchiveSyncProposedActivity['kind']): 'outbound' | 'inbound' | 'internal' {
  if (kind === 'message_sent') return 'outbound';
  if (kind === 'human_reply' || kind === 'automated_reply' || kind === 'bounce') return 'inbound';
  if (kind === 'meeting') return 'internal';
  throw new Error(`Archive apply does not support provider activity kind ${kind}.`);
}

/** The database receives only this bounded, server-reconstructed projection. */
export function buildArchiveSyncApplyPayload(input: {
  preview: ArchiveSyncPreview;
  highLevelByRecordId: ReadonlyMap<string, { locationId: string; contactId: string }>;
  highLevelLocationId: string;
}): ArchiveSyncApplyPayload {
  if (input.preview.provider !== 'highlevel' || input.preview.mode !== 'read_only_preview') {
    throw new Error('Only a HighLevel read-only preview may be applied.');
  }
  if (input.preview.held_events.length > 0) {
    throw new Error('A preview with held events cannot be applied. Resolve or remove the held provider data first.');
  }
  if (!nonBlankText(input.highLevelLocationId, 200)) {
    throw new Error('Archive apply requires one authoritative HighLevel location.');
  }
  const highlevelLocationId = input.highLevelLocationId.trim();
  const events = input.preview.proposed_activities.map((activity) => {
    const highLevel = input.highLevelByRecordId.get(activity.cls_record_id);
    if (!highLevel || !nonBlankText(highLevel.locationId, 200) || !nonBlankText(highLevel.contactId, 500)) {
      throw new Error(`Archive source ${activity.cls_record_id} has no authoritative HighLevel identity.`);
    }
    if (highLevel.locationId !== highlevelLocationId) {
      throw new Error('Archive apply may contain one authoritative HighLevel location only.');
    }
    // Validate the supported direction explicitly before it becomes an implicit
    // database rule. The migration derives the same direction independently.
    serverApplyDirection(activity.kind);
    const withoutDigest = {
      ...activity,
      highlevel_location_id: highLevel.locationId,
      highlevel_contact_id: highLevel.contactId,
    };
    return { ...withoutDigest, event_digest: archiveSyncDigest(withoutDigest) };
  });
  return {
    schema_version: ARCHIVE_SYNC_APPLY_SCHEMA,
    provider: 'highlevel',
    highlevel_location_id: highlevelLocationId,
    events,
  };
}
