import 'server-only';

import { isArchiveProviderEventShape } from './contract';
import type {
  ArchiveSyncCohortRecord,
  ArchiveSyncHeldEvent,
  ArchiveSyncHistoryObservation,
  ArchiveSyncHistoryState,
  ArchiveSyncPreview,
  ArchiveSyncPreviewInput,
  ArchiveSyncProposedActivity,
  ArchiveSyncProviderEvent,
} from './types';

export * from './types';
export { classifyArchiveEvent, deriveArchiveConversationStatus, validateArchiveSyncScope } from './contract';

const IDENTITY_SEPARATOR = '\u0000';
function contactKey(locationId: string, contactId: string): string { return `${locationId}${IDENTITY_SEPARATOR}${contactId}`; }
function required(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}
function optional(value: string | null | undefined, max: number): string | null { return value?.trim() ? value.trim().slice(0, max) : null; }
function validTime(value: string | null | undefined): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function defaults(event: ArchiveSyncProviderEvent) {
  if (event.kind === 'message_sent') return { delivery_status: 'sent' as const, response_kind: 'none' as const };
  if (event.kind === 'bounce') return { delivery_status: 'bounced' as const, response_kind: 'none' as const };
  if (event.kind === 'human_reply') return { delivery_status: 'unknown' as const, response_kind: 'human' as const };
  if (event.kind === 'automated_reply') return { delivery_status: 'unknown' as const, response_kind: 'automated' as const };
  return { delivery_status: 'unknown' as const, response_kind: 'none' as const };
}
function hold(event: ArchiveSyncProviderEvent, reason: ArchiveSyncHeldEvent['reason']): ArchiveSyncHeldEvent {
  return { provider_event_id: event.provider_event_id, highlevel_location_id: event.highlevel_location_id, highlevel_contact_id: event.highlevel_contact_id, reason };
}

function directoryFor(input: ArchiveSyncPreviewInput): Map<string, ArchiveSyncCohortRecord> {
  const result = new Map<string, ArchiveSyncCohortRecord>();
  const recordIds = new Set<string>();
  for (const record of input.cohort_records) {
    if (!required(record.cls_record_id, 300) || !required(record.highlevel_contact_id, 500) || !required(record.conversation_id, 100)
      || record.highlevel_location_id !== input.highlevel_location_id || !['BA', 'AE', 'KS'].includes(record.arm)) {
      throw new Error('Invalid cohort record supplied to archive sync preview.');
    }
    const key = contactKey(record.highlevel_location_id, record.highlevel_contact_id);
    if (result.has(key) || recordIds.has(record.cls_record_id)) throw new Error('Cohort directory contains a duplicate CLS record ID or HighLevel contact ID.');
    result.set(key, record); recordIds.add(record.cls_record_id);
  }
  return result;
}
function observationsFor(input: ArchiveSyncPreviewInput, directory: ReadonlyMap<string, ArchiveSyncCohortRecord>) {
  const result = new Map<string, ArchiveSyncHistoryObservation>();
  for (const observation of input.history_observations) {
    if (observation.highlevel_location_id !== input.highlevel_location_id || !validTime(observation.observed_at)
      || !['known_empty', 'history_unknown', 'evidenced_activity'].includes(observation.history_coverage)) throw new Error('Invalid provider history observation supplied to archive sync preview.');
    const key = contactKey(observation.highlevel_location_id, observation.highlevel_contact_id);
    if (!directory.has(key)) continue;
    if (result.has(key)) throw new Error('Provider history observation is duplicated for one exact contact.');
    result.set(key, observation);
  }
  return result;
}
function activity(event: ArchiveSyncProviderEvent, record: ArchiveSyncCohortRecord): ArchiveSyncProposedActivity {
  const externalEventId = required(event.provider_event_id, 500);
  if (!externalEventId || (record.arm !== 'BA' && record.arm !== 'AE')) throw new Error('A stable provider event ID and BA/AE arm are required.');
  const fallback = defaults(event);
  return {
    cls_record_id: record.cls_record_id, arm: record.arm, conversation_id: record.conversation_id, kind: event.kind, channel: event.channel,
    occurred_at: new Date(event.occurred_at).toISOString(), subject: optional(event.subject, 1000), body: optional(event.body, 20000),
    from_endpoint: optional(event.from_endpoint, 320), to_endpoints: (event.to_endpoints ?? []).map((value) => value.trim()),
    delivery_status: event.delivery_status ?? fallback.delivery_status, response_kind: event.response_kind ?? fallback.response_kind,
    reply_disposition: event.reply_disposition ?? 'unknown', meeting_outcome: optional(event.meeting_outcome, 2000),
    provenance_system: 'highlevel', external_event_id: externalEventId, idempotency_key: `highlevel:${externalEventId}`,
    provider_observed_at: new Date(event.provider_observed_at).toISOString(),
  };
}

