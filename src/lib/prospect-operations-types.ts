/** Shared outbound-contact operations vocabulary. */

export const PROSPECT_CONVERSATION_STATUSES = [
  'not_contacted',
  'awaiting_reply',
  'replied',
  'unreachable',
  'declined',
  'meeting_scheduled',
  'completed',
] as const;
export type ProspectConversationStatus = (typeof PROSPECT_CONVERSATION_STATUSES)[number];

export const PROSPECT_ACTIVITY_KINDS = [
  'message_sent',
  'human_reply',
  'automated_reply',
  'bounce',
  'call',
  'meeting',
  'note',
] as const;
export type ProspectActivityKind = (typeof PROSPECT_ACTIVITY_KINDS)[number];

export const PROSPECT_ACTIVITY_CHANNELS = ['email', 'linkedin', 'phone', 'video', 'other'] as const;
export type ProspectActivityChannel = (typeof PROSPECT_ACTIVITY_CHANNELS)[number];

export const PROSPECT_ACTIVITY_DIRECTIONS = ['outbound', 'inbound', 'internal'] as const;
export type ProspectActivityDirection = (typeof PROSPECT_ACTIVITY_DIRECTIONS)[number];

export const PROSPECT_DELIVERY_STATUSES = ['unknown', 'sent', 'delivered', 'bounced', 'failed'] as const;
export type ProspectDeliveryStatus = (typeof PROSPECT_DELIVERY_STATUSES)[number];

export const PROSPECT_RESPONSE_KINDS = ['none', 'human', 'automated'] as const;
export type ProspectResponseKind = (typeof PROSPECT_RESPONSE_KINDS)[number];

export const PROSPECT_REPLY_DISPOSITIONS = ['unknown', 'positive', 'neutral', 'declined'] as const;
export type ProspectReplyDisposition = (typeof PROSPECT_REPLY_DISPOSITIONS)[number];

export const PROSPECT_HISTORY_COVERAGE = ['known_empty', 'history_unknown', 'evidenced_activity'] as const;
export type ProspectHistoryCoverage = (typeof PROSPECT_HISTORY_COVERAGE)[number];

export const PROSPECT_CONTACTABILITY_STATES = ['unknown', 'eligible', 'suppressed'] as const;
export type ProspectContactabilityState = (typeof PROSPECT_CONTACTABILITY_STATES)[number];

export const PROSPECT_IDENTITY_ADJUDICATION_DECISIONS = ['confirmed_link', 'rejected'] as const;
export type ProspectIdentityAdjudicationDecision = (typeof PROSPECT_IDENTITY_ADJUDICATION_DECISIONS)[number];

export interface ProspectActivity {
  id: string;
  conversation_id: string;
  kind: ProspectActivityKind;
  channel: ProspectActivityChannel;
  direction: ProspectActivityDirection;
  occurred_at: string;
  subject: string | null;
  body: string | null;
  from_endpoint: string | null;
  to_endpoints: string[];
  delivery_status: ProspectDeliveryStatus;
  response_kind: ProspectResponseKind;
  reply_disposition: ProspectReplyDisposition;
  meeting_outcome: string | null;
  provenance_system: string;
  external_event_id: string | null;
  idempotency_key: string;
  created_by_operator_id: string | null;
  created_at: string;
}

