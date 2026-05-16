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

describe('processChannelInbound — closing message dispatch', () => {
  it('sends a closing acknowledgment on whatsapp after successful persist', async () => {
    // Adriano's smoke-test scenario: contract dispute, WhatsApp pre-fills
    // both contact slots, gate passes, lead is persisted. The processor
    // must follow up with a 1-2 sentence acknowledgment.
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text:
        'Hi, my business partner and I have a contract dispute. We supplied roughly 75k of product to a vendor in Mississauga back in March, they paid the deposit then defaulted on the balance. We need legal help to recover the money.',
      sender: whatsappSenderWithContact(),
    });

    expect(r.persisted).toBe(true);
    expect(r.status).toBe('triaging');

    // Only ONE sendChannelMessage call — the closing acknowledgment.
    // No follow-up question was sent because the gate passed on turn 1.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    // Channel-aware phrasing: name + window. The matter label is optional —
    // it depends on whether the regex extractor classified the matter
    // confidently (e.g. corporate_general falls through to a generic "your
    // matter" phrasing). Both shapes are valid.
    expect(sentText).toMatch(/^Thanks Adriano,/);
    expect(sentText).toMatch(/a lawyer is reviewing your /);
    expect(sentText).toMatch(/will reach out (shortly|promptly)\.$/);
  });

  it('sends a closing acknowledgment on messenger after successful persist', async () => {
    // Messenger pre-fill only seeds client_name — Meta IG / FB don't carry
    // a phone on the inbound. Use the LLM mock to surface a phone so the
    // contact-doctrine gate passes and the processor reaches the closing
    // dispatch. (Outside of tests, the gate-pass case on Messenger is the
    // multi-turn follow-up flow that lands contact via a separate Send;
    // this single-turn LLM-fill path mirrors what happens when the lead's
    // first message volunteers a phone number.)
    mocks.llmExtractServer.mockResolvedValueOnce({
      mode: 'live',
      extracted: { client_phone: '+14161234567' } as Record<string, string | null>,
    });
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text:
        'My business partner is hiding money from me and I cannot access the company bank account or any of the books. Reach me at 416-123-4567.',
      sender: messengerSenderWithName(),
    });

    expect(r.persisted).toBe(true);

    // Only the closing — no follow-up question.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toMatch(/^Thanks Adriano,/); // first token of the name
  });

  it('does not unwind the persist when the closing-message send fails', async () => {
    // Send rejects (token revoked, Graph 4xx, network error). The lead
    // is already in screened_leads; we must surface persisted=true.
    mocks.sendChannelMessage.mockResolvedValueOnce({
      sent: false,
      reason: 'no whatsapp_cloud_api_access_token configured',
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text:
        'I have a contract dispute about $75k worth of unpaid product delivered to a vendor.',
      sender: whatsappSenderWithContact(),
    });

    expect(r.persisted).toBe(true);
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it('does not unwind the persist when the closing-message send throws', async () => {
    // Pathological: send helper itself blows up (programmer error, not a
    // Graph response). The lead is already saved; the persist must stick.
    mocks.sendChannelMessage.mockImplementationOnce(() => {
      throw new Error('unexpected boom');
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text:
        'I have a contract dispute about $75k worth of unpaid product delivered to a vendor.',
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
