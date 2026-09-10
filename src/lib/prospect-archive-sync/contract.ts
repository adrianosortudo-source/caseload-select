import {
  isProspectActivityChannel,
  isProspectActivityKind,
  isProspectDeliveryStatus,
  isProspectReplyDisposition,
  isProspectResponseKind,
  statusAfterActivity,
  type ProspectActivityKind,
  type ProspectConversationStatus,
  type ProspectDeliveryStatus,
  type ProspectResponseKind,
} from '@/lib/prospect-operations-types';

export interface ArchiveSyncScope {
  arm: 'BA' | 'AE';
  cls_record_id: string;
  highlevel_location_id: string;
  highlevel_contact_id: string;
  allowed_method: 'GET';
  preview_token: string;
  preview_expires_at: string;
}

export interface ArchiveSyncScopeCheck {
  ok: boolean;
  reason: string | null;
}

export interface ClassifiedArchiveEvent {
  classification: 'accepted' | 'unclassified';
  kind: ProspectActivityKind | null;
  response_kind: ProspectResponseKind | null;
  delivery_status: ProspectDeliveryStatus | null;
  external_event_id: string | null;
  idempotency_key: string | null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
}

/**
 * Classifies only explicit provider facts. Inbound mail without a durable
 * provider classification stays unclassified; it is never promoted to a human
 * reply merely because it has content.
 */
export function classifyArchiveEvent(raw: unknown): ClassifiedArchiveEvent {
  if (!raw || typeof raw !== 'object') {
    return { classification: 'unclassified', kind: null, response_kind: null, delivery_status: null, external_event_id: null, idempotency_key: null };
  }
  const value = raw as Record<string, unknown>;
  const externalEventId = text(value.provider_event_id ?? value.external_event_id ?? value.id, 500);
  if (!externalEventId) {
    return { classification: 'unclassified', kind: null, response_kind: null, delivery_status: null, external_event_id: null, idempotency_key: null };
  }
  const direction = typeof value.direction === 'string' ? value.direction.trim().toLowerCase() : null;
  const explicitKind = value.kind;
  const kind = isProspectActivityKind(explicitKind) ? explicitKind : null;
  const body = typeof value.body === 'string' ? value.body : '';
  const subject = typeof value.subject === 'string' ? value.subject : '';
  const providerAutomation = value.automation_indicator === true || value.is_automated === true
    || /out of (?:the )?office|automatic reply|auto[- ]?reply|autoreply/i.test(`${subject}\n${body}`);
  const candidateKind = kind
    ?? (direction === 'outbound' ? 'message_sent'
      : (direction === 'inbound' && providerAutomation ? 'automated_reply' : null));
  if (!candidateKind) {
    return { classification: 'unclassified', kind: null, response_kind: null, delivery_status: null, external_event_id: externalEventId, idempotency_key: null };
  }
  const defaultResponse: ProspectResponseKind = candidateKind === 'human_reply'
    ? 'human'
    : candidateKind === 'automated_reply' ? 'automated' : 'none';
  const defaultDelivery: ProspectDeliveryStatus = candidateKind === 'message_sent'
    ? 'sent'
    : candidateKind === 'bounce' ? 'bounced' : 'unknown';
  const responseKind = value.response_kind === undefined ? defaultResponse : value.response_kind;
  const deliveryStatus = value.delivery_status === undefined ? defaultDelivery : value.delivery_status;
  if (!isProspectResponseKind(responseKind) || !isProspectDeliveryStatus(deliveryStatus)) {
    return { classification: 'unclassified', kind: null, response_kind: null, delivery_status: null, external_event_id: externalEventId, idempotency_key: null };
  }
  if (candidateKind === 'human_reply' && responseKind !== 'human') {
    return { classification: 'unclassified', kind: null, response_kind: null, delivery_status: null, external_event_id: externalEventId, idempotency_key: null };
  }
  if (candidateKind === 'automated_reply' && responseKind !== 'automated') {
    return { classification: 'unclassified', kind: null, response_kind: null, delivery_status: null, external_event_id: externalEventId, idempotency_key: null };
  }
  return {
    classification: 'accepted',
    kind: candidateKind,
    response_kind: responseKind,
    delivery_status: deliveryStatus,
    external_event_id: externalEventId,
    idempotency_key: `prospect-archive-sync:highlevel:${externalEventId}`,
  };
}

/** Later provider delivery evidence cannot erase a confirmed reply or meeting. */
export function deriveArchiveConversationStatus(
  current: ProspectConversationStatus,
  event: Pick<ClassifiedArchiveEvent, 'kind'> & { reply_disposition?: unknown },
): ProspectConversationStatus {
  if (!event.kind) return current;
  if (event.kind === 'message_sent' && ['replied', 'meeting_scheduled', 'completed', 'declined', 'unreachable'].includes(current)) {
    return current;
  }
  const replyDisposition = isProspectReplyDisposition(event.reply_disposition) ? event.reply_disposition : 'unknown';
  return statusAfterActivity(current, { kind: event.kind, reply_disposition: replyDisposition });
}

