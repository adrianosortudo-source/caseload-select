import { describe, it, expect, vi, beforeEach } from 'vitest';

interface TableState {
  maybeSingle?: { data: unknown; error: unknown };
  upsertResult?: { error: unknown };
}
const state: { tables: Record<string, TableState>; upserts: Record<string, unknown>[][] } = { tables: {}, upserts: [] };

function builder(table: string) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.maybeSingle = () => Promise.resolve(state.tables[table]?.maybeSingle ?? { data: null, error: null });
  b.upsert = (rows: Record<string, unknown>[]) => {
    state.upserts.push(rows);
    return Promise.resolve(state.tables[table]?.upsertResult ?? { error: null });
  };
  return b;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const fetchContactsMock = vi.fn();
const fetchConversationsMock = vi.fn();
vi.mock('@/lib/ghl-export-api', () => ({
  fetchGhlContacts: (...args: unknown[]) => fetchContactsMock(...args),
  fetchGhlConversations: (...args: unknown[]) => fetchConversationsMock(...args),
}));

import { exportGhlHistoryForFirm } from '@/lib/ghl-export';

function resetState() { state.tables = {}; state.upserts = []; }

describe('exportGhlHistoryForFirm', () => {
  beforeEach(() => {
    resetState();
    fetchContactsMock.mockReset();
    fetchConversationsMock.mockReset();
  });

  it('returns ok:false when the firm does not exist', async () => {
    state.tables['intake_firms'] = { maybeSingle: { data: null, error: null } };
    const result = await exportGhlHistoryForFirm('missing-firm');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/firm not found/);
  });

  it('imports both contacts and conversations on a successful pull', async () => {
    state.tables['intake_firms'] = { maybeSingle: { data: { voice_api_token: 'tok', ghl_location_id: 'loc-1' }, error: null } };
    fetchContactsMock.mockResolvedValue({ ok: true, contacts: [{ id: 'c1', raw: { id: 'c1' } }, { id: 'c2', raw: { id: 'c2' } }] });
    fetchConversationsMock.mockResolvedValue({ ok: true, conversations: [{ id: 'conv1', contactId: 'c1', raw: { id: 'conv1' } }] });

    const result = await exportGhlHistoryForFirm('firm-1');
    expect(result).toMatchObject({ ok: true, contactsImported: 2, conversationsImported: 1 });
    expect(state.upserts).toHaveLength(2);
  });

  it('reports partial success when contacts fail but conversations succeed', async () => {
    state.tables['intake_firms'] = { maybeSingle: { data: { voice_api_token: 'tok', ghl_location_id: 'loc-1' }, error: null } };
    fetchContactsMock.mockResolvedValue({ ok: false, reason: 'http_error', status: 403 });
    fetchConversationsMock.mockResolvedValue({ ok: true, conversations: [{ id: 'conv1', contactId: null, raw: {} }] });

    const result = await exportGhlHistoryForFirm('firm-1');
    expect(result.ok).toBe(true);
    expect(result.contactsImported).toBe(0);
    expect(result.conversationsImported).toBe(1);
  });

  it('returns ok:false with both failure reasons when both calls fail', async () => {
    state.tables['intake_firms'] = { maybeSingle: { data: { voice_api_token: null, ghl_location_id: 'loc-1' }, error: null } };
    fetchContactsMock.mockResolvedValue({ ok: false, reason: 'no_token' });
    fetchConversationsMock.mockResolvedValue({ ok: false, reason: 'no_token' });

    const result = await exportGhlHistoryForFirm('firm-1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no_token/);
  });

  it('imports nothing when the firm has zero contacts and conversations, still ok', async () => {
    state.tables['intake_firms'] = { maybeSingle: { data: { voice_api_token: 'tok', ghl_location_id: 'loc-1' }, error: null } };
    fetchContactsMock.mockResolvedValue({ ok: true, contacts: [] });
    fetchConversationsMock.mockResolvedValue({ ok: true, conversations: [] });

    const result = await exportGhlHistoryForFirm('firm-1');
    expect(result).toEqual({ ok: true, contactsImported: 0, conversationsImported: 0 });
    expect(state.upserts).toHaveLength(0);
  });
});
