import 'server-only';

import { createHash } from 'node:crypto';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { VoiceFineBranch, VoiceUrgency } from '@/lib/voice-branch-classifier';

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
  };
  const { data, error } = await supabase
    .from('voice_recovery_cases')
    .insert(payload)
    .select('id')
    .single();
  if (!error && data) return { id: data.id as string, duplicate: false };

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
