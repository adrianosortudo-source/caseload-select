import { describe, it, expect, vi, afterEach } from 'vitest';
import { upsertGhlContact, addGhlTags, setGhlContactCustomFields } from '@/lib/ghl-contacts-write-api';

afterEach(() => vi.unstubAllGlobals());

describe('upsertGhlContact', () => {
  it('fails with no_token when the token is missing', async () => {
    const result = await upsertGhlContact('loc-1', null, { email: 'a@b.com' });
    expect(result).toEqual({ ok: false, reason: 'no_token' });
  });

  it('fails with no_location_id when the location is missing', async () => {
    const result = await upsertGhlContact(null, 'tok', { email: 'a@b.com' });
    expect(result).toEqual({ ok: false, reason: 'no_location_id' });
  });

  it('fails with invalid_input when the email is missing or malformed', async () => {
    expect(await upsertGhlContact('loc-1', 'tok', { email: '' })).toEqual({
      ok: false,
      reason: 'invalid_input',
      detail: 'missing or invalid email',
    });
    expect(await upsertGhlContact('loc-1', 'tok', { email: 'not-an-email' })).toEqual({
      ok: false,
      reason: 'invalid_input',
      detail: 'missing or invalid email',
    });
  });

  it('POSTs to /contacts/upsert with the expected headers and body on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contact: { id: 'contact-1' }, new: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await upsertGhlContact('loc-1', 'tok', {
      email: 'lead@example.com',
      firstName: 'Ana',
      source: 'checklist_lead_magnet_form',
    });

    expect(result).toEqual({ ok: true, contactId: 'contact-1', isNew: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/contacts/upsert');
    const opts = options as { method: string; headers: Record<string, string>; body: string };
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.headers.Version).toBe('2021-07-28');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      locationId: 'loc-1',
      email: 'lead@example.com',
      firstName: 'Ana',
      source: 'checklist_lead_magnet_form',
    });
  });

  it('never sends a tags field, even if a caller tried to pass one', async () => {
    // upsertGhlContact's own type signature has no `tags` param at all -- this
    // test pins that the request body genuinely never carries one, since
    // GHL's upsert `tags` field overwrites a contact's whole tag list.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contact: { id: 'c1' } }) });
    vi.stubGlobal('fetch', fetchMock);
    await upsertGhlContact('loc-1', 'tok', { email: 'a@b.com' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.tags).toBeUndefined();
  });

  it('includes customFields by key when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contact: { id: 'c1' } }) });
    vi.stubGlobal('fetch', fetchMock);
    await upsertGhlContact('loc-1', 'tok', {
      email: 'a@b.com',
      customFields: [{ key: 'consent_text_version', field_value: 'v4' }],
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.customFields).toEqual([{ key: 'consent_text_version', field_value: 'v4' }]);
  });

  it('reports http_error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }));
    const result = await upsertGhlContact('loc-1', 'bad-tok', { email: 'a@b.com' });
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 401, detail: 'unauthorized' });
  });

  it('reports network_error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS fail')));
    const result = await upsertGhlContact('loc-1', 'tok', { email: 'a@b.com' });
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'DNS fail' });
  });

  it('reports bad_response_shape when the response has no usable contact id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'weird' }) }));
    const result = await upsertGhlContact('loc-1', 'tok', { email: 'a@b.com' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_response_shape');
  });

  it('defaults isNew to false when the response omits the new flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contact: { id: 'c1' } }) }));
    const result = await upsertGhlContact('loc-1', 'tok', { email: 'a@b.com' });
    expect(result).toEqual({ ok: true, contactId: 'c1', isNew: false });
  });
});

describe('addGhlTags', () => {
  it('fails with no_token when the token is missing', async () => {
    expect(await addGhlTags('c1', null, ['lead-magnet'])).toEqual({ ok: false, reason: 'no_token' });
  });

  it('fails with invalid_input when contactId is missing', async () => {
    expect(await addGhlTags(null, 'tok', ['lead-magnet'])).toEqual({
      ok: false,
      reason: 'invalid_input',
      detail: 'missing contactId',
    });
  });

  it('short-circuits to ok:true without a network call when tags is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await addGhlTags('c1', 'tok', []);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to /contacts/{id}/tags with the tag list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await addGhlTags('contact-1', 'tok', ['lead-magnet', 'asset:renewal-clause-checklist']);
    expect(result).toEqual({ ok: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/contacts/contact-1/tags');
    const opts = options as { method: string; body: string };
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ tags: ['lead-magnet', 'asset:renewal-clause-checklist'] });
  });

  it('reports http_error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' }));
    const result = await addGhlTags('missing-contact', 'tok', ['lead-magnet']);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 404, detail: 'not found' });
  });
});

describe('setGhlContactCustomFields', () => {
  it('fails with no_token when the token is missing', async () => {
    expect(await setGhlContactCustomFields('c1', null, [{ key: 'x', field_value: 'y' }])).toEqual({
      ok: false,
      reason: 'no_token',
    });
  });

  it('short-circuits to ok:true without a network call when customFields is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await setGhlContactCustomFields('c1', 'tok', []);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUTs to /contacts/{id} with the custom fields, isolated from the upsert call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const fields = [{ key: 'consent_text_version', field_value: 'checklist-consent-2026-07-27-v4' }];
    const result = await setGhlContactCustomFields('contact-1', 'tok', fields);
    expect(result).toEqual({ ok: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://services.leadconnectorhq.com/contacts/contact-1');
    const opts = options as { method: string; body: string };
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ customFields: fields });
  });

  it('reports http_error on a non-ok response without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'unknown field key' }));
    const result = await setGhlContactCustomFields('c1', 'tok', [{ key: 'bogus', field_value: 'x' }]);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 422, detail: 'unknown field key' });
  });
});
