import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readHighLevelArchive } from '../highlevel-reader';

const LOCATION = 'xXhW340nWLAJhOPzLbAA';
const records = Array.from({ length: 100 }, (_, index) => ({
  cls_record_id: `${index < 50 ? 'BA' : 'AE'}-B1-${String((index % 50) + 1).padStart(2, '0')}`,
  arm: index < 50 ? 'BA' as const : 'AE' as const,
  highlevel_location_id: LOCATION,
  highlevel_contact_id: `contact-${index + 1}`,
}));

function response(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('HighLevel archive reader', () => {
  it('uses only exact contact and conversation GETs, records an exact inbound reply, and never calls a location-wide export', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchLike = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(String(url));
      calls.push({ url: parsed.pathname + parsed.search, method: init?.method ?? 'GET' });
      if (parsed.pathname.startsWith('/contacts/')) {
        const id = decodeURIComponent(parsed.pathname.split('/').at(-1)!);
        return response({ contact: { id, locationId: LOCATION } });
      }
      if (parsed.pathname === '/conversations/search') {
        const contactId = parsed.searchParams.get('contactId')!;
        return response({ conversations: [{ id: `conversation-${contactId}`, contactId }] });
      }
      if (parsed.pathname.includes('/messages')) {
        const contactId = parsed.pathname.replace('/conversations/conversation-', '').replace('/messages', '');
        return response({ messages: contactId === 'contact-1' ? [
          { id: 'sent-1', contactId, direction: 'outbound', dateAdded: '2026-09-11T12:00:00.000Z', subject: 'Hello', body: 'A message' },
          { id: 'auto-1', contactId, direction: 'inbound', dateAdded: '2026-09-11T12:01:00.000Z', subject: 'Automatic reply', body: 'Out of office' },
          { id: 'inbound-1', contactId, direction: 'inbound', dateAdded: '2026-09-11T12:02:00.000Z', subject: 'Interested', body: 'Please send it' },
        ] : [] });
      }
      throw new Error(`Unexpected URL ${parsed}`);
    }) as unknown as typeof fetch;

    const result = await readHighLevelArchive({ records, highlevelLocationId: LOCATION, token: 'test-token', fetchLike, now: new Date('2026-09-11T13:00:00.000Z') });

    expect(result.contacts_read).toBe(100);
    expect(result.bundle.provider_events).toMatchObject([
      { provider_event_id: 'sent-1', kind: 'message_sent', highlevel_contact_id: 'contact-1' },
      { provider_event_id: 'auto-1', kind: 'automated_reply', highlevel_contact_id: 'contact-1' },
      { provider_event_id: 'inbound-1', kind: 'human_reply', highlevel_contact_id: 'contact-1' },
    ]);
    expect(result.issues).toHaveLength(0);
    expect(result.bundle.history_observations.filter((item) => item.history_coverage === 'known_empty')).toHaveLength(99);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.some((call) => call.url.includes('/conversations/messages/export') || call.url.includes('/workflows'))).toBe(false);
    expect(calls.some((call) => call.url.includes('contactId=contact-1'))).toBe(true);
  });

  it('stops the entire read before a cohort sweep when the authenticated preflight returns a different location', async () => {
    const fetchLike = vi.fn(async () => response({ contact: { id: 'contact-1', locationId: 'another-location' } })) as unknown as typeof fetch;
    await expect(readHighLevelArchive({ records, highlevelLocationId: LOCATION, token: 'test-token', fetchLike })).rejects.toThrow(/preflight/);
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });
});
