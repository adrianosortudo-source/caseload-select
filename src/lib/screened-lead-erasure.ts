/**
 * Application coordinator for screened-lead privacy erasure.
 *
 * Core database redaction is one tenant-scoped, service-role-only RPC. Any
 * non-transactional cleanup is driven by the RPC's durable manifest and must
 * finish before the request is reported as complete. The manifest is returned
 * unchanged on retries, so a Storage failure cannot become a false success.
 */

import 'server-only';

import { supabaseAdmin as supabase } from './supabase-admin';
import {
  isPrivacyDeletionRegistryEnabled,
  registerDeletionAppliedReceipt,
  registerDeletionIntent,
  registerDeletionIntentWhenOpen,
} from './privacy-deletion-registry';
import { assertPrivacyOperationsOpen, assertPrivacyRecoveryReplaying } from './privacy-recovery-gate';

const INTAKE_ATTACHMENTS_BUCKET = 'intake-attachments';
const STORAGE_REMOVE_BATCH = 1000;

export type ScreenedLeadRedactionReason =
  | 'subject_request'
  | 'retention_sweep'
  | 'internal_test_record'
  | 'legacy_anonymization_backfill';

export interface ScreenedLeadErasureInput {
  firmId: string;
  leadId: string;
  /** Stable internal UUID used only by the recovery worker. */
  screenedLeadId?: string;
  reason: ScreenedLeadRedactionReason;
  deletionRequestId: string;
  /** Explicit operator record after any non-API cleanup has actually occurred. */
  externalCleanup?: {
    ghlStatus?: CleanupCompletionStatus;
    metaStatus?: CleanupCompletionStatus;
    resendStatus?: CleanupCompletionStatus;
  };
  /** Internal restore coordinator capability; never accept from a request body. */
  recoveryReplay?: boolean;
}

export type CleanupCompletionStatus =
  | 'completed'
  | 'not_applicable';

export type ManualCleanupCompletionStatus = CleanupCompletionStatus;

export interface ScreenedLeadErasureResult {
  ok: boolean;
  database_redacted: boolean;
  redacted_count: number;
  deletion_request_id: string;
  privacy_redacted_at: string | null;
  external_cleanup_status: string;
  storage_objects_removed: number;
  pending_cleanup_categories: string[];
  error?: string;
}

interface StorageObjectRef {
  bucket: string;
  path: string;
}

interface StoragePrefixRef {
  bucket: string;
  prefix: string;
}

interface RedactionRpcPayload {
  ok?: boolean;
  error?: string;
  redacted_count?: number;
  deletion_request_id?: string;
  privacy_redacted_at?: string | null;
  external_cleanup_status?: string;
  external_cleanup_manifest?: unknown;
  screened_lead_id?: string;
}

interface PrivacyCoordinatePayload {
  ok?: boolean;
  found?: boolean;
  screened_lead_id?: string;
  deletion_request_id?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nonEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function parseCleanupManifest(manifest: unknown): {
  objects: StorageObjectRef[];
  prefixes: StoragePrefixRef[];
  unsupported: string[];
  systemStatuses: {
    ghl: string | null;
    meta: string | null;
    resend: string | null;
  };
} {
  const result = {
    objects: [] as StorageObjectRef[],
    prefixes: [] as StoragePrefixRef[],
    unsupported: [] as string[],
    systemStatuses: { ghl: null, meta: null, resend: null } as {
      ghl: string | null;
      meta: string | null;
      resend: string | null;
    },
  };
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    result.unsupported.push('manifest');
    return result;
  }

  const record = manifest as Record<string, unknown>;
  if (record.version !== 1) result.unsupported.push('manifest_version');
  const storageObjects = record.storage_objects;
  if (Array.isArray(storageObjects)) {
    for (const item of storageObjects) {
      if (typeof item === 'string') {
        result.objects.push({ bucket: INTAKE_ATTACHMENTS_BUCKET, path: item });
        continue;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        result.unsupported.push('storage_objects');
        continue;
      }
      const ref = item as Record<string, unknown>;
      if (typeof ref.path === 'string' && ref.path.length > 0) {
        result.objects.push({
          bucket: typeof ref.bucket === 'string' ? ref.bucket : INTAKE_ATTACHMENTS_BUCKET,
          path: ref.path,
        });
      } else if (typeof ref.prefix === 'string' && ref.prefix.length > 0) {
        result.prefixes.push({
          bucket: typeof ref.bucket === 'string' ? ref.bucket : INTAKE_ATTACHMENTS_BUCKET,
          prefix: ref.prefix.replace(/\/$/, ''),
        });
      } else {
        result.unsupported.push('storage_objects');
      }
    }
  } else {
    result.unsupported.push('storage_objects');
  }

