/**
 * processChannelInbound — discovery follow-up phase coverage.
 *
 * Bug 1 (2026-05-16): WhatsApp inbound `b0900da6` produced an anemic
 * brief (multi_turn=false, follow_up_count=0, all axes 0 or 3) because
 * the processor ran a single extraction pass and persisted immediately —
 * the engine never got to ask the discovery questions that fill the
 * urgency / complexity / readiness axes.
 *
 * Phase C (discovery follow-up) is the fix: after the contact-capture
 * doctrine gate passes on an uncapped Meta channel, the processor asks
 * `DISCOVERY_FOLLOW_UP_CAP` additional questions before finalising. This
 * suite locks the new behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// ─── Hoisted mocks ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
  buildContactCaptureFollowUp: vi.fn(() => 'follow-up text'),
  llmExtractServer: vi.fn(() => Promise.resolve({ mode: 'mock', extracted: {} })),
  renderBriefHtmlServer: vi.fn(() => '<div class="brief">brief</div>'),
  notifyLawyersOfNewLead: vi.fn(() => Promise.resolve()),
  loadOpenChannelSession: vi.fn(() => Promise.resolve(null)),
  createChannelSession: vi.fn(() => Promise.resolve('session-uuid')),
  updateChannelSession: vi.fn(() => Promise.resolve()),
  finalizeChannelSession: vi.fn(() => Promise.resolve()),
  persistUnconfirmedInquiry: vi.fn(() => Promise.resolve()),
  insertedRow: {
    id: 'row-uuid',
    lead_id: 'L-test-1',
    status: 'triaging',
    decision_deadline: '2026-05-17T00:00:00.000Z',
    whale_nurture: false,
  },
  insertError: null as { code?: string; message: string } | null,
  insertPayload: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/channel-send', () => ({
  sendChannelMessage: mocks.sendChannelMessage,
  buildContactCaptureFollowUp: mocks.buildContactCaptureFollowUp,
  buildContactCaptureExhaustedMessage: vi.fn(() => 'exhausted text'),
}));

vi.mock('@/lib/screen-llm-server', () => ({
  llmExtractServer: mocks.llmExtractServer,
}));

vi.mock('@/lib/screen-brief-html', () => ({
  renderBriefHtmlServer: mocks.renderBriefHtmlServer,
}));

vi.mock('@/lib/lead-notify', () => ({
  notifyLawyersOfNewLead: mocks.notifyLawyersOfNewLead,
}));

vi.mock('@/lib/channel-intake-session-store', () => ({
  loadOpenChannelSession: mocks.loadOpenChannelSession,
  loadRecentFinalizedSession: vi.fn().mockResolvedValue(null),
  createChannelSession: mocks.createChannelSession,
  updateChannelSession: mocks.updateChannelSession,
  finalizeChannelSession: mocks.finalizeChannelSession,
}));

vi.mock('@/lib/unconfirmed-inquiry', () => ({
  persistUnconfirmedInquiry: mocks.persistUnconfirmedInquiry,
}));

vi.mock('@/lib/supabase-admin', () => {
  const makeChain = () => ({
    select: (_cols: string) => makeChain(),
    eq: (_field: string, _v: unknown) => makeChain(),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () =>
      mocks.insertError
        ? Promise.resolve({ data: null, error: mocks.insertError })
        : Promise.resolve({ data: mocks.insertedRow, error: null }),
    insert: (payload: Record<string, unknown>) => {
      mocks.insertPayload = payload;
      return {
        select: (_cols: string) => ({
          single: () =>
            mocks.insertError
              ? Promise.resolve({ data: null, error: mocks.insertError })
              : Promise.resolve({ data: mocks.insertedRow, error: null }),
        }),
      };
    },
  });
  return {
    supabaseAdmin: { from: (_table: string) => makeChain() },
  };
});

// Import AFTER mocks.
import {
  processChannelInbound,
  type WhatsAppSender,
} from '../channel-intake-processor';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

// Adriano's smoke-test WhatsApp message (270 chars, contract / vendor
// dispute, $75k). The "my name is Adriano" clause exercises the
// regex-name override on top of the channel-metadata pre-fill.
const VENDOR_DISPUTE_270_CHAR =
  "Hi, I run a small business in Mississauga and we have a contract dispute. " +
  "We supplied roughly 75k of product to a vendor back in March, they paid the " +
  "deposit then defaulted on the balance. My name is Adriano and we need legal " +
  "help to recover the money, it's hurting our cash flow.";

function whatsappSender(senderName: string | null = 'A D'): WhatsAppSender {
  return {
    channel: 'whatsapp',
    senderWaId: '16475492106',
    senderName,
    messageMid: 'mid_abc',
    phoneNumberId: 'pn-1',
  };
}

beforeEach(() => {
  mocks.sendChannelMessage.mockReset();
  mocks.sendChannelMessage.mockResolvedValue({ sent: true, messageId: 'mid_out' });
  mocks.notifyLawyersOfNewLead.mockReset();
  mocks.notifyLawyersOfNewLead.mockResolvedValue(undefined);
  mocks.llmExtractServer.mockReset();
  mocks.llmExtractServer.mockResolvedValue({ mode: 'mock', extracted: {} });
  mocks.renderBriefHtmlServer.mockReset();
  mocks.renderBriefHtmlServer.mockReturnValue('<div class="brief">brief</div>');
  mocks.loadOpenChannelSession.mockReset();
  mocks.loadOpenChannelSession.mockResolvedValue(null);
  mocks.persistUnconfirmedInquiry.mockReset();
  mocks.persistUnconfirmedInquiry.mockResolvedValue(undefined);
  mocks.createChannelSession.mockReset();
  mocks.createChannelSession.mockResolvedValue('session-uuid');
  mocks.updateChannelSession.mockReset();
  mocks.updateChannelSession.mockResolvedValue(undefined);
  mocks.finalizeChannelSession.mockReset();
  mocks.finalizeChannelSession.mockResolvedValue(undefined);
  mocks.insertPayload = null;
  mocks.insertError = null;
  mocks.insertedRow = {
    id: 'row-uuid',
    lead_id: 'L-test-1',
    status: 'triaging',
    decision_deadline: '2026-05-17T00:00:00.000Z',
    whale_nurture: false,
  };
});

describe('processChannelInbound — discovery follow-up phase', () => {
  it('270-char vendor dispute on whatsapp with contact pre-fill sends a discovery question, not a closing', async () => {
    // Lock down the failure mode from the 2026-05-16 smoke test.
    // Inputs:
    //   - WhatsApp metadata seeds client_phone (sender wa_id)
    //   - Text body's "my name is Adriano" override seeds client_name
    //     (regex extractor in initialiseState)
    //   - Contact gate passes on turn 1
    //   - Discovery cap not yet reached → engine asks a slot question
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: VENDOR_DISPUTE_270_CHAR,
      sender: whatsappSender('A D'),
    });

    expect(r.persisted).toBe(false);
    expect(r.reason).toBe('awaiting_discovery_answer');
    expect(r.followUpSent).toBe(true);

    // Exactly one outbound send — the discovery question.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    // The slot question varies by classification; the common discovery
    // questions for a corporate / contract / vendor matter end with `?`
    // and are NOT a "Thanks..." closing.
    expect(sentText).not.toMatch(/^Thanks/);
    expect(sentText).toMatch(/\?/);

    // A session was created so the next inbound resumes.
    expect(mocks.createChannelSession).toHaveBeenCalledTimes(1);
    // The call's first arg is the CreateSessionArgs payload; cast
    // through unknown because the hoisted mock is typed as a no-arg fn.
    const sessionPayload = (mocks.createChannelSession.mock.calls as unknown as Array<
      Array<{ engineState: { discoveryFollowUpCount?: number; contactCaptureStarted: boolean } }>
    >)[0][0];
    expect(sessionPayload.engineState.discoveryFollowUpCount).toBe(1);
    expect(sessionPayload.engineState.contactCaptureStarted).toBe(true);
  });

  it('regex name override beats WhatsApp profile pre-fill ("A D" → "Adriano")', async () => {
    // Same vendor-dispute scenario; assert specifically that the
    // engine state passed to the session has client_name = 'Adriano',
    // not the WhatsApp profile's 'A D' display name.
    await processChannelInbound({
      firmId: FIRM_ID,
      text: VENDOR_DISPUTE_270_CHAR,
      sender: whatsappSender('A D'),
    });

    const sessionPayload = (mocks.createChannelSession.mock.calls as unknown as Array<
      Array<{
        engineState: {
          slots: Record<string, string>;
          slot_meta: Record<string, { source: string }>;
        };
      }>
    >)[0][0];
    expect(sessionPayload.engineState.slots.client_name).toBe('Adriano');
    expect(sessionPayload.engineState.slot_meta.client_name.source).toBe('explicit');
  });

  it('resume turn at discovery cap finalises with multi_turn=true and follow_up_count>=2', async () => {
    // Simulate the third resume turn: discovery cap is reached, contact
    // gate already passed, slots populated. The processor should skip
    // the discovery loop and finalise.
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-resume',
      firm_id: FIRM_ID,
      channel: 'whatsapp',
      sender_id: '16475492106',
      engine_state: {
        input: 'prior conversation',
        practice_area: 'corporate',
        matter_type: 'vendor_supplier_dispute',
        intent_family: 'business_dispute',
        dispute_family: 'vendor_supplier',
        advisory_subtrack: 'unknown',
        slots: {
          client_name: 'Adriano',
          client_phone: '+16475492106',
          amount_at_stake: '$25,000–$100,000',
        },
        slot_meta: {
          client_name: { source: 'explicit', confidence: 0.95 },
          client_phone: { source: 'answered', confidence: 1.0 },
          amount_at_stake: { source: 'answered', confidence: 1.0 },
        },
        slot_evidence: {},
        raw: {
          mentions_urgency: false, mentions_money: true, mentions_access: false,
          mentions_ownership: false, mentions_documents: false, mentions_payment: true,
          mentions_agreement: true, mentions_vendor: true, mentions_fraud: false,
          mentions_property: false, mentions_closing: false, mentions_lease: false,
          mentions_construction: false, mentions_mortgage: false,
          mentions_preconstruction: false, input_length: 20,
        },
        confidence: 0,
        coreCompleteness: 0,
        answeredQuestionGroups: [],
        questionHistory: ['amount_at_stake', 'billing_dispute_reason'],
        insightShown: false,
        contactCaptureStarted: true,
        lead_id: 'L-2026-05-16-AAA',
        submitted_at: '2026-05-16T00:00:00.000Z',
        language: 'en',
        // Must equal DISCOVERY_FOLLOW_UP_CAP (12) so Phase C skips and
        // the processor finalises. See sibling fixture in
        // channel-intake-processor-closing.test.ts for the rationale.
        discoveryFollowUpCount: 12,
      },
      follow_up_count: 0,
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-05-17T00:00:00.000Z',
      created_at: '2026-05-16T00:00:00.000Z',
    } as never);

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'Closing date is set for next month.',
      sender: whatsappSender('Adriano'),
    });

    expect(r.persisted).toBe(true);

    // The persisted slot_answers blob must reflect multi-turn = true and
    // total follow_up_count >= 2 (= 0 contact + 3 discovery in this fixture).
    expect(mocks.insertPayload).not.toBeNull();
    const slotAnswers = mocks.insertPayload!.slot_answers as Record<string, unknown>;
    expect(slotAnswers.multi_turn).toBe(true);
    expect(slotAnswers.follow_up_count).toBeGreaterThanOrEqual(2);

    // Questions-asked measurement gap fix (qualification audit F6,
    // 2026-07-02): the live questionHistory must now survive into the
    // persisted row, not just drive in-session budget enforcement.
    expect(slotAnswers.questionHistory).toEqual(['amount_at_stake', 'billing_dispute_reason']);

    // Closing acknowledgment was sent on the same channel.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toMatch(/^Thanks Adriano,/);
  });

  it('out-of-scope on whatsapp skips the discovery phase and persists directly', async () => {
    // Out-of-scope leads should NOT run the discovery loop — the
    // bridgeText routing copy is already terminal. Mock the LLM to
    // classify as family law (out of scope).
    mocks.llmExtractServer.mockResolvedValueOnce({
      mode: 'mock',
      extracted: {},
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'I want to file for divorce from my wife and we have shared property.',
      sender: whatsappSender('A D'),
    });

    expect(r.persisted).toBe(true);

    // Only one send — the closing for OOS.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it('contact-gate failure path still fires — discovery never runs without contact', async () => {
    // Inbound with PSID only (no name, no phone). Contact gate fails, so
    // the contact-capture follow-up is sent. Discovery code is downstream
    // of the gate and never runs on this path.
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'I need help with something legal.',
      sender: {
        channel: 'facebook',
        senderPsid: 'psid_anon',
        senderName: null,
        messageMid: 'mid_anon',
        pageId: 'page-1',
      },
    });

    expect(r.persisted).toBe(false);
    expect(r.reason).toBe('awaiting_contact');
    expect(r.followUpSent).toBe(true);
    // The send is the contact follow-up (`follow-up text` from the mock).
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toBe('follow-up text');
  });
});

// ════════════════════════════════════════════════════════════════════
// Task #92 — contact-capture exhaustion graceful close
// ════════════════════════════════════════════════════════════════════
//
// Before this fix, when a Meta-channel lead had already received 3
// contact-capture asks AND was still missing contact details, the
// processor silently dropped them to unconfirmed_inquiries with no
// final message. From the lead's perspective: 3 polite asks, then
// nothing. The OOS classification path made this especially visible
// because OOS leads have no other slot machinery to chew on. The fix
// sends a graceful "I still need <missing>, reply when ready" close
// before the unconfirmed_inquiries persist.

describe('processChannelInbound — contact-capture exhaustion graceful close', () => {
  it('sends the exhausted-message before persisting to unconfirmed_inquiries when MAX is reached', async () => {
    // Resume an OOS session that already burned all 3 follow-ups.
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-exhausted',
      firm_id: FIRM_ID,
      channel: 'facebook',
      sender_id: 'psid_anon',
      engine_state: {
        input: 'previous transcript',
        channel: 'facebook',
        matter_type: 'out_of_scope',
        practice_area: 'family',
        intent_family: 'unknown',
        dispute_family: 'unknown',
        advisory_subtrack: 'unknown',
        slots: {},
        slot_meta: {},
        slot_evidence: {},
        raw: {
          mentions_urgency: false, mentions_money: false, mentions_access: false,
          mentions_ownership: false, mentions_documents: false, mentions_payment: false,
          mentions_agreement: false, mentions_vendor: false, mentions_fraud: false,
          mentions_property: false, mentions_closing: false, mentions_lease: false,
          mentions_construction: false, mentions_mortgage: false,
          mentions_preconstruction: false, input_length: 30,
        },
        confidence: 0,
        coreCompleteness: 0,
        answeredQuestionGroups: [],
        questionHistory: [],
        insightShown: false,
        contactCaptureStarted: false,
        lead_id: 'L-2026-05-26-EXH',
        submitted_at: '2026-05-26T00:00:00.000Z',
        language: 'en',
        discoveryFollowUpCount: 0,
      },
      follow_up_count: 3, // = MAX_FOLLOW_UPS
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-05-27T00:00:00.000Z',
      created_at: '2026-05-26T00:00:00.000Z',
    } as never);

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'still no contact info from me',
      sender: {
        channel: 'facebook',
        senderPsid: 'psid_anon',
        senderName: null,
        messageMid: 'mid_exhausted',
        pageId: 'page-1',
      },
    });

    // Lead is NOT screened — goes to unconfirmed_inquiries.
    expect(r.persisted).toBe(false);
    expect(r.reason).toBe('max_follow_ups_exhausted');
    expect(mocks.persistUnconfirmedInquiry).toHaveBeenCalledTimes(1);
    const ucCall = (mocks.persistUnconfirmedInquiry.mock.calls as unknown as Array<Array<{ reason: string; followUpAttempts: number }>>)[0][0];
    expect(ucCall.reason).toBe('engine_refused');
    expect(ucCall.followUpAttempts).toBe(3);

    // BEFORE the unconfirmed_inquiries persist, the graceful exhausted
    // message went out — exactly once, with the mocked "exhausted text".
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toBe('exhausted text');

    // Session is finalized so a future inbound starts fresh.
    expect(mocks.finalizeChannelSession).toHaveBeenCalledWith('session-exhausted');
  });

  it('exhausted-message send failure does NOT block the unconfirmed_inquiries persist', async () => {
    mocks.sendChannelMessage.mockResolvedValueOnce({ sent: false, reason: 'no token' });
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-exhausted-2',
      firm_id: FIRM_ID,
      channel: 'whatsapp',
      sender_id: '16475555555',
      engine_state: {
        input: 'previous transcript',
        channel: 'whatsapp',
        matter_type: 'out_of_scope',
        practice_area: 'immigration',
        intent_family: 'unknown',
        dispute_family: 'unknown',
        advisory_subtrack: 'unknown',
        slots: {},
        slot_meta: {},
        slot_evidence: {},
        raw: {
          mentions_urgency: false, mentions_money: false, mentions_access: false,
          mentions_ownership: false, mentions_documents: false, mentions_payment: false,
          mentions_agreement: false, mentions_vendor: false, mentions_fraud: false,
          mentions_property: false, mentions_closing: false, mentions_lease: false,
          mentions_construction: false, mentions_mortgage: false,
          mentions_preconstruction: false, input_length: 30,
        },
        confidence: 0,
        coreCompleteness: 0,
        answeredQuestionGroups: [],
        questionHistory: [],
        insightShown: false,
        contactCaptureStarted: false,
        lead_id: 'L-2026-05-26-EXH2',
        submitted_at: '2026-05-26T00:00:00.000Z',
        language: 'en',
        discoveryFollowUpCount: 0,
      },
      follow_up_count: 5, // beyond MAX
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-05-27T00:00:00.000Z',
      created_at: '2026-05-26T00:00:00.000Z',
    } as never);

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'help',
      sender: whatsappSender(null),
    });

    expect(r.persisted).toBe(false);
    expect(r.reason).toBe('max_follow_ups_exhausted');
    // Send was attempted (and failed).
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    // The unconfirmed_inquiries persist still happens regardless of the send result.
    expect(mocks.persistUnconfirmedInquiry).toHaveBeenCalledTimes(1);
    // Session still finalized so the lead can re-engage with a fresh start.
    expect(mocks.finalizeChannelSession).toHaveBeenCalledWith('session-exhausted-2');
  });
});