export interface ProspectConversation {
  id: string;
  organization_id: string;
  person_id: string | null;
  status: ProspectConversationStatus;
  next_action: string | null;
  next_action_due: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProspectConversationSummary extends ProspectConversation {
  organization_name: string;
  person_name: string | null;
  person_email: string | null;
  contactability: ProspectContactabilityState;
  suppression_reason: string | null;
  history_coverage: ProspectHistoryCoverage;
  activities: ProspectActivity[];
}

export interface ProspectSourceContactState {
  source_system: string;
  source_record_key: string;
  conversation_id: string;
  status: ProspectConversationStatus;
  contactability: 'unknown' | 'eligible' | 'suppressed';
  last_activity_at: string | null;
  next_action: string | null;
  next_action_due: string | null;
  history_coverage: ProspectHistoryCoverage;
}

/**
 * An operator-recorded identity decision for one immutable source record.
 * It is an overlay, not a merge: source links and outreach history stay put.
 */
export interface ProspectIdentityAdjudication {
  id: string;
  source_link_id: string;
  decision: ProspectIdentityAdjudicationDecision;
  canonical_organization_id: string;
  canonical_person_id: string | null;
  adjudication_basis: string;
  evidence_url: string | null;
  idempotency_key: string;
  reviewed_by_operator_id: string;
  created_at: string;
}

export interface ProspectIdentityResolution {
  source_link_id: string;
  adjudication_id: string;
  canonical_organization_id: string;
  canonical_person_id: string | null;
  confirmed_at: string;
}

export interface CreateProspectActivityInput {
  conversation_id: string;
  kind: ProspectActivityKind;
  channel: ProspectActivityChannel;
  occurred_at?: string;
  subject?: string | null;
  body?: string | null;
  from_endpoint?: string | null;
  to_endpoints?: string[];
  delivery_status?: ProspectDeliveryStatus;
  response_kind?: ProspectResponseKind;
  reply_disposition?: ProspectReplyDisposition;
  meeting_outcome?: string | null;
  external_event_id?: string | null;
  idempotency_key: string;
}

export interface CreateProspectIdentityAdjudicationInput {
  source_link_id: string;
  decision: ProspectIdentityAdjudicationDecision;
  canonical_organization_id: string;
  canonical_person_id?: string | null;
  adjudication_basis: string;
  evidence_url?: string | null;
  idempotency_key: string;
}

/** Contact controls do not set a conversation outcome; activity does that. */
export interface UpdateProspectConversationContactControlsInput {
  contactability?: ProspectContactabilityState;
  suppression_reason?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
}

export interface ProspectConversationContactControls {
  conversation: ProspectConversation;
  contactability: {
    state: ProspectContactabilityState;
    reason: string | null;
    suppressed_at: string | null;
    suppressed_by_operator_id: string | null;
    reviewed_at: string | null;
  };
}

/** First-party evidence used to create one new, independent source bridge. */
export interface ProvisionProspectSourceRecordInput {
  source_system: string;
  source_record_key: string;
  source_url: string;
  source_payload: Record<string, unknown>;
  organization: {
    display_name: string;
    city?: string | null;
    website_url?: string | null;
  };
  person?: {
    display_name: string;
    primary_email?: string | null;
    primary_phone?: string | null;
    role_title?: string | null;
  } | null;
  /** Operator explanation for why the supplied first-party source is reliable. */
  basis: string;
  idempotency_key: string;
}

export interface ProspectSourceProvisionResult {
  source_link_id: string;
  conversation_id: string;
}

export interface ProspectContactReport {
  as_of: string;
  conversations: number;
  unique_firms: number;
  unique_people: number;
  eligible_conversations: number;
  suppressed_conversations: number;
  unknown_contactability: number;
  not_contacted: number;
  awaiting_reply: number;
  replied: number;
  unreachable: number;
  declined: number;
  meeting_scheduled: number;
  completed: number;
  messages_sent: number;
  human_replies: number;
  automated_replies: number;
  bounces: number;
  meetings: number;
}

export function isProspectConversationStatus(value: unknown): value is ProspectConversationStatus {
  return typeof value === 'string' && (PROSPECT_CONVERSATION_STATUSES as readonly string[]).includes(value);
}

export function isProspectActivityKind(value: unknown): value is ProspectActivityKind {
  return typeof value === 'string' && (PROSPECT_ACTIVITY_KINDS as readonly string[]).includes(value);
}

export function isProspectActivityChannel(value: unknown): value is ProspectActivityChannel {
  return typeof value === 'string' && (PROSPECT_ACTIVITY_CHANNELS as readonly string[]).includes(value);
}

export function isProspectDeliveryStatus(value: unknown): value is ProspectDeliveryStatus {
  return typeof value === 'string' && (PROSPECT_DELIVERY_STATUSES as readonly string[]).includes(value);
}

export function isProspectResponseKind(value: unknown): value is ProspectResponseKind {
  return typeof value === 'string' && (PROSPECT_RESPONSE_KINDS as readonly string[]).includes(value);
}

export function isProspectReplyDisposition(value: unknown): value is ProspectReplyDisposition {
  return typeof value === 'string' && (PROSPECT_REPLY_DISPOSITIONS as readonly string[]).includes(value);
}

export function isProspectIdentityAdjudicationDecision(value: unknown): value is ProspectIdentityAdjudicationDecision {
  return typeof value === 'string' && (PROSPECT_IDENTITY_ADJUDICATION_DECISIONS as readonly string[]).includes(value);
}

export function isProspectContactabilityState(value: unknown): value is ProspectContactabilityState {
  return typeof value === 'string' && (PROSPECT_CONTACTABILITY_STATES as readonly string[]).includes(value);
}

export function isProspectOperationsUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * Derive only the status supported by an explicitly logged event. An automated
 * acknowledgement is never a human reply; a historic pipeline stage is never
 * silently converted into a contact event.
 */
export function statusAfterActivity(
  current: ProspectConversationStatus,
  input: Pick<CreateProspectActivityInput, 'kind' | 'reply_disposition'>,
): ProspectConversationStatus {
  if (input.kind === 'message_sent') return 'awaiting_reply';
  if (input.kind === 'bounce') return 'unreachable';
  if (input.kind === 'human_reply') return input.reply_disposition === 'declined' ? 'declined' : 'replied';
  if (input.kind === 'meeting') return 'meeting_scheduled';
  return current;
}