  // These keys describe the manifest rather than external work.
  const externalSystems = record.external_systems;
  if (externalSystems && typeof externalSystems === 'object' && !Array.isArray(externalSystems)) {
    const systems = externalSystems as Record<string, unknown>;
    for (const system of ['ghl', 'meta', 'resend'] as const) {
      const entry = systems[system];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        result.unsupported.push(system);
        continue;
      }
      const status = (entry as Record<string, unknown>).status;
      if (typeof status !== 'string') {
        result.unsupported.push(system);
      } else {
        result.systemStatuses[system] = status;
      }
    }
    for (const [key, value] of Object.entries(systems)) {
      if (!['ghl', 'meta', 'resend'].includes(key) && nonEmpty(value)) {
        result.unsupported.push(key);
      }
    }
  } else {
    result.unsupported.push('external_systems');
  }

  const metadataKeys = new Set([
    'version',
    'created_at',
    'storage_objects',
    'external_systems',
  ]);
  for (const [key, value] of Object.entries(record)) {
    if (!metadataKeys.has(key) && nonEmpty(value)) result.unsupported.push(key);
  }

  return {
    objects: result.objects,
    prefixes: result.prefixes,
    unsupported: [...new Set(result.unsupported)].sort(),
    systemStatuses: result.systemStatuses,
  };
}

async function removeExactStorageObjects(
  refs: StorageObjectRef[],
  expectedFirmId: string,
): Promise<{ ok: boolean; removed: number; error?: string }> {
  const byBucket = new Map<string, string[]>();
  for (const ref of refs) {
    // This workflow only owns intake attachments. Refuse an unexpected bucket
    // rather than turning a malformed manifest into broad deletion authority.
    if (
      ref.bucket !== INTAKE_ATTACHMENTS_BUCKET ||
      !ref.path.trim() ||
      !ref.path.startsWith(`${expectedFirmId}/`) ||
      ref.path.split('/').includes('..')
    ) {
      return { ok: false, removed: 0, error: 'unsupported storage cleanup target' };
    }
    const paths = byBucket.get(ref.bucket) ?? [];
    paths.push(ref.path);
    byBucket.set(ref.bucket, paths);
  }

  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    const uniquePaths = [...new Set(paths)];
    for (let i = 0; i < uniquePaths.length; i += STORAGE_REMOVE_BATCH) {
      const batch = uniquePaths.slice(i, i + STORAGE_REMOVE_BATCH);
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        return { ok: false, removed, error: 'intake attachment removal failed' };
      }
      removed += batch.length;
    }
  }
  return { ok: true, removed };
}

