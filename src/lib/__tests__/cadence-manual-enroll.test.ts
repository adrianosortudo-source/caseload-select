/**
 * Tests for enrollMatterInCadence (WP-4 manual "Request review" trigger).
 * Same chainable Supabase mock shape as cadence-runner/__tests__/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

interface TableState {
  select?: { data: unknown; error: unknown };
  upsertResult?: { data: unknown; error: unknown };
}
const state: { tables: Record<string, TableState>; upserts: Record<string, unknown>[][] } = { tables: {}, upserts: [] };

function builder(table: string) {
  const b: Record<string, unknown> = {};
  let didUpsert = false;
  b.select = () => b;
  b.eq = () => b;
  b.upsert = (rows: Record<string, unknown>[]) => { didUpsert = true; if (table === 'cadence_runs') state.upserts.push(rows); return b; };
  b.then = (resolve: (v: unknown) => unknown) => {
    if (didUpsert) return Promise.resolve(state.tables[table]?.upsertResult ?? { data: [], error: null }).then(resolve);
    return Promise.resolve(state.tables[table]?.select ?? { data: [], error: null }).then(resolve);
  };
  return b;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

import { enrollMatterInCadence } from '@/lib/cadence-runner';

const J9_RULE = {
  id: 'rule-j9', firm_id: null, cadence_key: 'J9', name: 'Google Review Request',
  trigger_type: 'field_change', trigger_config: { cadence_trigger: 'review_request' },
  channel: 'email', enabled: true,
};

function resetState() { state.tables = {}; state.upserts = []; }

describe('enrollMatterInCadence', () => {
  beforeEach(resetState);

  it('enrolls a matter into the resolved cadence rule', async () => {
    state.tables['cadence_rules'] = { select: { data: [J9_RULE], error: null } };
    state.tables['cadence_runs'] = { upsertResult: { data: [{ id: 'run-1' }], error: null } };

    const result = await enrollMatterInCadence({
      matterId: 'matter-1', firmId: 'firm-1', screenedLeadId: 'lead-1', cadenceKey: 'J9',
    });
    expect(result).toEqual({ ok: true, alreadyEnrolled: false });
  });

  it('reports alreadyEnrolled when the idempotency key already exists (upsert inserts nothing)', async () => {
    state.tables['cadence_rules'] = { select: { data: [J9_RULE], error: null } };
    state.tables['cadence_runs'] = { upsertResult: { data: [], error: null } };

    const result = await enrollMatterInCadence({
      matterId: 'matter-1', firmId: 'firm-1', screenedLeadId: 'lead-1', cadenceKey: 'J9',
    });
    expect(result).toEqual({ ok: true, alreadyEnrolled: true });
  });

  it('fails when no rule exists for the cadence key (firm has none and no global default)', async () => {
    state.tables['cadence_rules'] = { select: { data: [], error: null } };
    const result = await enrollMatterInCadence({
      matterId: 'matter-1', firmId: 'firm-1', screenedLeadId: null, cadenceKey: 'J99',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no enabled rule/);
  });

  it('respects a firm-scoped override over the global default', async () => {
    const firmOverride = { ...J9_RULE, id: 'rule-j9-firm1', firm_id: 'firm-1' };
    state.tables['cadence_rules'] = { select: { data: [J9_RULE, firmOverride], error: null } };
    state.tables['cadence_runs'] = { upsertResult: { data: [{ id: 'run-2' }], error: null } };

    await enrollMatterInCadence({ matterId: 'm', firmId: 'firm-1', screenedLeadId: null, cadenceKey: 'J9' });
    expect(state.upserts[0][0].cadence_rule_id).toBe('rule-j9-firm1');
  });

  it('surfaces the DB error when the rule lookup fails', async () => {
    state.tables['cadence_rules'] = { select: { data: null, error: { message: 'db down' } } };
    const result = await enrollMatterInCadence({ matterId: 'm', firmId: 'f', screenedLeadId: null, cadenceKey: 'J9' });
    expect(result).toEqual({ ok: false, error: 'db down' });
  });
});
