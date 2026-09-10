import 'server-only';

import { buildArchiveSyncPreview } from './preview';
import { listProspectingControlPlaneSources } from '@/lib/prospect-source-registry';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { ArchiveSyncPreview } from './types';
import {
  archiveSyncDigest,
  buildArchiveSyncApplyPayload,
  parseArchiveSyncBundle,
  verifyArchiveSyncReviewPermit,
  type ArchiveSyncApplyPayload,
  type ArchiveSyncBundle,
} from './persistence-contract';

export type PreparedArchiveSyncApply = {
  bundle: ArchiveSyncBundle;
  bundleDigest: string;
  preview: ArchiveSyncPreview;
  previewDigest: string;
  applyPayload: ArchiveSyncApplyPayload;
};

type ApplyReceipt = {
  schema_version: 'prospect-archive-sync-apply-receipt.v1';
  provider: 'highlevel';
  transaction_scope: 'single_batch';
  events_received: number;
  events_inserted: number;
  events_replayed: number;
  highlevel_writes: 0;
};

/**
 * Rebuilds the preview from the immutable Control Plane source registry. The
 * uploaded bundle is never trusted as identity or scope evidence.
 */
export async function prepareArchiveSyncApply(value: unknown): Promise<PreparedArchiveSyncApply> {
  const bundle = parseArchiveSyncBundle(value);
  const sourcePage = await listProspectingControlPlaneSources({ page: 1, pageSize: 100 });
  if (sourcePage.total > 100) throw new Error('Archive apply currently supports one reconciled BA/AE cohort of at most 100 records.');
  const records = sourcePage.records.filter((record) => record.sourceActive && (record.arm === 'BA' || record.arm === 'AE'));
  if (records.length === 0 || records.some((record) => !record.highLevel.locationId || !record.highLevel.contactId || !record.conversation?.id)) {
    throw new Error('Archive apply requires reconciled BA/AE records with exact HighLevel contacts and local conversations.');
  }
  const locationIds = new Set(records.map((record) => record.highLevel.locationId));
  if (locationIds.size !== 1 || !locationIds.has(bundle.highlevel_location_id)) {
    throw new Error('Archive bundle location does not match the authoritative BA/AE source registry.');
  }
  const preview = buildArchiveSyncPreview({
    highlevel_location_id: bundle.highlevel_location_id,
    ba_ae_allowlist: new Set(records.map((record) => record.sourceRecordKey)),
    cohort_records: records.map((record) => ({
      cls_record_id: record.sourceRecordKey,
      arm: record.arm,
      highlevel_location_id: record.highLevel.locationId!,
      highlevel_contact_id: record.highLevel.contactId!,
      conversation_id: record.conversation!.id,
    })),
    history_observations: bundle.history_observations,
    provider_events: bundle.provider_events,
  });
  const applyPayload = buildArchiveSyncApplyPayload({
    preview,
    highLevelByRecordId: new Map(records.map((record) => [record.sourceRecordKey, {
      locationId: record.highLevel.locationId!, contactId: record.highLevel.contactId!,
    }])),
    highLevelLocationId: bundle.highlevel_location_id,
  });
  return {
    bundle,
    bundleDigest: archiveSyncDigest(bundle),
    preview,
    previewDigest: archiveSyncDigest(preview),
    applyPayload,
  };
}

/**
 * Applies one already-reviewed preview. It only calls our database RPC;
 * there is no HighLevel client or mutation path in this module.
 */
export async function applyReviewedArchiveSyncBundle(input: {
  bundle: unknown;
  reviewPermit: string;
  operatorId: string;
  now?: Date;
}): Promise<{ prepared: PreparedArchiveSyncApply; receipt: ApplyReceipt }> {
  const prepared = await prepareArchiveSyncApply(input.bundle);
  verifyArchiveSyncReviewPermit(input.reviewPermit, {
    bundleDigest: prepared.bundleDigest,
    previewDigest: prepared.previewDigest,
    now: input.now,
  });
  const { data, error } = await supabaseAdmin.rpc('apply_prospect_archive_sync_batch', {
    p_bundle: prepared.applyPayload,
    p_operator_id: input.operatorId,
  });
  if (error) throw new Error(error.message);
  const receipt = data as ApplyReceipt;
  if (!receipt || receipt.schema_version !== 'prospect-archive-sync-apply-receipt.v1'
    || receipt.provider !== 'highlevel' || receipt.transaction_scope !== 'single_batch'
    || receipt.highlevel_writes !== 0) {
    throw new Error('Archive apply RPC returned an invalid receipt.');
  }
  return { prepared, receipt };
}
