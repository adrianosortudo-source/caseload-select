/**
 * Tests for crm-dual-read.ts's readParties / readActivities. Shipped by an
 * earlier session with zero test coverage; added here (WP-9) because the
 * matter activity timeline (ActivityTimeline.tsx) now depends on it directly,
 * so its correctness is load-bearing for this sprint's new UI surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

interface TableState {
  select?: { data: unknown; error: unknown };
  maybeSingle?: { data: unknown; error: unknown };
}
const state: { tables: Record<string, TableState> } = { tables: {} };

function builder(table: string) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.order = () => Promise.resolve(state.tables[table]?.select ?? { data: [], error: null });
  b.maybeSingle = () => Promise.resolve(state.tables[table]?.maybeSingle ?? { data: null, error: null });
  return b;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

import { readParties, readActivities } from '@/lib/crm-dual-read';

function resetState() { state.tables = {}; }

describe('readParties', () => {
  beforeEach(resetState);

  it('returns canonical rows when the parties table has data', async () => {
    state.tables['parties'] = {
      select: { data: [{ id: 'p1', full_name: 'Ana', email: 'ana@example.com', phone: null, party_role: 'client', is_primary: true }], error: null },
    };
    const result = await readParties('matter-1', 'firm-1');
    expect(result).toEqual([{ id: 'p1', full_name: 'Ana', email: 'ana@example.com', phone: null, party_role: 'client', is_primary: true, source: 'canonical' }]);
  });

  it('falls back to the matter primary contact when parties is empty', async () => {
    state.tables['parties'] = { select: { data: [], error: null } };
    state.tables['client_matters'] = {
      maybeSingle: { data: { primary_name: 'Bob', primary_email: 'bob@example.com', primary_phone: '+1' }, error: null },
    };
    const result = await readParties('matter-1', 'firm-1');
    expect(result).toEqual([{
      id: 'matter-1:primary', full_name: 'Bob', email: 'bob@example.com', phone: '+1',
      party_role: 'client', is_primary: true, source: 'derived',
    }]);
  });

  it('returns an empty array when the matter itself does not exist (fallback path)', async () => {
    state.tables['parties'] = { select: { data: [], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: null, error: null } };
    expect(await readParties('missing', 'firm-1')).toEqual([]);
  });
});

describe('readActivities', () => {
  beforeEach(resetState);

  it('returns canonical rows when the activities table has data, skipping the fallback aggregation', async () => {
    state.tables['activities'] = {
      select: { data: [{ id: 'a1', activity_type: 'promotion', title: 'Matter created', body: null, actor_role: 'system', occurred_at: '2026-07-01T00:00:00.000Z', metadata: null }], error: null },
    };
    const result = await readActivities('matter-1', 'firm-1');
    expect(result).toEqual([{ id: 'a1', activity_type: 'promotion', title: 'Matter created', body: null, actor_role: 'system', occurred_at: '2026-07-01T00:00:00.000Z', metadata: null, source: 'canonical' }]);
  });

  it('aggregates and sorts the three fallback sources chronologically when activities is empty', async () => {
    state.tables['activities'] = { select: { data: [], error: null } };
    state.tables['matter_promotion_events'] = {
      select: { data: [{ id: 'p1', event_type: 'matter_created', lawyer_id: 'l1', error_text: null, created_at: '2026-07-01T00:00:00.000Z' }], error: null },
    };
    state.tables['matter_stage_events'] = {
      select: { data: [{ id: 's1', from_stage: 'intake', to_stage: 'retainer_pending', actor_role: 'staff', actor_id: 'l1', note: null, created_at: '2026-07-02T00:00:00.000Z' }], error: null },
    };
    state.tables['matter_messages'] = {
      select: { data: [{ id: 'm1', channel_type: 'client', recipient_scope: 'individual', sender_role: 'client', body: 'hi', created_at: '2026-07-03T00:00:00.000Z' }], error: null },
    };

    const result = await readActivities('matter-1', 'firm-1');
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.activity_type)).toEqual(['promotion', 'stage_change', 'message']);
    expect(result.every((a) => a.source === 'derived')).toBe(true);
    // Chronological order.
    expect(result.map((a) => a.occurred_at)).toEqual([
      '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z', '2026-07-03T00:00:00.000Z',
    ]);
  });

  it('returns an empty array when both the canonical table and all fallback sources are empty', async () => {
    state.tables['activities'] = { select: { data: [], error: null } };
    state.tables['matter_promotion_events'] = { select: { data: [], error: null } };
    state.tables['matter_stage_events'] = { select: { data: [], error: null } };
    state.tables['matter_messages'] = { select: { data: [], error: null } };
    expect(await readActivities('matter-1', 'firm-1')).toEqual([]);
  });
});
