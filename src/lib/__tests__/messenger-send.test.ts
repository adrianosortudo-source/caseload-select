/**
 * Messenger Send API helper — request shape and failure paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendMessengerMessage } from '../messenger-send';

describe('sendMessengerMessage', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects missing pageId', async () => {
    const r = await sendMessengerMessage({
      pageId: '',
      pageAccessToken: 'token',
      recipientPsid: 'psid',
      text: 'hello',
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/pageId/);
  });

  it('rejects missing token', async () => {
    const r = await sendMessengerMessage({
      pageId: 'page',
      pageAccessToken: '',
      recipientPsid: 'psid',
      text: 'hello',
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/Token/i);
  });

  it('rejects missing PSID', async () => {
    const r = await sendMessengerMessage({
      pageId: 'page',
      pageAccessToken: 'token',
      recipientPsid: '',
      text: 'hello',
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/recipientPsid/);
  });

  it('rejects empty text', async () => {
    const r = await sendMessengerMessage({
      pageId: 'page',
      pageAccessToken: 'token',
      recipientPsid: 'psid',
      text: '   ',
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/empty/);
  });

  it('posts to Graph v25.0 with correct body shape on success', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ message_id: 'mid_xyz' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await sendMessengerMessage({
      pageId: '1234567890',
      pageAccessToken: 'EAAtoken',
      recipientPsid: 'psid_abc',
      text: 'What is your name and best contact?',
    });

    expect(r.sent).toBe(true);
    expect(r.messageId).toBe('mid_xyz');
    expect(fetchMock).toHaveBeenCalledOnce();

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://graph.facebook.com/v25.0/1234567890/messages');
    const requestInit = call[1] as RequestInit;
    expect(requestInit.method).toBe('POST');
    const headers = requestInit.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer EAAtoken');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(requestInit.body as string);
    expect(body).toEqual({
      recipient: { id: 'psid_abc' },
      message: { text: 'What is your name and best contact?' },
    });
  });

  it('returns sent=false with status on Graph 400', async () => {
    globalThis.fetch = (async () =>
      new Response('{"error":{"message":"bad token"}}', { status: 400 })) as typeof fetch;

    const r = await sendMessengerMessage({
      pageId: 'page',
      pageAccessToken: 'token',
      recipientPsid: 'psid',
      text: 'hello',
    });
    expect(r.sent).toBe(false);
    expect(r.status).toBe(400);
    expect(r.reason).toMatch(/graph 400/);
  });

  it('returns sent=false when fetch throws', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    const r = await sendMessengerMessage({
      pageId: 'page',
      pageAccessToken: 'token',
      recipientPsid: 'psid',
      text: 'hello',
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/ECONNREFUSED/);
  });
});
