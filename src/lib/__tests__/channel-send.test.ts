/**
 * Channel-send dispatcher tests + follow-up phrasing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMessengerMessage: vi.fn(),
  sendInstagramMessage: vi.fn(),
  sendWhatsappMessage: vi.fn(),
  validateChannelText: vi.fn(),
  normalizeAuthoritativeInboundAt: vi.fn(),
  isChannelReplyWindowOpen: vi.fn(),
  resolveScreenedLeadIdForFirm: vi.fn(),
  loadChannelConversation: vi.fn(),
  claimOutboundConversationEvent: vi.fn(),
  loadOutboundConversationResult: vi.fn(),
  recordOutboundConversationResult: vi.fn(),
  firmRow: { facebook_page_access_token: null, whatsapp_cloud_api_access_token: null } as {
    facebook_page_access_token: string | null;
    whatsapp_cloud_api_access_token: string | null;
  },
}));

vi.mock('@/lib/channel-conversation', () => ({
  validateChannelText: mocks.validateChannelText,
  normalizeAuthoritativeInboundAt: mocks.normalizeAuthoritativeInboundAt,
  isChannelReplyWindowOpen: mocks.isChannelReplyWindowOpen,
  resolveScreenedLeadIdForFirm: mocks.resolveScreenedLeadIdForFirm,
  loadChannelConversation: mocks.loadChannelConversation,
  claimOutboundConversationEvent: mocks.claimOutboundConversationEvent,
  loadOutboundConversationResult: mocks.loadOutboundConversationResult,
  recordOutboundConversationResult: mocks.recordOutboundConversationResult,
}));

vi.mock('@/lib/messenger-send', () => ({
  sendMessengerMessage: mocks.sendMessengerMessage,
}));
vi.mock('@/lib/instagram-send', () => ({
  sendInstagramMessage: mocks.sendInstagramMessage,
}));
vi.mock('@/lib/whatsapp-send', () => ({
  sendWhatsappMessage: mocks.sendWhatsappMessage,
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_field: string, _v: unknown) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { ...mocks.firmRow },
              error: null,
            }),
        }),
      }),
    }),
  },
}));

import {
  sendChannelMessage,
  buildContactCaptureFollowUp,
  buildContactCaptureExhaustedMessage,
} from '../channel-send';

beforeEach(() => {
  mocks.sendMessengerMessage.mockReset();
  mocks.sendInstagramMessage.mockReset();
  mocks.sendWhatsappMessage.mockReset();
  mocks.validateChannelText.mockReset();
  mocks.validateChannelText.mockReturnValue({ valid: true });
  mocks.normalizeAuthoritativeInboundAt.mockReset();
  mocks.normalizeAuthoritativeInboundAt.mockImplementation((value) => value ?? null);
  mocks.isChannelReplyWindowOpen.mockReset();
  mocks.isChannelReplyWindowOpen.mockImplementation((value) => !!value);
  mocks.resolveScreenedLeadIdForFirm.mockReset();
  mocks.resolveScreenedLeadIdForFirm.mockResolvedValue('11111111-1111-4111-8111-111111111111');
  mocks.loadChannelConversation.mockReset();
  mocks.loadChannelConversation.mockResolvedValue({
    messages: [],
    replyWindow: { isOpen: true, reason: 'open' },
  });
  mocks.claimOutboundConversationEvent.mockReset();
  mocks.claimOutboundConversationEvent.mockResolvedValue({ claimed: true, duplicate: false });
  mocks.loadOutboundConversationResult.mockReset();
  mocks.loadOutboundConversationResult.mockResolvedValue(null);
  mocks.recordOutboundConversationResult.mockReset();
  mocks.recordOutboundConversationResult.mockResolvedValue({
    recorded: true,
    duplicate: false,
  });
  mocks.firmRow = {
    facebook_page_access_token: null,
    whatsapp_cloud_api_access_token: null,
  };
});

describe('sendChannelMessage', () => {
  it('routes facebook to sendMessengerMessage with the Page token', async () => {
    mocks.firmRow.facebook_page_access_token = 'PAGE_TOK';
    mocks.sendMessengerMessage.mockResolvedValueOnce({ sent: true, messageId: 'mid' });

    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'facebook',
        senderPsid: 'psid',
        senderName: null,
        messageMid: 'mid_in',
        pageId: 'page-1',
      },
      text: 'hi',
      authoritativeInboundAt: '2026-09-01T12:00:00.000Z',
    });
    expect(r.sent).toBe(true);
    expect(mocks.sendMessengerMessage).toHaveBeenCalledWith({
      pageId: 'page-1',
      pageAccessToken: 'PAGE_TOK',
      recipientPsid: 'psid',
      text: 'hi',
    });
  });

  it('routes instagram to sendInstagramMessage using the linked Page token', async () => {
    mocks.firmRow.facebook_page_access_token = 'PAGE_TOK';
    mocks.sendInstagramMessage.mockResolvedValueOnce({ sent: true, messageId: 'mid' });

    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'instagram',
        senderIgsid: 'igsid',
        senderName: null,
        messageMid: 'mid_in',
        igBusinessAccountId: 'iga-1',
      },
      text: 'hi',
      authoritativeInboundAt: '2026-09-01T12:00:00.000Z',
    });
    expect(r.sent).toBe(true);
    expect(mocks.sendInstagramMessage).toHaveBeenCalledWith({
      igBusinessAccountId: 'iga-1',
      pageAccessToken: 'PAGE_TOK',
      recipientIgsid: 'igsid',
      text: 'hi',
    });
  });

  it('routes whatsapp to sendWhatsappMessage with the WA token', async () => {
    mocks.firmRow.whatsapp_cloud_api_access_token = 'WA_TOK';
    mocks.sendWhatsappMessage.mockResolvedValueOnce({ sent: true, messageId: 'wamid' });

    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'whatsapp',
        senderWaId: '14165550143',
        senderName: null,
        messageMid: 'mid_in',
        phoneNumberId: 'pnid',
      },
      text: 'hi',
      authoritativeInboundAt: '2026-09-01T12:00:00.000Z',
    });
    expect(r.sent).toBe(true);
    expect(mocks.sendWhatsappMessage).toHaveBeenCalledWith({
      phoneNumberId: 'pnid',
      accessToken: 'WA_TOK',
      recipientWaId: '14165550143',
      text: 'hi',
    });
  });

  it('returns sent=false when the firm has no facebook_page_access_token', async () => {
    // tokens left null
    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'facebook',
        senderPsid: 'psid',
        senderName: null,
        messageMid: 'mid_in',
        pageId: 'page-1',
      },
      text: 'hi',
      authoritativeInboundAt: '2026-09-01T12:00:00.000Z',
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/facebook_page_access_token/);
    expect(mocks.sendMessengerMessage).not.toHaveBeenCalled();
  });

  it('returns sent=false when the firm has no whatsapp token', async () => {
    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'whatsapp',
        senderWaId: '14165550143',
        senderName: null,
        messageMid: 'mid_in',
        phoneNumberId: 'pnid',
      },
      text: 'hi',
      authoritativeInboundAt: '2026-09-01T12:00:00.000Z',
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/whatsapp_cloud_api_access_token/);
  });

  it('fails closed without authoritative inbound evidence', async () => {
    mocks.firmRow.facebook_page_access_token = 'PAGE_TOK';
    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'facebook',
        senderPsid: 'psid',
        senderName: null,
        messageMid: 'mid_in',
        pageId: 'page-1',
      },
      text: 'hi',
    });
    expect(r).toMatchObject({ sent: false, code: 'reply_window_closed' });
    expect(mocks.sendMessengerMessage).not.toHaveBeenCalled();
  });

  it('fails closed before dispatch when the authoritative reply window is closed', async () => {
    mocks.firmRow.facebook_page_access_token = 'PAGE_TOK';
    mocks.loadChannelConversation.mockResolvedValueOnce({
      messages: [],
      replyWindow: { isOpen: false, reason: 'expired' },
    });
    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'facebook',
        senderPsid: 'psid',
        senderName: null,
        messageMid: 'mid_in',
        pageId: 'page-1',
      },
      text: 'hi',
      ledger: {
        screenedLeadId: 'L-2026-09-01-001',
        source: 'operator',
        actorType: 'operator',
        actorId: 'operator-1',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        requireOpenWindow: true,
      },
    });
    expect(r).toMatchObject({ sent: false, code: 'reply_window_closed' });
    expect(mocks.sendMessengerMessage).not.toHaveBeenCalled();
    expect(mocks.claimOutboundConversationEvent).not.toHaveBeenCalled();
  });

  it('claims an operator request and records the terminal send result', async () => {
    mocks.firmRow.facebook_page_access_token = 'PAGE_TOK';
    mocks.sendMessengerMessage.mockResolvedValueOnce({ sent: true, messageId: 'mid-out' });
    const ledger = {
      screenedLeadId: 'L-2026-09-01-001',
      source: 'operator' as const,
      actorType: 'operator' as const,
      actorId: 'operator-1',
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      requireOpenWindow: true,
    };
    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'facebook',
        senderPsid: 'psid',
        senderName: null,
        messageMid: 'mid_in',
        pageId: 'page-1',
      },
      text: 'hi',
      ledger,
    });
    expect(r).toMatchObject({ sent: true, messageId: 'mid-out' });
    expect(mocks.claimOutboundConversationEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordOutboundConversationResult).toHaveBeenCalledWith(
      expect.objectContaining({ sent: true, metaMessageId: 'mid-out' }),
    );
    // Window check before the claim and immediately before the external send.
    expect(mocks.loadChannelConversation).toHaveBeenCalledTimes(2);
  });

  it('returns delivery_unknown after Graph success when terminal recording fails', async () => {
    mocks.firmRow.facebook_page_access_token = 'PAGE_TOK';
    mocks.sendMessengerMessage.mockResolvedValueOnce({ sent: true, messageId: 'mid-out' });
    mocks.recordOutboundConversationResult.mockResolvedValueOnce({
      recorded: false,
      duplicate: false,
    });
    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'facebook', senderPsid: 'psid', senderName: null,
        messageMid: 'mid_in', pageId: 'page-1',
      },
      text: 'hi',
      ledger: {
        screenedLeadId: 'L-2026-09-01-001', source: 'operator',
        actorType: 'operator', actorId: 'operator-1',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(r).toEqual({
      sent: false,
      deliveryUnknown: true,
      messageId: 'mid-out',
      reason: 'delivery occurred but the audit result could not be confirmed',
      code: 'delivery_unknown',
    });
  });

  it('does not call Graph for a duplicate pending claim', async () => {
    mocks.claimOutboundConversationEvent.mockResolvedValueOnce({
      claimed: false, duplicate: true,
    });
    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'facebook', senderPsid: 'psid', senderName: null,
        messageMid: 'mid_in', pageId: 'page-1',
      },
      text: 'hi',
      ledger: {
        screenedLeadId: 'L-2026-09-01-001', source: 'operator',
        actorType: 'operator', actorId: 'operator-1',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(r).toMatchObject({
      sent: false, deliveryUnknown: true, code: 'request_in_progress',
    });
    expect(mocks.sendMessengerMessage).not.toHaveBeenCalled();
  });

  it('returns a reconciled terminal on same-key replay without Graph', async () => {
    mocks.claimOutboundConversationEvent.mockResolvedValueOnce({
      claimed: false, duplicate: true,
    });
    mocks.loadOutboundConversationResult.mockResolvedValueOnce({
      status: 'sent', metaMessageId: 'mid-reconciled', failureReason: null,
    });
    const r = await sendChannelMessage({
      firmId: 'firm-1',
      sender: {
        channel: 'facebook', senderPsid: 'psid', senderName: null,
        messageMid: 'mid_in', pageId: 'page-1',
      },
      text: 'hi',
      ledger: {
        screenedLeadId: 'L-2026-09-01-001', source: 'operator',
        actorType: 'operator', actorId: 'operator-1',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(r).toMatchObject({
      sent: true, messageId: 'mid-reconciled', code: 'duplicate_request',
    });
    expect(mocks.sendMessengerMessage).not.toHaveBeenCalled();
  });
});

describe('buildContactCaptureFollowUp', () => {
  it('asks only for name when reachability is present', () => {
    const msg = buildContactCaptureFollowUp('name');
    expect(msg.toLowerCase()).toMatch(/name/);
  });

  it('asks only for reachability when name is present', () => {
    const msg = buildContactCaptureFollowUp('reachability');
    expect(msg.toLowerCase()).toMatch(/phone|email/);
  });

  it('asks for both when both are missing', () => {
    const msg = buildContactCaptureFollowUp('both');
    expect(msg.toLowerCase()).toMatch(/name/);
    expect(msg.toLowerCase()).toMatch(/phone|email/);
  });

  it('defaults to English when no language is passed (byte-identical to the pre-i18n literal)', () => {
    expect(buildContactCaptureFollowUp('both')).toBe(buildContactCaptureFollowUp('both', 'en'));
  });

  it('Portuguese: all three variants return real translations, distinct from English (2026-08-07)', () => {
    const name = buildContactCaptureFollowUp('name', 'pt');
    const reachability = buildContactCaptureFollowUp('reachability', 'pt');
    const both = buildContactCaptureFollowUp('both', 'pt');

    expect(name).not.toBe(buildContactCaptureFollowUp('name', 'en'));
    expect(reachability).not.toBe(buildContactCaptureFollowUp('reachability', 'en'));
    expect(both).not.toBe(buildContactCaptureFollowUp('both', 'en'));
    expect(new Set([name, reachability, both]).size).toBe(3);
    for (const msg of [name, reachability, both]) {
      expect(msg).not.toContain('—');
    }
  });
});

describe('buildContactCaptureExhaustedMessage', () => {
  it('acknowledges the inbound and names what is still missing (both)', () => {
    const msg = buildContactCaptureExhaustedMessage('both');
    expect(msg.toLowerCase()).toMatch(/thanks/);
    expect(msg.toLowerCase()).toMatch(/name/);
    expect(msg.toLowerCase()).toMatch(/phone|email/);
  });

  it('asks only for name on the name-only branch', () => {
    const msg = buildContactCaptureExhaustedMessage('name');
    expect(msg.toLowerCase()).toMatch(/name/);
    expect(msg.toLowerCase()).not.toMatch(/phone or email/);
  });

  it('asks only for reachability on the reachability-only branch', () => {
    const msg = buildContactCaptureExhaustedMessage('reachability');
    expect(msg.toLowerCase()).toMatch(/phone or email/);
  });

  it('keeps the conversation door open ("reply with that when you\'re ready")', () => {
    const msg = buildContactCaptureExhaustedMessage('both');
    expect(msg.toLowerCase()).toMatch(/reply/);
  });

  it('has no LSO-prohibited "specialist" / "expert" / "guarantee" wording', () => {
    const cases: Array<'name' | 'reachability' | 'both'> = ['name', 'reachability', 'both'];
    for (const c of cases) {
      const msg = buildContactCaptureExhaustedMessage(c).toLowerCase();
      expect(msg).not.toContain('specialist');
      expect(msg).not.toContain('expert');
      expect(msg).not.toContain('guarantee');
      expect(msg).not.toContain('promise');
    }
  });

  it('contains no em dashes (brand rule)', () => {
    const cases: Array<'name' | 'reachability' | 'both'> = ['name', 'reachability', 'both'];
    for (const c of cases) {
      const msg = buildContactCaptureExhaustedMessage(c);
      expect(msg).not.toContain('—');
    }
  });

  it('defaults to English when no language is passed (byte-identical to the pre-i18n literal)', () => {
    expect(buildContactCaptureExhaustedMessage('both')).toBe(
      buildContactCaptureExhaustedMessage('both', 'en'),
    );
  });

  it('Portuguese: all three variants return real translations, distinct from English (2026-08-07)', () => {
    const name = buildContactCaptureExhaustedMessage('name', 'pt');
    const reachability = buildContactCaptureExhaustedMessage('reachability', 'pt');
    const both = buildContactCaptureExhaustedMessage('both', 'pt');

    expect(name).not.toBe(buildContactCaptureExhaustedMessage('name', 'en'));
    expect(reachability).not.toBe(buildContactCaptureExhaustedMessage('reachability', 'en'));
    expect(both).not.toBe(buildContactCaptureExhaustedMessage('both', 'en'));
    expect(new Set([name, reachability, both]).size).toBe(3);
    for (const msg of [name, reachability, both]) {
      expect(msg).not.toContain('—');
    }
  });
});
