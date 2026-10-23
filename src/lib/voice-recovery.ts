import 'server-only';

import { createHash } from 'node:crypto';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { VoiceFineBranch, VoiceUrgency } from '@/lib/voice-branch-classifier';
import { decideAttemptOutcome, DEFAULT_MAX_ATTEMPTS } from '@/lib/webhook-outbox-pure';

export type VoiceRecoveryDisposition = Exclude<VoiceFineBranch, 'new_matter'>
  | 'caller_declined'
  | 'incomplete'
  | 'transcript_partial';

export type VoiceRecoveryStatus = 'open' | 'acknowledged' | 'resolved';

export const VOICE_RECOVERY_ACK_SLA_MS: Record<VoiceUrgency, number> = {
  urgent: 15 * 60_000,
  normal: 4 * 60 * 60_000,
};

export function computeVoiceRecoverySlaDueAt(
  urgency: VoiceUrgency,
  createdAt: Date = new Date(),
): string {
  return new Date(createdAt.getTime() + VOICE_RECOVERY_ACK_SLA_MS[urgency]).toISOString();
}

export interface VoiceRecoveryCaseInput {
  firmId: string;
  ghlCallEventId: string;
  ghlContactId: string | null;
  disposition: VoiceRecoveryDisposition;
  urgency: VoiceUrgency;
  callerName: string | null;
  nameSource: string | null;
  observedCallerId: string | null;
  spokenCallbackNumber?: string | null;
  callbackNumberVerified?: boolean;
  smsConsent?: boolean | null;
  whatsappConsent?: boolean | null;
  messagingConsentProvenance?: string | null;
  messagingConsentAt?: string | null;
  messageExcerpt?: string;
  rawTranscript?: string | null;
  transcriptSource: string;
  recordingUrl?: string | null;
  evidence?: Record<string, unknown>;
  alertStatus?: 'pending' | 'sent' | 'failed' | 'not_required';
  deliveryState?: 'not_requested' | 'queued' | 'sent' | 'failed' | 'suppressed';
  slaDueAt?: string | null;
  voiceCallEventId?: string | null;
  recoveryReason?: 'unknown' | 'non_intake' | 'no_contact_provided' | 'technical_failure' | 'no_usable_transcript' | 'disconnected' | 'integration_error';
}

export interface VoiceCallEventInput {
  firmId: string;
  ghlCallEventId: string;
  ghlContactId: string | null;
  rawWebhookBody: string;
  payload: Record<string, unknown>;
  webhookSignatureMode: string;
  integrationMode?: string | null;
  workflowVersion?: string | null;
  promptVersion?: string | null;
  schemaVersion?: string | null;
}

/** Ledger payloads preserve operational evidence but never persist accidental
 * webhook credentials supplied by an upstream workflow. */
export function redactVoiceWebhookPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactVoiceWebhookPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    /(token|secret|authorization|api[_-]?key|password)/i.test(key)
      ? '[redacted]'
      : redactVoiceWebhookPayload(child),
  ]));
}

export async function recordVoiceCallEvent(input: VoiceCallEventInput): Promise<{ id: string; duplicate: boolean }> {
  const payloadSha256 = createHash('sha256').update(input.rawWebhookBody).digest('hex');
  const eventIdSource = input.ghlCallEventId.startsWith('legacy:') ? 'legacy_body_hash' : 'ghl';
  const { data, error } = await supabase
    .from('voice_call_events')
    .insert({
      firm_id: input.firmId,
      ghl_call_event_id: input.ghlCallEventId,
      ghl_contact_id: input.ghlContactId,
      event_id_source: eventIdSource,
      payload_sha256: payloadSha256,
      payload: redactVoiceWebhookPayload(input.payload),
      webhook_signature_mode: input.webhookSignatureMode,
      integration_mode: input.integrationMode ?? null,
      workflow_version: input.workflowVersion ?? null,
      prompt_version: input.promptVersion ?? null,
      schema_version: input.schemaVersion ?? null,
    })
    .select('id')
    .single();
  if (!error && data) return { id: data.id as string, duplicate: false };
  if (error?.code === '23505') {
    const { data: existing, error: existingError } = await supabase
      .from('voice_call_events')
      .select('id')
      .eq('firm_id', input.firmId)
      .eq('ghl_call_event_id', input.ghlCallEventId)
      .maybeSingle();
    if (!existingError && existing) return { id: existing.id as string, duplicate: true };
  }
  throw new Error(error?.message ?? 'voice call ledger insert returned no row');
}

