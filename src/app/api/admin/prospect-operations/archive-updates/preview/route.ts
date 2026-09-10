import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { getOperatorSession } from '@/lib/portal-auth';
import { buildArchiveSyncPreview, type ArchiveSyncHistoryObservation, type ArchiveSyncProviderEvent } from '@/lib/prospect-archive-sync';
import { listProspectingControlPlaneSources } from '@/lib/prospect-source-registry';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 5_000;
const MAX_OBSERVATIONS = 200;
const BUNDLE_SCHEMA = 'prospect-archive-sync-bundle.v1';

type Bundle = {
  schema_version: typeof BUNDLE_SCHEMA;
  highlevel_location_id: string;
  provider_events: ArchiveSyncProviderEvent[];
  history_observations: ArchiveSyncHistoryObservation[];
};

function asBundle(value: unknown): Bundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const bundle = value as Record<string, unknown>;
  if (Object.keys(bundle).some((key) => !['schema_version', 'highlevel_location_id', 'provider_events', 'history_observations'].includes(key))) return null;
  if (bundle.schema_version !== BUNDLE_SCHEMA || typeof bundle.highlevel_location_id !== 'string' || !bundle.highlevel_location_id.trim()) return null;
  if (!Array.isArray(bundle.provider_events) || bundle.provider_events.length > MAX_EVENTS) return null;
  if (!Array.isArray(bundle.history_observations) || bundle.history_observations.length > MAX_OBSERVATIONS) return null;
  return bundle as Bundle;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Operator-only, upload-backed preview. It deliberately has no HighLevel
 * client and makes no canonical database writes. The server derives the
 * allowable BA/AE identities from the immutable source registry rather than
 * accepting them from the browser or upload bundle.
 */
export async function POST(request: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'History bundle is too large for a safe preview.' }, { status: 413 });
  }

  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Invalid history bundle JSON.' }, { status: 400 }); }
  const bundle = asBundle(payload);
  if (!bundle) return NextResponse.json({ error: `Bundle must use ${BUNDLE_SCHEMA} with supported history fields only.` }, { status: 400 });

  try {
    const sourcePage = await listProspectingControlPlaneSources({ page: 1, pageSize: 100 });
    const records = sourcePage.records.filter((record) => record.arm === 'BA' || record.arm === 'AE');
    if (sourcePage.total !== 100 || records.length !== 100) throw new Error('The required 100 BA/AE source records are not currently available for archive preview. Reconcile provisioning first.');
    const locationIds = new Set(records.map((record) => record.highLevel.locationId).filter((value): value is string => Boolean(value)));
    if (locationIds.size !== 1 || !locationIds.has(bundle.highlevel_location_id)) throw new Error('Bundle location does not match the authoritative BA/AE source registry.');
    if (records.some((record) => !record.highLevel.contactId || !record.conversation?.id)) throw new Error('One or more BA/AE source records lack a verified HighLevel contact or local conversation. Reconcile provisioning first.');

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
    const historyUnknown = preview.history_states.filter((state) => state.history_coverage === 'history_unknown').length;
    return NextResponse.json({
      preview,
      receipt: {
        source: 'import', schema_version: BUNDLE_SCHEMA, digest: digest(bundle), prepared_at: new Date().toISOString(),
        new_records: preview.proposed_activities.length,
        unchanged_records: preview.history_states.filter((state) => state.history_coverage === 'known_empty').length,
        held_records: preview.held_events.length,
        unclassified_records: preview.held_events.filter((event) => event.reason === 'invalid_provider_event').length,
        incomplete_records: historyUnknown, highlevel_writes: 0, database_writes: 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not prepare archive preview.' }, { status: 422 });
  }
}
