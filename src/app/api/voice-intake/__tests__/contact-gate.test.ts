/**
 * Voice intake contact-capture gate (2026-05-15, Phase D).
 *
 * Voice almost always passes the doctrine: caller ID auto-seeds
 * client_phone and the GHL Voice AI captures the lead's name during
 * the call. The cases this test covers:
 *
 *   - Caller phone + caller name → gate passes → screened_leads insert.
 *   - Caller phone only (blocked caller-ID name OR Voice AI failed to
 *     capture name) → gate fails on `missing=name` → unconfirmed_inquiry.
 *
 * The stretch goal of SMS-back follow-up to the caller's number is out
 * of scope for this iteration; voice falls into the same single-shot
 * unconfirmed_inquiries path as a misconfigured Meta channel until SMS
 * follow-up is wired (separate doctrine task).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

interface CapturedInsert {
  table: string;
  payload: Record<string, unknown>;
}
const captured: { inserts: CapturedInsert[] } = { inserts: [] };

vi.mock('@/lib/supabase-admin', () => {
  const makeChain = (table: string) => ({
    select: (_cols: string) => makeChain(table),
    eq: (_field: string, _v: unknown) => makeChain(table),
    maybeSingle: () =>
      Promise.resolve(
        table === 'intake_firms'
          ? { data: { id: '11111111-1111-1111-1111-111111111111' }, error: null }
          : { data: null, error: null },
      ),
    single: () => Promise.resolve({ data: null, error: null }),
    insert: (payload: Record<string, unknown>) => {
      captured.inserts.push({ table, payload });
      return {
        select: (_cols: string) => ({
          single: () =>
            Promise.resolve({
              data: {
                id: 'row-uuid',
                lead_id: payload.lead_id,
                status: payload.status,
                decision_deadline: payload.decision_deadline,
                whale_nurture: payload.whale_nurture,
              },
              error: null,
            }),
        }),
      };
    },
  });
  return {
    supabaseAdmin: { from: (table: string) => makeChain(table) },
  };
});

vi.mock('@/lib/lead-notify', () => ({
  notifyLawyersOfNewLead: vi.fn(() => Promise.resolve()),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    void p.catch(() => undefined);
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() =>
    Promise.resolve({ ok: true, active: false, remaining: 30, reset: 0, limit: 30 }),
  ),
  ipFromRequest: vi.fn(() => '203.0.113.1'),
  rateLimitHeaders: vi.fn(() => ({})),
}));

vi.mock('@/lib/voice-webhook-auth', () => ({
  VOICE_SIGNATURE_HEADER: 'x-cls-voice-signature',
  verifyVoiceWebhookSignature: vi.fn(() => Promise.resolve({ mode: 'soft_open', reason: 'not_required' })),
  shouldRejectVoiceRequest: vi.fn(() => ({ reject: false })),
  isHmacRequired: vi.fn(() => false),
}));

vi.mock('@/lib/screen-llm-server', () => ({
  llmExtractServer: vi.fn(() => Promise.resolve({ mode: 'mock', extracted: {} })),
}));

import { POST } from '../route';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://app.caseloadselect.ca/api/voice-intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  captured.inserts = [];
});

describe('/api/voice-intake contact-capture gate', () => {
  it('passes the gate when caller_phone + caller_name are both present', async () => {
    const req = makeRequest({
      firmId: FIRM_ID,
      caller_phone: '+14165550143',
      caller_name: 'Alex Caller',
      transcript: 'I need help with an unpaid invoice. My business partner stopped paying.',
      call_id: 'call_abc',
      call_duration_sec: 92,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(screened).toBeDefined();
    expect(unconfirmed).toBeUndefined();
  });

  it('lands in unconfirmed_inquiries when caller_phone present but caller_name missing', async () => {
    const req = makeRequest({
      firmId: FIRM_ID,
      caller_phone: '+14165550143',
      // caller_name omitted — Voice AI failed to capture or lead refused to give it
      transcript: 'Hi, I have a legal question about a real estate purchase.',
      call_id: 'call_xyz',
      call_duration_sec: 18,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(screened).toBeUndefined();
    expect(unconfirmed).toBeDefined();
    expect(unconfirmed?.payload.channel).toBe('voice');
    expect(unconfirmed?.payload.reason).toBe('no_contact_provided');
  });

  it('returns persisted=false with reason=awaiting_contact when gate fails', async () => {
    const req = makeRequest({
      firmId: FIRM_ID,
      caller_phone: '+14165550143',
      transcript: 'Hi, I have a question.',
      call_id: 'call_123',
      call_duration_sec: 12,
    });
    const res = await POST(req as never);
    const body = (await res.json()) as { persisted: boolean; reason?: string };
    expect(body.persisted).toBe(false);
    expect(body.reason).toBe('awaiting_contact');
  });
});