export type VoiceCallEventClaim = {
  claim_state: 'acquired' | 'in_progress' | 'completed';
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number | null;
  receipt_outcome: string | null;
};

/** Obtain the single processing lease for an accepted event. This is an RPC
 * rather than a read-then-write sequence so two webhook deliveries cannot
 * both continue after the ledger row has been inserted. */
export async function claimVoiceCallEventProcessing(
  voiceCallEventId: string,
  leaseSeconds = 120,
): Promise<VoiceCallEventClaim> {
  const { data, error } = await supabase
    .rpc('claim_voice_call_event_processing', {
      p_voice_call_event_id: voiceCallEventId,
      p_lease_seconds: leaseSeconds,
    })
    .single();
  if (error || !data) throw new Error(error?.message ?? 'voice event processing claim returned no row');
  return data as VoiceCallEventClaim;
}

/** Makes a known failed attempt retryable before its lease expires. Crashes
 * need no cleanup: their leases naturally become eligible for reacquisition. */
export async function releaseVoiceCallEventProcessing(args: {
  voiceCallEventId: string;
  leaseToken: string;
  failure: string;
}): Promise<void> {
  const { error } = await supabase
    .from('voice_call_event_processing_claims')
    .update({ status: 'retryable', last_failure: args.failure.slice(0, 1_000) })
    .eq('voice_call_event_id', args.voiceCallEventId)
    .eq('lease_token', args.leaseToken);
  if (error) throw new Error(error.message);
}