async function removeStoragePrefixes(
  refs: StoragePrefixRef[],
  expectedFirmId: string,
): Promise<{ ok: boolean; removed: number; error?: string }> {
  let removed = 0;
  for (const ref of refs) {
    if (
      ref.bucket !== INTAKE_ATTACHMENTS_BUCKET ||
      !ref.prefix.trim() ||
      !ref.prefix.startsWith(`${expectedFirmId}/`) ||
      ref.prefix.split('/').includes('..')
    ) {
      return { ok: false, removed, error: 'unsupported storage cleanup target' };
    }

    // The intake upload layout is flat beneath one session prefix. Always
    // relist offset zero after a removal so pagination cannot skip shifted rows.
    for (;;) {
      const { data, error } = await supabase.storage.from(ref.bucket).list(ref.prefix, {
        limit: STORAGE_REMOVE_BATCH,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) {
        return { ok: false, removed, error: 'intake attachment listing failed' };
      }
      const paths = (data ?? [])
        .filter((entry) => !!entry && typeof entry.name === 'string' && entry.name.length > 0)
        .map((entry) => `${ref.prefix}/${entry.name}`);
      if (paths.length === 0) break;
      const cleanup = await removeExactStorageObjects(
        paths.map((path) => ({ bucket: ref.bucket, path })),
        expectedFirmId,
      );
      removed += cleanup.removed;
      if (!cleanup.ok) return { ok: false, removed, error: cleanup.error };
      if (paths.length < STORAGE_REMOVE_BATCH) break;
    }
  }
  return { ok: true, removed };
}

/** Remove a legacy intake session's objects without exposing its path in logs. */
export async function removeIntakeSessionAttachments(
  firmId: string,
  sessionId: string,
): Promise<{ ok: boolean; removed: number; error?: string }> {
  return removeStoragePrefixes(
    [{ bucket: INTAKE_ATTACHMENTS_BUCKET, prefix: `${firmId}/${sessionId}` }],
    firmId,
  );
}

export async function eraseScreenedLead(
  input: ScreenedLeadErasureInput,
): Promise<ScreenedLeadErasureResult> {
  const registryEnabled = isPrivacyDeletionRegistryEnabled();
  let stableScreenedLeadId = input.screenedLeadId;
  if (registryEnabled) {
    // Register intent before the irreversible local redaction. Provider
    // cleanup deliberately remains the existing pending durable-manifest and
    // evidence workflow; the registry must not require an unshipped adapter.
    try {
      if (input.recoveryReplay) await assertPrivacyRecoveryReplaying();
      else await assertPrivacyOperationsOpen();

      if (input.recoveryReplay) {
        if (!stableScreenedLeadId || !UUID_RE.test(stableScreenedLeadId)) {
          throw new Error('stable recovery coordinate is required');
        }
      } else {
        const { data: coordinateData, error: coordinateError } = await supabase.rpc(
          'resolve_screened_lead_privacy_coordinate',
          {
            p_firm_id: input.firmId,
            p_lead_id: input.leadId,
            p_deletion_request_id: input.deletionRequestId,
          },
        );
        if (coordinateError) throw new Error('privacy coordinate lookup failed');
        const coordinate = (coordinateData ?? {}) as PrivacyCoordinatePayload;
        if (coordinate.ok !== true) throw new Error('privacy coordinate lookup refused');
        stableScreenedLeadId = coordinate.found === true ? coordinate.screened_lead_id : undefined;
        if (coordinate.found !== true) {
          // Do not call the public-id redaction RPC after an empty lookup. A
          // lead inserted between lookup and mutation would otherwise be
          // redacted without first receiving a durable registry intent.
          return {
            ok: true,
            database_redacted: false,
            redacted_count: 0,
            deletion_request_id: input.deletionRequestId,
            privacy_redacted_at: null,
            external_cleanup_status: 'not_applicable',
            storage_objects_removed: 0,
            pending_cleanup_categories: [],
          };
        }
        if (stableScreenedLeadId && !UUID_RE.test(stableScreenedLeadId)) {
          throw new Error('privacy coordinate lookup returned an invalid coordinate');
        }
      }

      // Missing subjects are enumeration-safe no-ops and have no irreversible
      // local mutation to protect. Every existing subject is registered using
      // the stable internal UUID before the redaction RPC.
      if (stableScreenedLeadId) {
        const intent = {
          deletionRequestId: input.deletionRequestId,
          firmId: input.firmId,
          screenedLeadId: stableScreenedLeadId,
          reason: input.reason,
          recordedAt: new Date().toISOString(),
        };
        if (input.recoveryReplay) await registerDeletionIntent(intent);
        else await registerDeletionIntentWhenOpen(intent);
      }
    } catch {
      return {
        ok: false,
        database_redacted: false,
        redacted_count: 0,
        deletion_request_id: input.deletionRequestId,
        privacy_redacted_at: null,
        external_cleanup_status: 'not_started',
        storage_objects_removed: 0,
        pending_cleanup_categories: ['external_deletion_registry'],
        error: 'external privacy deletion registry is unavailable',
      };
    }
  }
  const redactionById = registryEnabled;
  const { data, error } = await supabase.rpc(
    redactionById ? 'redact_screened_lead_subject_by_id' : 'redact_screened_lead_subject',
    redactionById
      ? {
          p_firm_id: input.firmId,
          p_screened_lead_id: stableScreenedLeadId,
          p_reason: input.reason,
          p_deletion_request_id: input.deletionRequestId,
        }
      : {
          p_firm_id: input.firmId,
          p_lead_id: input.leadId,
          p_reason: input.reason,
          p_deletion_request_id: input.deletionRequestId,
        },
  );

  if (error) {
    return {
      ok: false,
      database_redacted: false,
      redacted_count: 0,
      deletion_request_id: input.deletionRequestId,
      privacy_redacted_at: null,
      external_cleanup_status: 'not_started',
      storage_objects_removed: 0,
      pending_cleanup_categories: [],
      error: error.message,
    };
  }

  const payload = (data ?? {}) as RedactionRpcPayload;
  const requestId = payload.deletion_request_id ?? input.deletionRequestId;
  if (payload.ok !== true) {
    return {
      ok: false,
      database_redacted: false,
      redacted_count: 0,
      deletion_request_id: requestId,
      privacy_redacted_at: payload.privacy_redacted_at ?? null,
      external_cleanup_status: payload.external_cleanup_status ?? 'not_started',
      storage_objects_removed: 0,
      pending_cleanup_categories: [],
      error: payload.error ?? 'screened lead redaction refused',
    };
  }

  // If this second immutable write fails, do not report success: the intent
  // remains replayable and a retry can safely record the receipt.
  try {
    if (registryEnabled) {
      // The single-lead RPC returns 1 on its first terminal mutation and 0 on
      // a successful retry, while preserving privacy_redacted_at. Seal the
      // stable terminal fact rather than the per-call mutation count.
      const terminalRedaction = !!payload.privacy_redacted_at || (payload.redacted_count ?? 0) > 0;
      await registerDeletionAppliedReceipt({
        deletionRequestId: requestId,
        redactedCount: terminalRedaction ? 1 : 0,
        appliedAt: payload.privacy_redacted_at ?? new Date().toISOString(),
      });
    }
  } catch {
    return { ok: false, database_redacted: true, redacted_count: payload.redacted_count ?? 0,
      deletion_request_id: requestId, privacy_redacted_at: payload.privacy_redacted_at ?? null,
      external_cleanup_status: payload.external_cleanup_status ?? 'pending', storage_objects_removed: 0,
      pending_cleanup_categories: ['external_deletion_registry_receipt'], error: 'external privacy registry receipt is unavailable' };
  }

  const base = {
    database_redacted:
      (payload.redacted_count ?? 0) > 0 || !!payload.privacy_redacted_at,
    redacted_count: payload.redacted_count ?? 0,
    deletion_request_id: requestId,
    privacy_redacted_at: payload.privacy_redacted_at ?? null,
  };
  // Restore replay is complete once the tenant-scoped database transition and
  // durable registry receipt above have succeeded. Provider and Storage
  // cleanup remain governed by their existing pending evidence workflow; a
  // recovery worker must never acknowledge or perform that separate work.
  if (registryEnabled && input.recoveryReplay) {
    return {
      ok: true,
      ...base,
      external_cleanup_status: payload.external_cleanup_status ?? 'pending',
      storage_objects_removed: 0,
      pending_cleanup_categories: [],
    };
  }
  if (
    payload.external_cleanup_status === 'complete' ||
    payload.external_cleanup_status === 'not_applicable'
  ) {
    return {
      ok: true,
      ...base,
      external_cleanup_status: payload.external_cleanup_status,
      storage_objects_removed: 0,
      pending_cleanup_categories: [],
    };
  }

  const manifest = parseCleanupManifest(payload.external_cleanup_manifest);
  const completion = input.externalCleanup;
  const completionStatuses: Record<'ghl' | 'meta' | 'resend', CleanupCompletionStatus> = {
    ghl: 'not_applicable',
    meta: 'not_applicable',
    resend: 'not_applicable',
  };
  for (const system of ['ghl', 'meta', 'resend'] as const) {
    const manifestStatus = manifest.systemStatuses[system];
    const confirmedStatus =
      system === 'ghl'
        ? completion?.ghlStatus
        : system === 'meta'
          ? completion?.metaStatus
          : completion?.resendStatus;
    if (manifestStatus === 'completed' || manifestStatus === 'not_applicable') {
      completionStatuses[system] = manifestStatus;
    } else if (
      (manifestStatus === 'manual_required' || manifestStatus === 'provider_managed') &&
      (confirmedStatus === 'completed' || confirmedStatus === 'not_applicable')
    ) {
      // A provider-managed entry identifies where another copy may live. Only
      // an evidence-backed completed/not-applicable disposition can close it;
      // the location marker itself is never completion evidence.
      completionStatuses[system] = confirmedStatus;
    } else if (
      manifestStatus === 'manual_required' ||
      manifestStatus === 'provider_managed'
    ) {
      manifest.unsupported.push(system);
    } else if (manifestStatus) {
      manifest.unsupported.push(system);
    }
  }
  manifest.unsupported = [...new Set(manifest.unsupported)].sort();
  if (manifest.unsupported.length > 0) {
    return {
      ok: false,
      ...base,
      external_cleanup_status: payload.external_cleanup_status ?? 'pending',
      storage_objects_removed: 0,
      pending_cleanup_categories: manifest.unsupported,
      error: 'external privacy cleanup requires explicit operator completion',
    };
  }

  const exactCleanup = await removeExactStorageObjects(manifest.objects, input.firmId);
  if (!exactCleanup.ok) {
    return {
      ok: false,
      ...base,
      external_cleanup_status: 'pending',
      storage_objects_removed: exactCleanup.removed,
      pending_cleanup_categories: ['storage_objects'],
      error: exactCleanup.error,
    };
  }
  const prefixCleanup = await removeStoragePrefixes(manifest.prefixes, input.firmId);
  const removed = exactCleanup.removed + prefixCleanup.removed;
  if (!prefixCleanup.ok) {
    return {
      ok: false,
      ...base,
      external_cleanup_status: 'pending',
      storage_objects_removed: removed,
      pending_cleanup_categories: ['storage_objects'],
      error: prefixCleanup.error,
    };
  }

  const { data: completedData, error: completeError } = await supabase.rpc(
    'complete_screened_lead_external_cleanup',
    {
      p_firm_id: input.firmId,
      p_deletion_request_id: requestId,
      p_cleanup_summary: {
        storage_deleted_count: removed,
        ghl_status: completionStatuses.ghl,
        meta_status: completionStatuses.meta,
        resend_status: completionStatuses.resend,
      },
    },
  );
  if (completeError) {
    return {
      ok: false,
      ...base,
      external_cleanup_status: 'pending',
      storage_objects_removed: removed,
      pending_cleanup_categories: ['completion_acknowledgement'],
      error: completeError.message,
    };
  }
  const completed = (completedData ?? {}) as { ok?: boolean; error?: string };
  if (completed.ok !== true) {
    return {
      ok: false,
      ...base,
      external_cleanup_status: 'pending',
      storage_objects_removed: removed,
      pending_cleanup_categories: ['completion_acknowledgement'],
      error: completed.error ?? 'external cleanup completion refused',
    };
  }

  return {
    ok: true,
    ...base,
    external_cleanup_status: 'complete',
    storage_objects_removed: removed,
    pending_cleanup_categories: [],
  };
}

export interface PrivacyAuditExpiryResult {
  ok: boolean;
  retention_period: string;
  eligible_request_count: number;
  purged_event_count: number;
  purged_channel_event_count: number;
  purged_consent_event_count: number;
  purged_attribution_event_count: number;
  remaining_eligible_count: number;
  has_more: boolean;
  error?: string;
}

export interface PendingScreenedLeadPrivacyCleanup {
  firm_id: string;
  screened_lead_id: string;
  current_lead_id: string;
  deletion_request_id: string;
}

export interface PendingScreenedLeadPrivacyCleanupResult {
  ok: boolean;
  pending_count: number;
  requests: PendingScreenedLeadPrivacyCleanup[];
  error?: string;
}

/** List bounded, oldest-first cleanup requests without exposing their manifest. */
export async function listPendingScreenedLeadPrivacyCleanups(
  limit = 100,
): Promise<PendingScreenedLeadPrivacyCleanupResult> {
  const { data, error } = await supabase.rpc(
    'list_pending_screened_lead_privacy_cleanups',
    { p_limit: limit },
  );
  if (error) {
    return { ok: false, pending_count: 0, requests: [], error: error.message };
  }
  const payload = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    pending_count?: number;
    requests?: unknown;
  };
  if (payload.ok !== true || !Array.isArray(payload.requests)) {
    return {
      ok: false,
      pending_count: 0,
      requests: [],
      error: payload.error ?? 'pending privacy cleanup listing refused',
    };
  }
  const requests = payload.requests.filter(
    (request): request is PendingScreenedLeadPrivacyCleanup => {
      if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
      const row = request as Record<string, unknown>;
      return (
        typeof row.firm_id === 'string' &&
        typeof row.screened_lead_id === 'string' &&
        typeof row.current_lead_id === 'string' &&
        typeof row.deletion_request_id === 'string'
      );
    },
  );
  if (requests.length !== payload.requests.length) {
    return {
      ok: false,
      pending_count: 0,
      requests: [],
      error: 'pending privacy cleanup listing returned an invalid row',
    };
  }
  return {
    ok: true,
    pending_count: payload.pending_count ?? requests.length,
    requests,
  };
}

