/**
 * C2 (2026-08-07): first-ask intro tests.
 *
 * The intro fires exactly once per fresh conversation (!isResume), on
 * whichever of the three mutually-exclusive first-ask sites fires: Phase
 * B contact-capture, the F2 unknown-matter describe-your-situation ask,
 * or Phase C's first discovery question. It never fires on a resume turn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
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
    lead_id: 'L-test-intro',
    status: 'triaging',
    decision_deadline: '2026-08-07T00:00:00.000Z',
    whale_nurture: false,
  } as Record<string, unknown>,
  insertPayload: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/channel-send', () => ({
  sendChannelMessage: mocks.sendChannelMessage,
  buildContactCaptureFollowUp: vi.fn((missing: string) => `RESUME-ASK:${missing}`),
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
  type MessengerSender,
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
    messageMid: 'mid_intro',
    phoneNumberId: 'pn-1',
  };
}

function messengerSender(senderName: string | null = null): MessengerSender {
  return {
    channel: 'facebook',
    senderPsid: '26924934080492300',
    senderName,
    messageMid: 'mid_intro_fb',
    pageId: 'page-1',
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

describe('First-ask intro (C2)', () => {
  it('fresh WhatsApp, classified matter, contact pre-filled: intro + first discovery question, single send', async () => {
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: VENDOR_DISPUTE_270_CHAR,
      sender: whatsappSender('A D'),
    });

    expect(r.persisted).toBe(false);
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText.startsWith('Thanks for reaching out.')).toBe(true);
    expect(sentText).toContain('a lawyer can review your situation');
    expect(sentText).toMatch(/\?/);
    // Exactly one "Thanks for reaching out." — not doubled with the F2 ask's
    // own former opener (which the opener-less Phase C composition avoids
    // by construction, since Phase C questions never carried an opener).
    expect(sentText.match(/Thanks for reaching out\./g)?.length).toBe(1);
  });

  it('fresh WhatsApp, unknown matter (F2 guard): intro + short describe-your-situation variant, "Thanks for reaching out." appears exactly once', async () => {
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'i want to speak to a lawyer',
      sender: whatsappSender('Adriano'),
    });

    expect(r.persisted).toBe(false);
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText.match(/Thanks for reaching out\./g)?.length).toBe(1);
    expect(sentText).toContain('To start, could you describe');
    // The F2 ask's own former "Thanks for reaching out. Before a lawyer
    // reviews this..." opener must NOT also be present (that would be
    // the doubled-opener bug the opener-less variant exists to avoid).
    expect(sentText).not.toContain('Before a lawyer reviews this');
  });

  it('fresh Messenger, no profile name: intro + opener-less contact-capture-first-ask variant, "Got it." absent', async () => {
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'i want to speak to a lawyer',
      sender: messengerSender(null),
    });

    expect(r.persisted).toBe(false);
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText.startsWith('Thanks for reaching out.')).toBe(true);
    expect(sentText).toContain('First, could you share your name');
    expect(sentText).not.toContain('Got it.');
    // The resume-turn mock ('RESUME-ASK:...') must not appear — proves
    // this went through the first-ask path, not buildContactCaptureFollowUp.
    expect(sentText).not.toContain('RESUME-ASK');
  });

  it('resume turn: sent text does NOT contain the intro', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-uuid',
      firm_id: FIRM_ID,
      channel: 'facebook',
      sender_id: '26924934080492300',
      engine_state: {
        lead_id: 'L-test-intro-resume',
        input: 'i want to speak to a lawyer',
        matter_type: 'unknown',
        practice_area: 'unknown',
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
          mentions_preconstruction: false, input_length: 28,
        },
        confidence: 0,
        coreCompleteness: 0,
        answeredQuestionGroups: [],
        questionHistory: [],
        insightShown: false,
        contactCaptureStarted: false,
        submitted_at: '2026-08-06T18:39:44.471Z',
        language: 'en',
        discoveryFollowUpCount: 0,
      },
      follow_up_count: 0,
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-08-07T18:39:44.471Z',
      created_at: '2026-08-06T18:39:44.471Z',
    } as never);

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'adriano, 6475492106',
      sender: messengerSender(null),
    });

    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).not.toContain('Thanks for reaching out. So a lawyer can review');
  });
});