/**
 * Verifies a previously minted, read-only preview scope. It rejects KS and
 * non-BA/AE payloads before provider data can reach any writer.
 */
function scopeCheckForApply(value: Record<string, unknown>): ArchiveSyncScopeCheck {
  const fixedLocation = 'xXhW340nWLAJhOPzLbAA';
  if (value.method !== 'POST' || value.location_id !== fixedLocation) return { ok: false, reason: 'location_or_method' };
  if (!text(value.preview_id, 500) || typeof value.preview_generated_at !== 'string') return { ok: false, reason: 'preview_id_or_time' };
  const generated = Date.parse(value.preview_generated_at);
  const now = typeof value.now === 'string' ? Date.parse(value.now) : NaN;
  const maxAge = typeof value.max_preview_age_ms === 'number' ? value.max_preview_age_ms : NaN;
  if (!Number.isFinite(generated) || !Number.isFinite(now) || !Number.isFinite(maxAge) || maxAge <= 0 || now - generated > maxAge || now < generated) {
    return { ok: false, reason: 'stale_preview' };
  }
  if (!Array.isArray(value.records) || value.records.length === 0) return { ok: false, reason: 'records' };
  const allowlist = Array.isArray(value.ba_ae_allowlist)
    ? new Set(value.ba_ae_allowlist.filter((item): item is string => typeof item === 'string'))
    : null;
  for (const record of value.records) {
    if (!record || typeof record !== 'object') return { ok: false, reason: 'record_shape' };
    const row = record as Record<string, unknown>;
    const id = text(row.cls_record_id, 300);
    if ((row.arm !== 'BA' && row.arm !== 'AE') || !id || !text(row.ghl_contact_id, 500)) return { ok: false, reason: 'record_scope' };
    // A real call supplies the immutable BA/AE allowlist. The strict CLS form
    // is only a pure-contract fallback and is not a substitute for that input.
    if (allowlist ? !allowlist.has(id) : !/^(BA|AE)-B1-\d{2}$/.test(id)) return { ok: false, reason: 'not_allowlisted' };
  }
  return { ok: true, reason: null };
}

export function validateArchiveSyncScope(
  value: unknown,
  expectedHighLevelLocationId: string,
  now?: Date,
): value is ArchiveSyncScope;
export function validateArchiveSyncScope(value: unknown): ArchiveSyncScopeCheck;
export function validateArchiveSyncScope(
  value: unknown,
  expectedHighLevelLocationId?: string,
  now = new Date(),
): boolean | ArchiveSyncScopeCheck {
  if (!value || typeof value !== 'object') return expectedHighLevelLocationId === undefined ? { ok: false, reason: 'scope' } : false;
  const scope = value as Record<string, unknown>;
  if (expectedHighLevelLocationId === undefined) return scopeCheckForApply(scope);
  if (!text(expectedHighLevelLocationId, 200)) return false;
  if (scope.arm !== 'BA' && scope.arm !== 'AE') return false;
  if (!text(scope.cls_record_id, 300) || !text(scope.highlevel_contact_id, 500)) return false;
  if (scope.highlevel_location_id !== expectedHighLevelLocationId || scope.allowed_method !== 'GET') return false;
  if (!text(scope.preview_token, 500) || typeof scope.preview_expires_at !== 'string') return false;
  const expiry = Date.parse(scope.preview_expires_at);
  return Number.isFinite(expiry) && expiry > now.getTime();
}

/** Receipts retain operational counts and immutable IDs only, never message content or endpoints. */
export function summarizeArchiveSyncReceipt(value: unknown): {
  schema_version: 'prospect-archive-sync-receipt.v1';
  preview_id: string | null;
  record_ids: string[];
  event_ids: string[];
  records: number;
  events: number;
} {
  const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const recordIds = Array.isArray(payload.records) ? payload.records.flatMap((record) => {
    if (!record || typeof record !== 'object') return [];
    const id = text((record as Record<string, unknown>).cls_record_id, 300);
    return id ? [id] : [];
  }) : [];
  const eventIds = Array.isArray(payload.events) ? payload.events.flatMap((event) => {
    if (!event || typeof event !== 'object') return [];
    const id = text((event as Record<string, unknown>).external_event_id, 500);
    return id ? [id] : [];
  }) : [];
  return {
    schema_version: 'prospect-archive-sync-receipt.v1',
    preview_id: text(payload.preview_id, 500),
    record_ids: [...new Set(recordIds)],
    event_ids: [...new Set(eventIds)],
    records: new Set(recordIds).size,
    events: new Set(eventIds).size,
  };
}

/** Shared validator used by the preview builder before it proposes an event. */
export function isArchiveProviderEventShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return isProspectActivityKind(event.kind)
    && isProspectActivityChannel(event.channel)
    && typeof event.occurred_at === 'string'
    && Number.isFinite(Date.parse(event.occurred_at))
    && typeof event.provider_observed_at === 'string'
    && Number.isFinite(Date.parse(event.provider_observed_at))
    && (event.delivery_status === undefined || isProspectDeliveryStatus(event.delivery_status))
    && (event.response_kind === undefined || isProspectResponseKind(event.response_kind));
}
