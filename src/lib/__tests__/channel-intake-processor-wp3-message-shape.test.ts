/**
 * WP-3 message shape (2026-08-13, field case 2026-08-07): the numbered
 * reply hint on every single_select discovery question, and the
 * multi-pick acknowledgment.
 *
 * WP-3b (an expectation line on the first outbound of a fresh session)
 * was dropped at merge time: main's C2 first-ask intro (2026-08-07,
 * channel-intake-intro.ts) shipped the same feature first, with PT
 * coverage and its own processor-level test
 * (channel-intake-processor-first-ask-intro.test.ts). That test owns
 * fresh-vs-resume intro coverage; this file covers only the two DR-121
 * message-shape features that survived the merge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
  buildContactCaptureFollowUp: vi.fn(() => 'What is the best phone or email to reach you?'),
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
    lead_id: 'L-test-wp3-1',
    status: 'triaging',
    decision_deadline: '2026-08-14T00:00:00.000Z',
    whale_nurture: false,
  } as Record<string, unknown>,
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
    single: () => Promise.resolve({ data: mocks.insertedRow, error: null }),
    insert: (payload: Record<string, unknown>) => {
      mocks.insertPayload = payload;
      return {
        select: (_cols: string) => ({
          single: () => Promise.resolve({ data: mocks.insertedRow, error: null }),
        }),
      };
    },
  });
  return {
    supabaseAdmin: { from: (_table: string) => makeChain() },
  };
});

import {
  processChannelInbound,
  type WhatsAppSender,
} from '../channel-intake-processor';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

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
    messageMid: 'mid_wp3',
    phoneNumberId: 'pn-1',
  };
}

function rawSignals() {
  return {
    mentions_urgency: false, mentions_money: true, mentions_access: false,
    mentions_ownership: false, mentions_documents: false, mentions_payment: true,
    mentions_agreement: true, mentions_vendor: true, mentions_fraud: false,
    mentions_property: false, mentions_closing: false, mentions_lease: false,
    mentions_construction: false, mentions_mortgage: false,
    mentions_preconstruction: false, input_length: 20,
  };
}

beforeEach(() => {
  mocks.sendChannelMessage.mockReset();
  mocks.sendChannelMessage.mockResolvedValue({ sent: true, messageId: 'mid_out' });
  mocks.llmExtractServer.mockReset();
  mocks.llmExtractServer.mockResolvedValue({ mode: 'mock', extracted: {} });
  mocks.renderBriefHtmlServer.mockReset();
  mocks.renderBriefHtmlServer.mockReturnValue('<div class="brief">brief</div>');
  mocks.loadOpenChannelSession.mockReset();
  mocks.loadOpenChannelSession.mockResolvedValue(null);
  mocks.notifyLawyersOfNewLead.mockReset();
  mocks.notifyLawyersOfNewLead.mockResolvedValue(undefined);
  mocks.persistUnconfirmedInquiry.mockReset();
  mocks.persistUnconfirmedInquiry.mockResolvedValue(undefined);
  mocks.createChannelSession.mockReset();
  mocks.createChannelSession.mockResolvedValue('session-uuid');
  mocks.updateChannelSession.mockReset();
  mocks.updateChannelSession.mockResolvedValue(undefined);
  mocks.finalizeChannelSession.mockReset();
  mocks.finalizeChannelSession.mockResolvedValue(undefined);
  mocks.insertPayload = null;
});

describe('WP-3a: numbered reply hint', () => {
  it('every single_select discovery question ends with the reply hint', async () => {
    await processChannelInbound({
      firmId: FIRM_ID,
      text: VENDOR_DISPUTE_270_CHAR,
      sender: whatsappSender('A D'),
    });
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toContain('Reply with a number, or answer in your own words.');
  });
});

describe('WP-3c: multi-pick acknowledgment', () => {
  it('a reply naming multiple options for a single-pick question gets an ack and does not re-ask the same slot', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-resume-multipick',
      firm_id: FIRM_ID,
      channel: 'whatsapp',
      sender_id: '16475492106',
      engine_state: {
        input: 'i want to open a business',
        practice_area: 'corporate',
        matter_type: 'business_setup_advisory',
        intent_family: 'setup_advisory',
        dispute_family: 'general_business',
        advisory_subtrack: 'unknown',
        slots: {
          client_name: 'Adriano',
          client_phone: '+16475492106',
        },
        slot_meta: {
          client_name: { source: 'explicit', confidence: 0.9 },
          client_phone: { source: 'system_metadata', confidence: 1.0 },
        },
        slot_evidence: {},
        raw: rawSignals(),
        confidence: 0,
        coreCompleteness: 0,
        answeredQuestionGroups: [],
        questionHistory: [],
        insightShown: false,
        contactCaptureStarted: true,
        lead_id: 'L-wp3-multipick',
        submitted_at: '2026-08-07T00:00:00.000Z',
        language: 'en',
        discoveryFollowUpCount: 1,
        pendingAskedSlotId: 'advisory_path',
      },
      follow_up_count: 0,
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-08-08T00:00:00.000Z',
      created_at: '2026-08-07T00:00:00.000Z',
    } as never);

    await processChannelInbound({
      firmId: FIRM_ID,
      text: '1 and 2',
      sender: whatsappSender('Adriano'),
    });

    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toContain('Got it, I recorded your first pick.');

    const updateCall = (mocks.updateChannelSession.mock.calls as unknown as Array<
      Array<{ engineState: { slots: Record<string, string> } }>
    >)[0][0];
    expect(updateCall.engineState.slots.advisory_path).toBe('Starting a new business');
  });
});
