import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state: {
  insertError: { code?: string; message: string } | null;
  inserted: Record<string, unknown>[];
  claims: Array<Record<string, unknown>>;
  completionResult: boolean;
} = {
  insertError: null,
  inserted: [],
  claims: [],
  completionResult: true,
};
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        state.inserted.push(payload);
        return { select: () => ({ single: () => Promise.resolve(state.insertError ? { data: null, error: state.insertError } : { data: { id: 'case-1' }, error: null }) }) };
      },
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'case-existing' }, error: null }) }) }) }),
      update: () => ({ eq: () => ({ eq: () => ({ error: null }) }) }),
    }),
    rpc: (name: string) => ({
      single: () => Promise.resolve({
        data: name === 'complete_voice_call_event_processing' ? state.completionResult : state.claims.shift() ?? null,
        error: null,
      }),
    }),
  },
}));

import { claimVoiceCallEventProcessing, createVoiceRecoveryCase, extractVoiceMessagingConsent, isVoiceDeliveryAttemptDue, recordVoiceCallEvent, redactVoiceWebhookPayload, resolveVoiceCallEventId } from '../voice-recovery';

describe('voice recovery durability', () => {
  beforeEach(() => { state.insertError = null; state.inserted = []; state.claims = []; state.completionResult = true; });

  it('keeps an actual call event distinct from the contact id', () => {
    expect(resolveVoiceCallEventId('event-123', '{"call_id":"contact-123"}')).toBe('event-123');
    expect(resolveVoiceCallEventId(null, '{"call_id":"contact-123"}')).not.toContain('contact-123');
  });

  it('writes a payload hash ledger entry without inventing a contact-based event id', async () => {
    await expect(recordVoiceCallEvent({
      firmId: '11111111-1111-1111-1111-111111111111', ghlCallEventId: 'event-123', ghlContactId: 'contact-123',
      rawWebhookBody: '{"ghl_call_event_id":"event-123"}', payload: { ghl_call_event_id: 'event-123' },
      webhookSignatureMode: 'verified', workflowVersion: 'wf-2', promptVersion: 'prompt-4', schemaVersion: 'schema-1',
    })).resolves.toEqual({ id: 'case-1', duplicate: false });
    expect(state.inserted[0]).toMatchObject({ ghl_call_event_id: 'event-123', ghl_contact_id: 'contact-123', event_id_source: 'ghl', workflow_version: 'wf-2' });
    expect(state.inserted[0].payload_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('redacts accidental credentials before retaining a webhook payload', () => {
    expect(redactVoiceWebhookPayload({ transcript: 'hello', api_token: 'nope', nested: { authorization: 'Bearer no' } }))
      .toEqual({ transcript: 'hello', api_token: '[redacted]', nested: { authorization: '[redacted]' } });
  });

  it('treats a completed receipt as an idempotent success for a duplicate webhook', async () => {
    state.claims.push({ claim_state: 'completed', lease_token: null, lease_expires_at: null, attempt_count: 1, receipt_outcome: 'recovery_case' });
    await expect(claimVoiceCallEventProcessing('event-1')).resolves.toMatchObject({
      claim_state: 'completed', receipt_outcome: 'recovery_case',
    });
  });

  it('keeps a concurrent duplicate in progress while the first worker owns the lease', async () => {
    state.claims.push({ claim_state: 'in_progress', lease_token: 'other-worker', lease_expires_at: '2026-08-17T16:02:00.000Z', attempt_count: 1, receipt_outcome: null });
    await expect(claimVoiceCallEventProcessing('event-2')).resolves.toMatchObject({
      claim_state: 'in_progress', lease_token: 'other-worker',
    });
  });

  it('permits a crash-left unreceipted event to be reacquired after lease expiry', async () => {
    state.claims.push({ claim_state: 'acquired', lease_token: 'retry-worker', lease_expires_at: '2026-08-17T16:04:00.000Z', attempt_count: 2, receipt_outcome: null });
    await expect(claimVoiceCallEventProcessing('event-3')).resolves.toMatchObject({
      claim_state: 'acquired', attempt_count: 2,
    });
  });

  it('rejects a stale worker that lost its lease before terminal receipt creation', async () => {
    state.completionResult = false;
    const { recordVoiceCallReceipt } = await import('../voice-recovery');
    await expect(recordVoiceCallReceipt({
      voiceCallEventId: 'event-4', leaseToken: 'stale-worker', outcome: 'recovery_case', recoveryCaseId: 'case-4',
    })).rejects.toThrow('lease was lost');
  });

  it('does not retry a terminal or future-scheduled delivery', () => {
    const now = new Date('2026-08-17T16:00:00.000Z');
    const base = { id: 'delivery-1', attempts: 0, max_attempts: 5, next_attempt_at: '2026-08-17T15:00:00.000Z' } as const;
    expect(isVoiceDeliveryAttemptDue({ ...base, status: 'queued' }, now)).toBe(true);
    expect(isVoiceDeliveryAttemptDue({ ...base, status: 'sent' }, now)).toBe(false);
    expect(isVoiceDeliveryAttemptDue({ ...base, status: 'queued', next_attempt_at: '2026-08-17T17:00:00.000Z' }, now)).toBe(false);
  });

  it('returns the existing recovery case for a unique-event retry', async () => {
    state.insertError = { code: '23505', message: 'duplicate key' };
    await expect(createVoiceRecoveryCase({
      firmId: '11111111-1111-1111-1111-111111111111', ghlCallEventId: 'event-123', ghlContactId: 'contact-123',
      disposition: 'transcript_partial', urgency: 'normal', callerName: null, nameSource: null,
      observedCallerId: null, transcriptSource: 'none',
    })).resolves.toEqual({ id: 'case-existing', duplicate: true });
  });

  it('records consent only when the caller affirmatively agrees', () => {
    const consent = extractVoiceMessagingConsent('human: Yes, you can text me updates.', new Date('2026-08-17T12:00:00Z'));
    expect(consent).toMatchObject({ smsConsent: true, provenance: 'caller_spoken', at: '2026-08-17T12:00:00.000Z' });
    expect(extractVoiceMessagingConsent('human: No, do not text me.')).toMatchObject({
      smsConsent: false,
      provenance: 'caller_spoken',
    });
    expect(extractVoiceMessagingConsent('bot: May we text you?')).toMatchObject({ smsConsent: null, whatsappConsent: null });
  });
});
