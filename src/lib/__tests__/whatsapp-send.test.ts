/**
 * WhatsApp Cloud API Send — request shape and failure paths.
 *
 * Key contrast with Messenger/IG: separate body shape
 * (`messaging_product: 'whatsapp'`, `to`, `type: 'text'`,
 * `text: { body }`), and uses its OWN access token (not the Page token).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendWhatsappMessage } from '../whatsapp-send';

describe('sendWhatsappMessage', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts the WhatsApp-shaped body and strips leading + from wa_id', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await sendWhatsappMessage({
      phoneNumberId: '987654321',
      accessToken: 'WA_TOKEN',
      recipientWaId: '+14165550143',
      text: 'Can you share your name?',
    });

    expect(r.sent).toBe(true);
    expect(r.messageId).toBe('wamid.123');

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://graph.facebook.com/v25.0/987654321/messages');
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      to: '14165550143', // leading + stripped
      type: 'text',
      text: { body: 'Can you share your name?' },
    });
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer WA_TOKEN');
  });

  it('preserves a wa_id without + as-is', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid' }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendWhatsappMessage({
      phoneNumberId: 'pnid',
      accessToken: 'tok',
      recipientWaId: '14165550143',
      text: 'hi',
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe('14165550143');
  });

  it('returns sent=false on 401', async () => {
    globalThis.fetch = (async () =>
      new Response('{"error":{"code":190,"message":"token expired"}}', {
        status: 401,
      })) as typeof fetch;

    const r = await sendWhatsappMessage({
      phoneNumberId: 'pnid',
      accessToken: 'bad',
      recipientWaId: '14165550143',
      text: 'hi',
    });
    expect(r.sent).toBe(false);
    expect(r.status).toBe(401);
  });

  it('rejects missing fields', async () => {
    expect((await sendWhatsappMessage({ phoneNumberId: '', accessToken: 't', recipientWaId: 'w', text: 'x' })).sent).toBe(false);
    expect((await sendWhatsappMessage({ phoneNumberId: 'p', accessToken: '', recipientWaId: 'w', text: 'x' })).sent).toBe(false);
    expect((await sendWhatsappMessage({ phoneNumberId: 'p', accessToken: 't', recipientWaId: '', text: 'x' })).sent).toBe(false);
    expect((await sendWhatsappMessage({ phoneNumberId: 'p', accessToken: 't', recipientWaId: 'w', text: '' })).sent).toBe(false);
  });
});
