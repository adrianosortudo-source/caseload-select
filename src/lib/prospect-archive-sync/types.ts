import type {
  ProspectActivityChannel,
  ProspectActivityKind,
  ProspectDeliveryStatus,
  ProspectHistoryCoverage,
  ProspectReplyDisposition,
  ProspectResponseKind,
} from '@/lib/prospect-operations-types';

/** This data contract never accepts credentials or performs provider writes. */
export const ARCHIVE_SYNC_PROVIDER = 'highlevel' as const;
export type ArchiveSyncProvider = typeof ARCHIVE_SYNC_PROVIDER;
export type ArchiveSyncArm = 'BA' | 'AE' | 'KS';
export type ArchiveSyncEligibleArm = Exclude<ArchiveSyncArm, 'KS'>;

/** Exact (location, contact) keys are the sole matching inputs. */
export interface ArchiveSyncCohortRecord {
  cls_record_id: string;
  arm: ArchiveSyncArm;
  highlevel_location_id: string;
  highlevel_contact_id: string;
  conversation_id: string;
}

export interface ArchiveSyncHistoryObservation {
  highlevel_location_id: string;
  highlevel_contact_id: string;
  history_coverage: ProspectHistoryCoverage;
  observed_at: string;
}

/** provider_event_id must come directly from HighLevel; no synthetic fallback. */
export interface ArchiveSyncProviderEvent {
  provider_event_id: string | null;
  highlevel_location_id: string;
  highlevel_contact_id: string;
  kind: ProspectActivityKind;
  channel: ProspectActivityChannel;
  occurred_at: string;
  subject?: string | null;
  body?: string | null;
  from_endpoint?: string | null;
  to_endpoints?: readonly string[];
  delivery_status?: ProspectDeliveryStatus;
  response_kind?: ProspectResponseKind;
  reply_disposition?: ProspectReplyDisposition;
  meeting_outcome?: string | null;
  provider_observed_at: string;
}

export type ArchiveSyncHoldReason =
  | 'missing_provider_event_id'
  | 'invalid_provider_event'
  | 'unknown_contact'
  | 'ks_frozen'
  | 'not_in_ba_ae_allowlist'
  | 'history_coverage_conflict'
  | 'duplicate_provider_event_id';

export interface ArchiveSyncProposedActivity {
  cls_record_id: string;
  arm: ArchiveSyncEligibleArm;
  conversation_id: string;
  kind: ProspectActivityKind;
  channel: ProspectActivityChannel;
  occurred_at: string;
  subject: string | null;
  body: string | null;
  from_endpoint: string | null;
  to_endpoints: string[];
  delivery_status: ProspectDeliveryStatus;
  response_kind: ProspectResponseKind;
  reply_disposition: ProspectReplyDisposition;
  meeting_outcome: string | null;
  provenance_system: ArchiveSyncProvider;
  external_event_id: string;
  idempotency_key: string;
  provider_observed_at: string;
}

export interface ArchiveSyncHeldEvent {
  provider_event_id: string | null;
  highlevel_location_id: string;
  highlevel_contact_id: string;
  reason: ArchiveSyncHoldReason;
}

export interface ArchiveSyncHistoryState {
  cls_record_id: string;
  arm: ArchiveSyncArm;
  history_coverage: ProspectHistoryCoverage;
  source: 'provider_observation' | 'provider_event' | 'not_observed';
}

export interface ArchiveSyncPreviewInput {
  highlevel_location_id: string;
  /** Injected BA/AE IDs; the data contract cannot grow this cohort. */
  ba_ae_allowlist: ReadonlySet<string>;
  /** KS is included solely to make the frozen hold explicit. */
  cohort_records: readonly ArchiveSyncCohortRecord[];
  history_observations: readonly ArchiveSyncHistoryObservation[];
  provider_events: readonly ArchiveSyncProviderEvent[];
}

export interface ArchiveSyncPreview {
  schema_version: 'prospect-archive-sync-preview.v1';
  provider: ArchiveSyncProvider;
  mode: 'read_only_preview';
  safety: { highlevel_writes: 0; database_writes: 0; ks_records_proposed: 0 };
  proposed_activities: ArchiveSyncProposedActivity[];
  held_events: ArchiveSyncHeldEvent[];
  history_states: ArchiveSyncHistoryState[];
}