/**
 * Check the database's salted-hash suppression register before accepting a
 * new channel inbound or sending to a previously erased subject. The caller
 * supplies the provider identifier only to the service-role RPC; it is never
 * retained or logged by this helper.
 */
export async function isChannelSubjectPrivacySuppressed(args: {
  firmId: string;
  channel: 'facebook' | 'instagram' | 'whatsapp';
  senderId: string;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'is_channel_subject_privacy_suppressed',
    {
      p_firm_id: args.firmId,
      p_channel: args.channel,
      p_sender_id: args.senderId,
    },
  );
  if (error) throw new Error('channel privacy suppression lookup failed');
  return data === true;
}

/**
 * Remove audit envelopes when they reach the database-controlled three-year maximum.
 * The RPC deliberately accepts no tenant, timestamp or bypass argument.
 */
export async function purgeExpiredPrivacyAuditEnvelopes(
  limit = 100,
): Promise<PrivacyAuditExpiryResult> {
  const { data, error } = await supabase.rpc(
    'purge_expired_privacy_audit_envelopes',
    { p_limit: limit },
  );
  if (error) {
    return {
      ok: false,
      retention_period: '3 years',
      eligible_request_count: 0,
      purged_event_count: 0,
      purged_channel_event_count: 0,
      purged_consent_event_count: 0,
      purged_attribution_event_count: 0,
      remaining_eligible_count: 0,
      has_more: false,
      error: error.message,
    };
  }
  const payload = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    retention_period?: string;
    eligible_request_count?: number;
    purged_event_count?: number;
    purged_channel_event_count?: number;
    purged_consent_event_count?: number;
    purged_attribution_event_count?: number;
    remaining_eligible_count?: number;
    has_more?: boolean;
  };
  if (payload.ok !== true) {
    return {
      ok: false,
      retention_period: payload.retention_period ?? '3 years',
      eligible_request_count: 0,
      purged_event_count: 0,
      purged_channel_event_count: 0,
      purged_consent_event_count: 0,
      purged_attribution_event_count: 0,
      remaining_eligible_count: 0,
      has_more: false,
      error: payload.error ?? 'privacy audit expiry refused',
    };
  }
  if (
    typeof payload.eligible_request_count !== 'number' ||
    typeof payload.purged_event_count !== 'number' ||
    typeof payload.purged_channel_event_count !== 'number' ||
    typeof payload.purged_consent_event_count !== 'number' ||
    typeof payload.purged_attribution_event_count !== 'number' ||
    typeof payload.remaining_eligible_count !== 'number' ||
    typeof payload.has_more !== 'boolean'
  ) {
    return {
      ok: false,
      retention_period: payload.retention_period ?? '3 years',
      eligible_request_count: 0,
      purged_event_count: 0,
      purged_channel_event_count: 0,
      purged_consent_event_count: 0,
      purged_attribution_event_count: 0,
      remaining_eligible_count: 0,
      has_more: false,
      error: 'privacy audit expiry returned an invalid result',
    };
  }
  return {
    ok: true,
    retention_period: payload.retention_period ?? '3 years',
    eligible_request_count: payload.eligible_request_count,
    purged_event_count: payload.purged_event_count,
    purged_channel_event_count: payload.purged_channel_event_count,
    purged_consent_event_count: payload.purged_consent_event_count,
    purged_attribution_event_count: payload.purged_attribution_event_count,
    remaining_eligible_count: payload.remaining_eligible_count,
    has_more: payload.has_more,
  };
}