export async function recordVoiceCallReceipt(args: {
  voiceCallEventId: string;
  leaseToken: string;
  outcome: 'screened_lead' | 'recovery_case' | 'unconfirmed' | 'duplicate' | 'quarantined' | 'technical_failure' | 'no_usable_transcript' | 'disconnected' | 'integration_error';
  recoveryCaseId?: string | null;
  screenedLeadId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { data, error } = await supabase
    .rpc('complete_voice_call_event_processing', {
      p_voice_call_event_id: args.voiceCallEventId,
      p_lease_token: args.leaseToken,
      p_outcome: args.outcome,
      p_recovery_case_id: args.recoveryCaseId ?? null,
      p_screened_lead_id: args.screenedLeadId ?? null,
      p_detail: args.detail ?? {},
    })
    .single();
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error('voice event processing lease was lost before terminal receipt');
}

export async function appendVoiceRecoveryAuditEvent(args: {
  recoveryCaseId: string;
  voiceCallEventId?: string | null;
  eventType: 'created' | 'acknowledged' | 'assigned' | 'follow_up' | 'resolved' | 'promoted' | 'sla_escalation_queued' | 'sla_escalated' | 'sla_escalation_failed' | 'reconciled';
  actorType: 'system' | 'operator' | 'cron';
  actorId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('voice_recovery_audit_events').insert({
    recovery_case_id: args.recoveryCaseId,
    voice_call_event_id: args.voiceCallEventId ?? null,
    event_type: args.eventType,
    actor_type: args.actorType,
    actor_id: args.actorId ?? null,
    detail: args.detail ?? {},
  });
  if (error) throw new Error(error.message);
}

export interface VoiceDeliveryRow {
  id: string;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
}

export async function enqueueVoiceRecoveryDelivery(args: {
  recoveryCaseId: string;
  recipient: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<{ row: VoiceDeliveryRow; duplicate: boolean }> {
  const { data, error } = await supabase.from('voice_delivery_outbox').insert({
    recovery_case_id: args.recoveryCaseId,
    delivery_type: 'acknowledgement_sla',
    recipient: args.recipient,
    payload: args.payload,
    idempotency_key: args.idempotencyKey,
    max_attempts: DEFAULT_MAX_ATTEMPTS,
  }).select('id, status, attempts, max_attempts, next_attempt_at').single();
  if (!error && data) return { row: data as VoiceDeliveryRow, duplicate: false };
  if (error?.code === '23505') {
    const { data: existing, error: existingError } = await supabase.from('voice_delivery_outbox')
      .select('id, status, attempts, max_attempts, next_attempt_at')
      .eq('idempotency_key', args.idempotencyKey).maybeSingle();
    if (!existingError && existing) return { row: existing as VoiceDeliveryRow, duplicate: true };
  }
  throw new Error(error?.message ?? 'voice delivery enqueue returned no row');
}

export function isVoiceDeliveryAttemptDue(row: VoiceDeliveryRow, now = new Date()): boolean {
  if (row.status === 'sent' || row.status === 'failed' || row.attempts >= row.max_attempts) return false;
  return new Date(row.next_attempt_at).getTime() <= now.getTime();
}

export async function recordVoiceDeliveryAttempt(args: {
  row: VoiceDeliveryRow;
  delivered: boolean;
  providerMessageId?: string | null;
  error?: string | null;
}): Promise<void> {
  const outcome = decideAttemptOutcome({ fired: args.delivered, attempts: args.row.attempts, maxAttempts: args.row.max_attempts });
  const attemptNumber = args.row.attempts + 1;
  const now = new Date();
  const { error: evidenceError } = await supabase.from('voice_delivery_attempts').insert({
    delivery_id: args.row.id,
    attempt_number: attemptNumber,
    outcome: args.delivered ? 'sent' : 'failed',
    provider_message_id: args.providerMessageId ?? null,
    error: args.error ?? null,
    attempted_at: now.toISOString(),
  });
  if (evidenceError) throw new Error(evidenceError.message);
  const update = outcome.next === 'sent'
    ? { status: 'sent', attempts: attemptNumber, sent_at: now.toISOString(), last_error: null }
    : outcome.next === 'failed'
      ? { status: 'failed', attempts: attemptNumber, failed_at: now.toISOString(), last_error: args.error ?? 'delivery failed' }
      : { status: 'queued', attempts: attemptNumber, next_attempt_at: outcome.nextAttemptAt.toISOString(), last_error: args.error ?? 'delivery failed' };
  const { error: updateError } = await supabase.from('voice_delivery_outbox').update(update).eq('id', args.row.id);
  if (updateError) throw new Error(updateError.message);
}

/** True GHL event ids are preferred. The fallback hashes raw webhook bytes,
 * not a contact id, so a retry is idempotent without merging separate calls
 * from the same person. */
export function resolveVoiceCallEventId(
  suppliedEventId: string | undefined | null,
  rawWebhookBody: string,
): string {
  const candidate = (suppliedEventId ?? '').trim();
  if (candidate && !/^\{\{[^{}]+\}\}$/.test(candidate) && !['null', 'undefined', '(null)'].includes(candidate.toLowerCase())) {
    return candidate;
  }
  return `legacy:${createHash('sha256').update(rawWebhookBody).digest('hex')}`;
}

/** Deliberately conservative: only an affirmative caller statement creates a
 * contact-consent record. Silence and bot wording remain unknown. */
export function extractVoiceMessagingConsent(transcript: string, now = new Date()): {
  smsConsent: boolean | null;
  whatsappConsent: boolean | null;
  provenance: string | null;
  at: string | null;
} {
  const callerLines = (transcript ?? '')
    .split(/\r?\n/)
    .filter((line) => /^(human|caller|user|client)\s*:/i.test(line))
    .join(' ');
  const text = (callerLines || transcript || '').toLowerCase();
  const smsDeclined = /\b(no|not|don't|do not|never|stop)\b[^.]{0,40}\b(text|sms|message)\b/.test(text);
  const whatsappDeclined = /\b(no|not|don't|do not|never|stop)\b[^.]{0,40}\bwhatsapp\b/.test(text);
  const smsAccepted = !smsDeclined
    && /\b(yes|yeah|sure|please)\b[^.]{0,60}\b(text|sms|message)\b|\b(?:please\s+)?(?:text|sms) me\b/.test(text);
  const whatsappAccepted = !whatsappDeclined
    && /\b(yes|yeah|sure|please)\b[^.]{0,60}\bwhatsapp\b|\b(?:please\s+)?whatsapp me\b/.test(text);
  if (!smsAccepted && !smsDeclined && !whatsappAccepted && !whatsappDeclined) {
    return { smsConsent: null, whatsappConsent: null, provenance: null, at: null };
  }
  return {
    smsConsent: smsDeclined ? false : smsAccepted ? true : null,
    whatsappConsent: whatsappDeclined ? false : whatsappAccepted ? true : null,
    provenance: 'caller_spoken',
    at: now.toISOString(),
  };
}

/**
 * Insert once per firm + true GHL call event.  A duplicate is a successful
 * webhook retry, returned to the caller as the existing case.
 */
export async function createVoiceRecoveryCase(input: VoiceRecoveryCaseInput): Promise<{
  id: string;
  duplicate: boolean;
}> {
  const payload = {
    firm_id: input.firmId,
    ghl_call_event_id: input.ghlCallEventId,
    ghl_contact_id: input.ghlContactId,
    disposition: input.disposition,
    urgency: input.urgency,
    caller_name: input.callerName,
    name_source: input.nameSource,
    observed_caller_id: input.observedCallerId,
    spoken_callback_number: input.spokenCallbackNumber ?? null,
    callback_number_verified: input.callbackNumberVerified ?? false,
    sms_consent: input.smsConsent ?? null,
    whatsapp_consent: input.whatsappConsent ?? null,
    messaging_consent_provenance: input.messagingConsentProvenance ?? null,
    messaging_consent_at: input.messagingConsentAt ?? null,
    message_excerpt: input.messageExcerpt ?? '',
    raw_transcript: input.rawTranscript ?? null,
    transcript_source: input.transcriptSource,
    recording_url: input.recordingUrl ?? null,
    evidence: input.evidence ?? {},
    alert_status: input.alertStatus ?? 'pending',
    delivery_state: input.deliveryState ?? 'not_requested',
    sla_due_at: input.slaDueAt ?? computeVoiceRecoverySlaDueAt(input.urgency),
    recovery_reason: input.recoveryReason ?? 'unknown',
  };
  const { data, error } = await supabase
    .from('voice_recovery_cases')
    .insert(payload)
    .select('id')
    .single();
  if (!error && data) {
    await appendVoiceRecoveryAuditEvent({
      recoveryCaseId: data.id as string,
      voiceCallEventId: input.voiceCallEventId ?? null,
      eventType: 'created',
      actorType: 'system',
      detail: { disposition: input.disposition, urgency: input.urgency, transcript_source: input.transcriptSource },
    });
    return { id: data.id as string, duplicate: false };
  }

  if (error?.code === '23505') {
    const { data: existing, error: existingError } = await supabase
      .from('voice_recovery_cases')
      .select('id')
      .eq('firm_id', input.firmId)
      .eq('ghl_call_event_id', input.ghlCallEventId)
      .maybeSingle();
    if (!existingError && existing) return { id: existing.id as string, duplicate: true };
  }
  throw new Error(error?.message ?? 'voice recovery case insert returned no row');
}
