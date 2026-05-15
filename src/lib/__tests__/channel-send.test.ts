/**
 * Channel-send dispatcher tests + follow-up phrasing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMessengerMessage: vi.fn(),
  sendInstagramMessage: vi.fn(),
  sendWhatsappMessage: vi.fn(),
  firmRow: { facebook_page_access_token: null, whatsapp_cloud_api_access_token: null } as {
    facebook_page_access_token: string | null;
    whatsapp_cloud_api_access_token: string | null;
  },
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

import { sendChannelMessage, buildContactCaptureFollowUp } from '../channel-send';

beforeEach(() => {
  mocks.sendMessengerMessage.mockReset();
  mocks.sendInstagramMessage.mockReset();
  mocks.sendWhatsappMessage.mockReset();
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
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/whatsapp_cloud_api_access_token/);
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
});
