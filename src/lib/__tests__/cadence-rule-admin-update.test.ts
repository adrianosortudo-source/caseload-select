/**
 * Atomicity tests for updateCadenceRule (Codex audit 2026-07-07, finding 3).
 *
 * The naive update-parent, delete-steps, insert-steps sequence corrupts a rule
 * if the final insert fails: the parent is updated and the old steps are gone,
 * leaving an enabled rule with zero steps. updateCadenceRule now snapshots the
 * parent + steps first and restores them on any post-first-write failure.
 *
 * The mock is a small STATEFUL in-memory store (one cadence_rules row + a
 * cadence_steps array) so the test asserts the ACTUAL end state, not just that
 * the function returned an error. A toggle forces the new-steps insert to
 * fail; the restore's re-insert of the old steps is allowed through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const store: {
    rule: Record<string, unknown> | null;
    steps: Record<string, unknown>[];
    failNextStepInsert: boolean;
    stepInsertCount: number;
  } = { rule: null, steps: [], failNextStepInsert: false, stepInsertCount: 0 };

  function ruleQuery() {
    let op: 'select' | 'update' | null = null;
    let patch: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => { op = 'select'; return q; },
      update: (p: Record<string, unknown>) => { op = 'update'; patch = p; return q; },
      eq: () => q,
      maybeSingle: () => Promise.resolve({ data: store.rule, error: null }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
        if (op === 'update' && patch && store.rule) {
          store.rule = { ...store.rule, ...patch };
        }
        return Promise.resolve({ data: null, error: null }).then(onF, onR);
      },
    });
    return q;
  }

  function stepQuery() {
    let op: 'select' | 'delete' | 'insert' | null = null;
    let insertRows: Record<string, unknown>[] | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => { op = 'select'; return q; },
      delete: () => { op = 'delete'; return q; },
      insert: (rows: Record<string, unknown>[]) => { op = 'insert'; insertRows = rows; return q; },
      eq: () => q,
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
        if (op === 'select') {
          return Promise.resolve({ data: [...store.steps], error: null }).then(onF, onR);
        }
        if (op === 'delete') {
          store.steps = [];
          return Promise.resolve({ data: null, error: null }).then(onF, onR);
        }
        // insert
        store.stepInsertCount += 1;
        if (store.failNextStepInsert && store.stepInsertCount === 1) {
          return Promise.resolve({ data: null, error: { message: 'step insert boom' } }).then(onF, onR);
        }
        store.steps.push(...(insertRows ?? []));
        return Promise.resolve({ data: null, error: null }).then(onF, onR);
      },
    });
    return q;
  }

  return {
    store,
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'cadence_rules') return ruleQuery();
        if (table === 'cadence_steps') return stepQuery();
        throw new Error(`unexpected table in test: ${table}`);
      },
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: h.supabaseAdmin }));

import { updateCadenceRule } from '@/lib/cadence-rule-admin';

const OLD_STEPS = [
  { step_number: 1, delay_hours: 0, subject_template: 'old-subj-1', body_template: 'old-body-1', active: true, channel: 'email' },
  { step_number: 2, delay_hours: 48, subject_template: 'old-subj-2', body_template: 'old-body-2', active: true, channel: 'email' },
];

function payload() {
  return {
    cadence_key: 'J6',
    name: 'New Name',
    firm_id: null,
    trigger_config: { cadence_trigger: 'retainer_awaiting' },
    exit_config: {},
    enabled: true,
    steps: [
      { step_number: 1, delay_hours: 0, subject_template: 'new-subj-1', body_template: 'new-body-1', active: true },
    ],
  };
}

beforeEach(() => {
  h.store.rule = {
    name: 'Old Name',
    trigger_config: { cadence_trigger: 'retainer_awaiting' },
    exit_config: { matter_stage_not_in: ['retainer_pending'] },
    enabled: true,
  };
  h.store.steps = OLD_STEPS.map((s) => ({ ...s }));
  h.store.failNextStepInsert = false;
  h.store.stepInsertCount = 0;
});

describe('updateCadenceRule atomicity', () => {
  it('applies the update on the happy path (parent + steps replaced)', async () => {
    const result = await updateCadenceRule('rule-1', payload());
    expect(result).toEqual({ ok: true, id: 'rule-1' });
    expect(h.store.rule?.name).toBe('New Name');
    expect(h.store.steps).toHaveLength(1);
    expect(h.store.steps[0].subject_template).toBe('new-subj-1');
  });

  it('restores the parent AND the old steps when the step insert fails', async () => {
    h.store.failNextStepInsert = true;

    const result = await updateCadenceRule('rule-1', payload());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('step insert boom');

    // The corruption the audit found must NOT happen: the rule is not left
    // updated-with-zero-steps. Parent reverted to its snapshot...
    expect(h.store.rule?.name).toBe('Old Name');
    expect(h.store.rule?.enabled).toBe(true);
    expect(h.store.rule?.exit_config).toEqual({ matter_stage_not_in: ['retainer_pending'] });
    // ...and the original steps are back, intact.
    expect(h.store.steps).toHaveLength(2);
    expect(h.store.steps.map((s) => s.subject_template)).toEqual(['old-subj-1', 'old-subj-2']);
    // Crucially, an enabled rule never ends with zero steps.
    expect(h.store.steps.length).toBeGreaterThan(0);
  });

  it('returns not-found without any write when the rule does not exist', async () => {
    h.store.rule = null;
    const result = await updateCadenceRule('missing', payload());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not found');
    // Steps untouched (no delete happened).
    expect(h.store.steps).toHaveLength(2);
  });
});
