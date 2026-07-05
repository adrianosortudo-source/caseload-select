import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchGhlContacts, fetchGhlConversations } from '@/lib/ghl-export-api';

afterEach(() => vi.unstubAllGlobals());

describe('fetchGhlContacts', () => {
  it('fails with no_token when the token is missing', async () => {
    const result = await fetchGhlContacts('loc-1', null);
    expect(result).toEqual({ ok: false, reason: 'no_token' });
  });

  it('fails with no_location_id when the location is missing', async () => {
    const result = await fetchGhlContacts(null, 'tok');
    expect(result).toEqual({ ok: false, reason: 'no_location_id' });
  });

  it('returns normalised contacts on a successful call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contacts: [{ id: 'c1', name: 'Ana' }, { id: 'c2', name: 'Bob' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGhlContacts('loc-1', 'tok');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contacts).toHaveLength(2);
      expect(result.contacts[0].id).toBe('c1');
    }
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/contacts/?locationId=loc-1');
    expect((options as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok');
  });

  it('reports http_error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }));
    const result = await fetchGhlContacts('loc-1', 'bad-tok');
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 401, detail: 'unauthorized' });
  });

  it('reports network_error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS fail')));
    const result = await fetchGhlContacts('loc-1', 'tok');
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'DNS fail' });
  });

  it('reports bad_response_shape when contacts is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'weird' }) }));
    const result = await fetchGhlContacts('loc-1', 'tok');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_response_shape');
  });

  it('filters out contacts with no usable id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [{ name: 'no id' }, { id: 'c1' }] }) }));
    const result = await fetchGhlContacts('loc-1', 'tok');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contacts).toEqual([{ id: 'c1', raw: { id: 'c1' } }]);
  });
});

describe('fetchGhlConversations', () => {
  it('fails with no_token when the token is missing', async () => {
    expect(await fetchGhlConversations('loc-1', undefined)).toEqual({ ok: false, reason: 'no_token' });
  });

  it('scopes the request to a contactId when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ conversations: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await fetchGhlConversations('loc-1', 'tok', { contactId: 'contact-9' });
    expect(fetchMock.mock.calls[0][0]).toContain('contactId=contact-9');
  });

  it('returns normalised conversations with contactId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversations: [{ id: 'conv1', contactId: 'contact-1' }] }),
    }));
    const result = await fetchGhlConversations('loc-1', 'tok');
    expect(result).toEqual({ ok: true, conversations: [{ id: 'conv1', contactId: 'contact-1', raw: { id: 'conv1', contactId: 'contact-1' } }] });
  });
});
