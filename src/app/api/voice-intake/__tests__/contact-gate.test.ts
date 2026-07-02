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
    // call_id dedup chain (launch audit H1): returns no match via the
    // null maybeSingle below, so every call processes as a first delivery.
    gte: (_field: string, _v: unknown) => makeChain(table),
    limit: (_n: number) => makeChain(table),
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

vi.mock('@/lib/voice-callback-notify', () => ({
  notifyOperatorOfVoiceCallback: vi.fn(() => Promise.resolve({ email: 'skipped', sms: 'skipped', errors: [] })),
  notifyOperatorOfUnconfirmedVoiceIntake: vi.fn(() => Promise.resolve({ email: 'skipped', errors: [] })),
  notifyOperatorOfLlmDisabled: vi.fn(() => Promise.resolve({ email: 'skipped', errors: [] })),
}));

vi.mock('@/lib/voice-branch-classifier-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/voice-branch-classifier')>(
    '@/lib/voice-branch-classifier',
  );
  return {
    classifyVoiceBranchServer: vi.fn((transcript: string) =>
      Promise.resolve({
        branch: actual.classifyVoiceBranchHeuristic(transcript),
        mode: 'heuristic',
      }),
    ),
  };
});

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
import { notifyOperatorOfUnconfirmedVoiceIntake } from '@/lib/voice-callback-notify';

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
  vi.mocked(notifyOperatorOfUnconfirmedVoiceIntake).mockClear();
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

  it('VOICE REACHABILITY (2026-06-04): caller_phone present but name never parses -> enters the lawyer queue, not unconfirmed', async () => {
    // v2.0 doctrine: a voice call we can reach (caller-ID phone) belongs in the
    // lawyer queue even when the name did not extract. The lawyer gets the name
    // on the callback. Only a call with NO reachable contact is unconfirmed.
    // Here there is no name anywhere AND no bot name-question, so neither the
    // engine nor Fix A recovers a name — the phone alone must route it.
    const req = makeRequest({
      firmId: FIRM_ID,
      caller_phone: '+14165550143',
      transcript: 'Hi, I have a legal question about a real estate purchase.',
      call_id: 'call_xyz',
      call_duration_sec: 18,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(screened).toBeDefined();
    expect(unconfirmed).toBeUndefined();
    // Reachable, so the operator-unconfirmed alert must NOT fire.
    expect(notifyOperatorOfUnconfirmedVoiceIntake).not.toHaveBeenCalled();
  });

  it('LOCKED REGRESSION (2026-06-03): name given + confirmed on a "name right:" readback enters the normal lead queue', async () => {
    // The exact DRG smoke-call shape that regressed: caller states a bare name
    // (engine misses it), the bot reads it back with "I have your name right:
    // X", caller confirms, phone arrives via caller ID. Must become a
    // screened_lead with the recovered name, NOT a dropped unconfirmed inquiry.
    const req = makeRequest({
      firmId: FIRM_ID,
      caller_phone: '+16475492106',
      // caller_name omitted in the webhook body — name only exists in-transcript.
      transcript: [
        'bot:Got it. Can I get your full name?',
        'human:Adriana Dominguez.',
        'bot:Let me make sure I have your name right: Adriana Dominguez. Is that correct?',
        'human:Correct.',
        "bot:Great. Could you describe what's going on, in your own words?",
        'human:I need help with incorporating my business. I am a freelancer and I want to set up a corporation.',
        "bot:Thank you, Adriana. I'll pass this along.",
        'RECORD_BRANCH: NEW_MATTER',
      ].join('\n'),
      call_id: 'call_namedrop_regression',
      call_duration_sec: 60,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    // Enters the normal queue, is NOT dropped, and does NOT fire the alert.
    expect(unconfirmed).toBeUndefined();
    expect(screened).toBeDefined();
    expect(notifyOperatorOfUnconfirmedVoiceIntake).not.toHaveBeenCalled();
    // The recovered name is on the persisted record.
    const slots = (screened?.payload.slot_answers as { slots?: Record<string, unknown> })?.slots ?? {};
    expect(slots.client_name).toBe('Adriana Dominguez');
    // Questions-asked measurement gap (qualification audit F6, 2026-07-02):
    // present for shape consistency with web/Meta, but empty by design.
    // Voice (DR-033) is a single-pass transcript analysis, no live
    // getNextStep loop runs here, so there is nothing to have tracked.
    const slotAnswersRoot = screened?.payload.slot_answers as { questionHistory?: unknown[] };
    expect(slotAnswersRoot.questionHistory).toEqual([]);
  });

  it('LOCKED REGRESSION (2026-06-04): bare name answered to "Can I get your name?" (no readback) enters the queue with the recovered name', async () => {
    // The exact Call #1 shape that dropped to unconfirmed: the agent asked
    // "Can I get your name?", the caller said a bare "Adriana", there was NO
    // readback, and llm_mode was degraded. Fix A recovers "Adriana" from the
    // name-question answer; Fix B (caller-ID phone) is the safety net. The lead
    // must enter the lawyer queue with the name, not drop to unconfirmed.
    const req = makeRequest({
      firmId: FIRM_ID,
      caller_phone: '+16475492106',
      transcript: [
        "bot:Thanks for calling DRG Law. I'm an automated assistant for the firm, and this call may be recorded.",
        'bot:Are you already a client of the firm, looking for legal help for the first time, or calling about something else today?',
        'human:The first time.',
        'bot:Alright. Can I get your name?',
        'human:Adriana.',
        "bot:Thanks, Adriana. Is the number you're calling from the best one to reach you?",
        'human:Yes.',
        "bot:Great. Could you describe what's going on, in your own words?",
        'human:I need a will. I have two kids, a house, and some savings.',
        "bot:Just to confirm, you're looking for help to create a will, correct?",
        'human:Yeah.',
        "bot:Thank you, Adriana. I'll pass this along to our team.",
        'RECORD_BRANCH: NEW_MATTER',
      ].join('\n'),
      call_id: 'call_barename_regression',
      call_duration_sec: 70,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(unconfirmed).toBeUndefined();
    expect(screened).toBeDefined();
    expect(notifyOperatorOfUnconfirmedVoiceIntake).not.toHaveBeenCalled();
    const slots = (screened?.payload.slot_answers as { slots?: Record<string, unknown> })?.slots ?? {};
    expect(slots.client_name).toBe('Adriana');
  });

  it('no caller_phone AND no name -> unconfirmed + awaiting_contact + operator alert (truly unreachable)', async () => {
    // The only case still unconfirmed under the voice reachability doctrine:
    // blocked/absent caller-ID, no spoken number, no email, no name.
    const req = makeRequest({
      firmId: FIRM_ID,
      // caller_phone omitted -> callerPhone null -> not seeded -> unreachable
      transcript: 'I need help making a will and planning my estate.',
      call_id: 'call_123',
      call_duration_sec: 12,
    });
    const res = await POST(req as never);
    const body = (await res.json()) as { persisted: boolean; reason?: string };
    expect(body.persisted).toBe(false);
    expect(body.reason).toBe('awaiting_contact');

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(screened).toBeUndefined();
    expect(unconfirmed).toBeDefined();
    expect(unconfirmed?.payload.reason).toBe('no_contact_provided');
    expect(notifyOperatorOfUnconfirmedVoiceIntake).toHaveBeenCalledTimes(1);
  });

  it('routes existing-client calls to voice_callback_requests instead of screened_leads', async () => {
    const req = makeRequest({
      firmId: FIRM_ID,
      caller_phone: '+14165550143',
      caller_name: 'Existing Client',
      transcript: [
        'human: I am an existing client calling for an update on my case.',
        'bot: Thanks. I will pass this message to the firm.',
        'bot: RECORD_BRANCH: OTHER',
      ].join('\n'),
      call_id: 'call_existing',
      call_duration_sec: 37,
    });
    const res = await POST(req as never);
    const body = (await res.json()) as { mode?: string; branch?: string };
    expect(res.status).toBe(200);
    expect(body.mode).toBe('callback');
    expect(body.branch).toBe('existing_client');

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const callback = captured.inserts.find((c) => c.table === 'voice_callback_requests');
    expect(screened).toBeUndefined();
    expect(callback).toBeDefined();
    expect(callback?.payload.branch).toBe('existing_client');
    expect(callback?.payload.caller_phone).toBe('+14165550143');
  });

  it.each([
    {
      label: 'court clerk',
      transcript: 'human: This is the court clerk. There is a hearing tomorrow.\nbot: RECORD_BRANCH: OTHER',
      branch: 'court_or_counsel',
      urgency: 'urgent',
    },
    {
      label: 'vendor',
      transcript: 'human: We sell SEO and lead generation services for law firms.\nbot: RECORD_BRANCH: OTHER',
      branch: 'vendor',
      urgency: 'normal',
    },
    {
      label: 'wrong number',
      transcript: 'human: Sorry, wrong number.\nbot: RECORD_BRANCH: OTHER',
      branch: 'wrong_number',
      urgency: 'normal',
    },
    {
      label: 'unclear',
      transcript: 'human: I need to talk to someone about something.\nbot: RECORD_BRANCH: UNCLEAR',
      branch: 'unclear',
      urgency: 'normal',
    },
  ])('routes $label calls to voice_callback_requests', async ({ transcript, branch, urgency }) => {
    const req = makeRequest({
      firmId: FIRM_ID,
      caller_phone: '+14165550143',
      caller_name: 'Caller Person',
      transcript,
      call_id: `call_${branch}`,
      call_duration_sec: 44,
    });
    const res = await POST(req as never);
    const body = (await res.json()) as { mode?: string; branch?: string; urgency?: string };
    expect(res.status).toBe(200);
    expect(body.mode).toBe('callback');
    expect(body.branch).toBe(branch);
    expect(body.urgency).toBe(urgency);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const callback = captured.inserts.find((c) => c.table === 'voice_callback_requests');
    expect(screened).toBeUndefined();
    expect(callback).toBeDefined();
    expect(callback?.payload.branch).toBe(branch);
    expect(callback?.payload.urgency).toBe(urgency);
  });
});