/** Deterministic read-only proposal; no database or HighLevel client is imported here. */
export function buildArchiveSyncPreview(input: ArchiveSyncPreviewInput): ArchiveSyncPreview {
  if (!required(input.highlevel_location_id, 200)) throw new Error('A HighLevel location ID is required for archive sync preview.');
  const directory = directoryFor(input);
  const observations = observationsFor(input, directory);
  const proposedActivities: ArchiveSyncProposedActivity[] = [];
  const heldEvents: ArchiveSyncHeldEvent[] = [];
  const seenEventIds = new Set<string>();
  const evidenceContacts = new Set<string>();
  for (const event of input.provider_events) {
    const eventId = required(event.provider_event_id, 500);
    if (!eventId) { heldEvents.push(hold(event, 'missing_provider_event_id')); continue; }
    if (seenEventIds.has(eventId)) { heldEvents.push(hold(event, 'duplicate_provider_event_id')); continue; }
    seenEventIds.add(eventId);
    if (!isArchiveProviderEventShape(event) || !validTime(event.provider_observed_at)) { heldEvents.push(hold(event, 'invalid_provider_event')); continue; }
    if (event.highlevel_location_id !== input.highlevel_location_id) { heldEvents.push(hold(event, 'unknown_contact')); continue; }
    const key = contactKey(event.highlevel_location_id, event.highlevel_contact_id);
    const record = directory.get(key);
    if (!record) { heldEvents.push(hold(event, 'unknown_contact')); continue; }
    if (record.arm === 'KS') { heldEvents.push(hold(event, 'ks_frozen')); continue; }
    if (!input.ba_ae_allowlist.has(record.cls_record_id)) { heldEvents.push(hold(event, 'not_in_ba_ae_allowlist')); continue; }
    if (observations.get(key)?.history_coverage === 'known_empty') { heldEvents.push(hold(event, 'history_coverage_conflict')); continue; }
    proposedActivities.push(activity(event, record)); evidenceContacts.add(key);
  }
  const historyStates: ArchiveSyncHistoryState[] = input.cohort_records.map((record) => {
    const key = contactKey(record.highlevel_location_id, record.highlevel_contact_id); const observation = observations.get(key);
    if (observation) return { cls_record_id: record.cls_record_id, arm: record.arm, history_coverage: observation.history_coverage, source: 'provider_observation' };
    if (evidenceContacts.has(key)) return { cls_record_id: record.cls_record_id, arm: record.arm, history_coverage: 'evidenced_activity', source: 'provider_event' };
    return { cls_record_id: record.cls_record_id, arm: record.arm, history_coverage: 'history_unknown', source: 'not_observed' };
  });
  return {
    schema_version: 'prospect-archive-sync-preview.v1', provider: 'highlevel', mode: 'read_only_preview',
    safety: { highlevel_writes: 0, database_writes: 0, ks_records_proposed: 0 }, proposed_activities: proposedActivities, held_events: heldEvents, history_states: historyStates,
  };
}
