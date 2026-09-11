import { NextResponse } from 'next/server';

import { getOperatorSession } from '@/lib/portal-auth';
import { listProspectingControlPlaneSources } from '@/lib/prospect-source-registry';
import { buildArchiveSyncPreview } from '@/lib/prospect-archive-sync';
import { readHighLevelArchive } from '@/lib/prospect-archive-sync/highlevel-reader';
import { archiveSyncDigest, createArchiveSyncReviewPermit } from '@/lib/prospect-archive-sync/persistence-contract';

/**
 * Operator-only, GET-only HighLevel reader for the protected BA/AE cohort.
 * It derives the exact roster from the source registry and never accepts a
 * browser-supplied contact ID, location, or provider URL.
 */
export async function POST() {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sourcePage = await listProspectingControlPlaneSources({ page: 1, pageSize: 100 });
    const records = sourcePage.records.filter((record) => record.sourceActive && (record.arm === 'BA' || record.arm === 'AE'));
    if (sourcePage.total !== 100 || records.length !== 100 || records.filter((record) => record.arm === 'BA').length !== 50 || records.filter((record) => record.arm === 'AE').length !== 50) {
      throw new Error('Direct archive sync requires the reconciled 50 BA and 50 AE source records.');
    }
    if (records.some((record) => !record.highLevel.locationId || !record.highLevel.contactId || !record.conversation?.id)) {
      throw new Error('One or more BA/AE records lack a reconciled HighLevel identity or local conversation.');
    }
    const locationIds = new Set(records.map((record) => record.highLevel.locationId!));
    if (locationIds.size !== 1) throw new Error('The BA/AE cohort must resolve to one HighLevel location.');
    const locationId = [...locationIds][0];
    const read = await readHighLevelArchive({
      highlevelLocationId: locationId,
      token: process.env.GHL_CASELOAD_SELECT_TOKEN,
      records: records.map((record) => ({
        cls_record_id: record.sourceRecordKey,
        arm: record.arm === 'BA' ? 'BA' : 'AE',
        highlevel_location_id: record.highLevel.locationId!,
        highlevel_contact_id: record.highLevel.contactId!,
      })),
    });
    const preview = buildArchiveSyncPreview({
      highlevel_location_id: locationId,
      ba_ae_allowlist: new Set(records.map((record) => record.sourceRecordKey)),
      cohort_records: records.map((record) => ({
        cls_record_id: record.sourceRecordKey,
        arm: record.arm === 'BA' ? 'BA' : 'AE',
        highlevel_location_id: record.highLevel.locationId!,
        highlevel_contact_id: record.highLevel.contactId!,
        conversation_id: record.conversation!.id,
      })),
      history_observations: read.bundle.history_observations,
      provider_events: read.bundle.provider_events,
    });
    const bundleDigest = archiveSyncDigest(read.bundle);
    const previewDigest = archiveSyncDigest(preview);
    // A partial provider read is useful for diagnosis but not eligible for
    // archive application. The operator can see it, then rerun after the
    // provider condition is resolved without risking a half-reconciled state.
    const hasIncompleteHistory = preview.history_states.some((state) => state.history_coverage === 'history_unknown');
    let reviewPermit: string | null = null;
    if (read.issues.length === 0 && preview.held_events.length === 0 && !hasIncompleteHistory) {
      try { reviewPermit = createArchiveSyncReviewPermit({ bundleDigest, previewDigest }); } catch { /* Preview remains available; Apply stays disabled. */ }
    }
    return NextResponse.json({
      bundle: read.bundle,
      preview,
      reader: { contacts_read: read.contacts_read, issues: read.issues, highlevel_writes: 0 },
      review_permit: reviewPermit,
      receipt: {
        source: 'highlevel', prepared_at: new Date().toISOString(), digest: bundleDigest, preview_digest: previewDigest,
        new_records: preview.proposed_activities.length,
        unchanged_records: preview.history_states.filter((state) => state.history_coverage === 'known_empty').length,
        held_records: preview.held_events.length + read.issues.length,
        unclassified_records: read.issues.filter((issue) => issue.reason === 'unclassified_inbound').length,
        incomplete_records: preview.history_states.filter((state) => state.history_coverage === 'history_unknown').length,
        highlevel_writes: 0, database_writes: 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not prepare the direct archive preview.' }, { status: 422 });
  }
}
