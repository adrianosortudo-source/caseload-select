import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state: { insertError: { code?: string; message: string } | null; inserted: Record<string, unknown>[] } = {
  insertError: null,
  inserted: [],
};
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        state.inserted.push(payload);
        return { select: () => ({ single: () => Promise.resolve(state.insertError ? { data: null, error: state.insertError } : { data: { id: 'case-1' }, error: null }) }) };
      },
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'case-existing' }, error: null }) }) }) }),
    }),
  },
}));

import { createVoiceRecoveryCase, extractVoiceMessagingConsent, resolveVoiceCallEventId } from '../voice-recovery';

describe('voice recovery durability', () => {
  beforeEach(() => { state.insertError = null; state.inserted = []; });

  it('keeps an actual call event distinct from the contact id', () => {
    expect(resolveVoiceCallEventId('event-123', '{"call_id":"contact-123"}')).toBe('event-123');
    expect(resolveVoiceCallEventId(null, '{"call_id":"contact-123"}')).not.toContain('contact-123');
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
