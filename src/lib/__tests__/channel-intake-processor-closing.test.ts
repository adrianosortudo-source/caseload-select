/**
 * processChannelInbound — closing-message dispatch coverage.
 *
 * After the persist insert lands a screened_lead, the processor must
 * emit a 1-2 sentence acknowledgment on the same channel via the
 * existing Send API path. This is what fires the first outbound
 * pages_messaging / whatsapp_business_messaging Send API call on
 * single-turn intakes — required by Meta App Review and necessary so
 * the lead doesn't see their message land in a void.
 *
 * Closing-message failure MUST NOT unwind the persist (the brief is
 * already saved). These tests lock both directions.
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
}));

vi.mock('@/lib/channel-send', () => ({
  sendChannelMessage: mocks.sendChannelMessage,
  buildContactCaptureFollowUp: mocks.buildContactCaptureFollowUp,
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
  createChannelSession: mocks.createChannelSession,
  updateChannelSession: mocks.updateChannelSession,
  finalizeChannelSession: mocks.finalizeChannelSession,
}));

vi.mock('@/lib/unconfirmed-inquiry', () => ({
  persistUnconfirmedInquiry: mocks.persistUnconfirmedInquiry,
}));

vi.mock('@/lib/supabase-admin', () => {
  const makeChain = (table: string) => ({
    select: (_cols: string) => makeChain(table),
    eq: (_field: string, _v: unknown) => makeChain(table),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () =>
      mocks.insertError
        ? Promise.resolve({ data: null, error: mocks.insertError })
        : Promise.resolve({ data: mocks.insertedRow, error: null }),
    insert: (_payload: Record<string, unknown>) => ({
      select: (_cols: string) => ({
        single: () =>
          mocks.insertError
            ? Promise.resolve({ data: null, error: mocks.insertError })
            : Promise.resolve({ data: mocks.insertedRow, error: null }),
      }),
    }),
  });
  return {
    supabaseAdmin: { from: (table: string) => makeChain(table) },
  };
});

// Import AFTER mocks.
import {
  processChannelInbound,
  type WhatsAppSender,
  type MessengerSender,
} from '../channel-intake-processor';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

function whatsappSenderWithContact(): WhatsAppSender {
  // WhatsApp metadata pre-fills both contact slots — wa_id is the phone
  // (E.164 minus leading +) and profile.name lands as senderName.
  return {
    channel: 'whatsapp',
    senderWaId: '16475492106',
    senderName: 'Adriano',
    messageMid: 'mid_abc',
    phoneNumberId: 'pn-1',
  };
}

function messengerSenderWithName(): MessengerSender {
  return {
    channel: 'facebook',
    senderPsid: 'psid_abc',
    senderName: 'Adriano Domingues',
    messageMid: 'mid_def',
    pageId: 'page-1',
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
  mocks.insertError = null;
  mocks.insertedRow = {
    id: 'row-uuid',
    lead_id: 'L-test-1',
    status: 'triaging',
    decision_deadline: '2026-05-17T00:00:00.000Z',
    whale_nurture: false,
  };
});

// Build a resumed session whose engine state has already hit the
// discovery follow-up cap. Used by the closing tests so the processor
// finalises on this turn rather than asking another discovery question.
//
// Mirrors the shape returned by `loadOpenChannelSession` — `engine_state`
// is a partial EngineState (the field set the processor needs to skip
// the discovery loop and finalise into screened_leads).
function discoveryCapExhaustedSession(channel: 'whatsapp' | 'facebook' | 'instagram') {
  return {
    id: 'session-uuid-resume',
    firm_id: FIRM_ID,
    channel,
    sender_id: 'sender-id',
    engine_state: {
      input: 'prior turn transcript',
      practice_area: 'corporate',
      matter_type: 'contract_dispute',
      intent_family: 'business_dispute',
      dispute_family: 'agreement_performance',
      advisory_subtrack: 'unknown',
      slots: {
        client_name: 'Adriano',
        client_phone: '+16475492106',
      },
      slot_meta: {
        client_name: { source: 'answered', confidence: 1.0 },
        client_phone: { source: 'answered', confidence: 1.0 },
      },
      slot_evidence: {},
      raw: {
        mentions_urgency: false,
        mentions_money: true,
        mentions_access: false,
        mentions_ownership: false,
        mentions_documents: false,
        mentions_payment: true,
        mentions_agreement: true,
        mentions_vendor: false,
        mentions_fraud: false,
        mentions_property: false,
        mentions_closing: false,
        mentions_lease: false,
        mentions_construction: false,
        mentions_mortgage: false,
        mentions_preconstruction: false,
        input_length: 20,
      },
      confidence: 0,
      coreCompleteness: 0,
      answeredQuestionGroups: [],
      questionHistory: [],
      insightShown: false,
      contactCaptureStarted: true,
      lead_id: 'L-2026-05-16-AAA',
      submitted_at: '2026-05-16T00:00:00.000Z',
      language: 'en',
      // Discovery cap already exhausted on previous turns.
      discoveryFollowUpCount: 3,
    },
    follow_up_count: 0,
    max_follow_ups: 3,
    finalized: false,
    expires_at: '2026-05-17T00:00:00.000Z',
    created_at: '2026-05-16T00:00:00.000Z',
  };
}

describe('processChannelInbound — closing message dispatch', () => {
  it('sends a closing acknowledgment on whatsapp after the discovery cap is reached', async () => {
    // Adriano's smoke-test scenario: contract dispute, WhatsApp pre-fills
    // both contact slots, contact gate passes — but the processor now
    // runs a discovery follow-up phase BEFORE the closing. To exercise
    // the closing path itself, the test simulates the final resume turn:
    // session state already has `discoveryFollowUpCount === DISCOVERY_FOLLOW_UP_CAP`,
    // so the processor skips the discovery loop and finalises directly.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      discoveryCapExhaustedSession('whatsapp') as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'About $75k. Closing date is next month.',
      sender: whatsappSenderWithContact(),
    });

    expect(r.persisted).toBe(true);
    expect(r.status).toBe('triaging');

    // Only ONE sendChannelMessage call — the closing acknowledgment.
    // No follow-up question was sent because discovery is exhausted.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toMatch(/^Thanks Adriano,/);
    expect(sentText).toMatch(/a lawyer is reviewing your /);
    expect(sentText).toMatch(/will reach out (shortly|promptly)\.$/);
  });

  it('sends a closing acknowledgment on messenger after the discovery cap is reached', async () => {
    // Messenger has no inbound phone, but the contact gate on resume
    // sees client_name + client_phone (provisioned via LLM extraction on
    // a prior turn — same fixture for simplicity). Discovery is
    // exhausted, so the processor finalises and sends the closing.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      discoveryCapExhaustedSession('facebook') as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'Yes, the contract was in writing.',
      sender: messengerSenderWithName(),
    });

    expect(r.persisted).toBe(true);
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toMatch(/^Thanks Adriano,/);
  });

  it('does not unwind the persist when the closing-message send fails', async () => {
    // Send rejects (token revoked, Graph 4xx, network error). The lead
    // is already in screened_leads; we must surface persisted=true.
    // Resume turn with discovery cap exhausted so the processor reaches
    // the closing-send path.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      discoveryCapExhaustedSession('whatsapp') as never,
    );
    mocks.sendChannelMessage.mockResolvedValueOnce({
      sent: false,
      reason: 'no whatsapp_cloud_api_access_token configured',
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'It was about 75k worth of product unpaid.',
      sender: whatsappSenderWithContact(),
    });

    expect(r.persisted).toBe(true);
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it('does not unwind the persist when the closing-message send throws', async () => {
    // Pathological: send helper itself blows up (programmer error, not a
    // Graph response). The lead is already saved; the persist must stick.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      discoveryCapExhaustedSession('whatsapp') as never,
    );
    mocks.sendChannelMessage.mockImplementationOnce(() => {
      throw new Error('unexpected boom');
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'It was about 75k worth of product unpaid.',
      sender: whatsappSenderWithContact(),
    });

    expect(r.persisted).toBe(true);
  });

  it('does not send a closing on the gate-fail follow-up path', async () => {
    // Inbound with no contact metadata (PSID only, no name). Gate fails.
    // sendChannelMessage gets called ONCE — for the follow-up question,
    // not a closing acknowledgment. The closing dispatch sits inside the
    // post-persist branch and never runs here.
    const sender: MessengerSender = {
      channel: 'facebook',
      senderPsid: 'psid_anon',
      senderName: null,
      messageMid: 'mid_anon',
      pageId: 'page-1',
    };

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'I need help with something legal.',
      sender,
    });

    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);
    // The single send is the follow-up question, not a closing.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    // Follow-up phrasing uses buildContactCaptureFollowUp (mocked above
    // to return 'follow-up text'); the closing phrasing starts with
    // "Thanks ..." and is what would NOT have been emitted on this path.
    expect(sentText).toBe('follow-up text');
    expect(sentText).not.toMatch(/^Thanks/);
  });
});
