/**
 * Pure evaluator tests for the cadence engine (cadence-rules-pure.ts).
 *
 * Covers all three trigger classes, firm-vs-global rule resolution, step
 * scheduling math, due-step selection (ordering + next_step_number gating),
 * last-step detection, and template interpolation. Plus a seed-integrity guard
 * that the seed library's trigger keys match journeyTriggerForTransition, the
 * enrollment invariant.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRuleForFirm,
  matchesFieldChangeTrigger,
  matchesThresholdTrigger,
  matchesTimeRelativeTrigger,
  computeStepScheduledAt,
  dueSteps,
  lastStepNumber,
  interpolateTemplate,
  type CadenceRule,
  type CadenceStep,
  type CadenceRun,
} from '@/lib/cadence-rules-pure';
import { CADENCE_SEED_LIBRARY } from '@/lib/cadence-seed';
import { journeyTriggerForTransition } from '@/lib/matter-stage-pure';

const RULE_ID = 'rule-1';

function rule(overrides: Partial<CadenceRule> = {}): CadenceRule {
  return {
    id: RULE_ID,
    firm_id: null,
    cadence_key: 'J6',
    name: 'Retainer Awaiting',
    trigger_type: 'field_change',
    trigger_config: { cadence_trigger: 'retainer_awaiting' },
    channel: 'email',
    enabled: true,
    ...overrides,
  };
}

function step(overrides: Partial<CadenceStep> = {}): CadenceStep {
  return {
    id: `s-${overrides.step_number ?? 1}`,
    cadence_rule_id: RULE_ID,
    step_number: 1,
    delay_hours: 0,
    channel: 'email',
    subject_template: 's',
    body_template: 'b',
    active: true,
    ...overrides,
  };
}

function run(overrides: Partial<CadenceRun> = {}): CadenceRun {
  return {
    id: 'run-1',
    firm_id: 'firm-1',
    cadence_rule_id: RULE_ID,
    cadence_key: 'J6',
    matter_id: 'matter-1',
    screened_lead_id: 'lead-1',
    anchor_at: '2026-07-03T00:00:00.000Z',
    status: 'active',
    next_step_number: 1,
    ...overrides,
  };
}

describe('resolveRuleForFirm', () => {
  it('prefers a firm override over the global default', () => {
    const global = rule({ id: 'g', firm_id: null });
    const firm = rule({ id: 'f', firm_id: 'firm-1' });
    expect(resolveRuleForFirm([global, firm], 'firm-1', 'J6')?.id).toBe('f');
  });

  it('falls back to the global default when no firm override exists', () => {
    const global = rule({ id: 'g', firm_id: null });
    expect(resolveRuleForFirm([global], 'firm-1', 'J6')?.id).toBe('g');
  });

  it('ignores disabled rules', () => {
    const global = rule({ id: 'g', firm_id: null, enabled: false });
    expect(resolveRuleForFirm([global], 'firm-1', 'J6')).toBeNull();
  });

  it('a disabled firm override falls through to the global default', () => {
    const global = rule({ id: 'g', firm_id: null });
    const firm = rule({ id: 'f', firm_id: 'firm-1', enabled: false });
    expect(resolveRuleForFirm([global, firm], 'firm-1', 'J6')?.id).toBe('g');
  });

  it('returns null when nothing matches the cadence key', () => {
    expect(resolveRuleForFirm([rule()], 'firm-1', 'J99')).toBeNull();
  });
});

describe('matchesFieldChangeTrigger', () => {
  it('matches when the cadence_trigger equals the config', () => {
    expect(matchesFieldChangeTrigger(rule(), 'retainer_awaiting')).toBe(true);
  });
  it('does not match a different trigger', () => {
    expect(matchesFieldChangeTrigger(rule(), 'client_won')).toBe(false);
  });
  it('does not match a null trigger', () => {
    expect(matchesFieldChangeTrigger(rule(), null)).toBe(false);
  });
  it('does not match when the rule is not field_change', () => {
    expect(matchesFieldChangeTrigger(rule({ trigger_type: 'threshold' }), 'retainer_awaiting')).toBe(false);
  });
  it('does not match a disabled rule', () => {
    expect(matchesFieldChangeTrigger(rule({ enabled: false }), 'retainer_awaiting')).toBe(false);
  });
});

describe('matchesThresholdTrigger', () => {
  const r = rule({ trigger_type: 'threshold', trigger_config: { field: 'value_score', op: '>=', value: 7 } });
  it('matches when the field crosses the boundary', () => {
    expect(matchesThresholdTrigger(r, { value_score: 8 })).toBe(true);
    expect(matchesThresholdTrigger(r, { value_score: 7 })).toBe(true);
  });
  it('does not match below the boundary', () => {
    expect(matchesThresholdTrigger(r, { value_score: 6 })).toBe(false);
  });
  it('handles all operators', () => {
    expect(matchesThresholdTrigger(rule({ trigger_type: 'threshold', trigger_config: { field: 'x', op: '>', value: 5 } }), { x: 6 })).toBe(true);
    expect(matchesThresholdTrigger(rule({ trigger_type: 'threshold', trigger_config: { field: 'x', op: '<=', value: 5 } }), { x: 5 })).toBe(true);
    expect(matchesThresholdTrigger(rule({ trigger_type: 'threshold', trigger_config: { field: 'x', op: '<', value: 5 } }), { x: 4 })).toBe(true);
    expect(matchesThresholdTrigger(rule({ trigger_type: 'threshold', trigger_config: { field: 'x', op: '==', value: 5 } }), { x: 5 })).toBe(true);
  });
  it('fails closed on a missing or non-numeric field', () => {
    expect(matchesThresholdTrigger(r, {})).toBe(false);
    expect(matchesThresholdTrigger(r, { value_score: null })).toBe(false);
    expect(matchesThresholdTrigger(r, { value_score: NaN })).toBe(false);
  });
  it('fails closed on a malformed config', () => {
    expect(matchesThresholdTrigger(rule({ trigger_type: 'threshold', trigger_config: { op: '>=', value: 7 } }), { value_score: 8 })).toBe(false);
    expect(matchesThresholdTrigger(rule({ trigger_type: 'threshold', trigger_config: { field: 'x', op: '??', value: 7 } }), { x: 8 })).toBe(false);
  });
});

describe('matchesTimeRelativeTrigger', () => {
  const r = rule({ trigger_type: 'time_relative', trigger_config: { anchor: 'retained_date', offset_days: 180 } });
  it('matches at or after anchor + offset', () => {
    const anchor = '2026-01-01T00:00:00.000Z';
    const atOffset = new Date('2026-06-30T00:00:00.000Z'); // 180 days later
    expect(matchesTimeRelativeTrigger(r, anchor, atOffset)).toBe(true);
  });
  it('does not match before anchor + offset', () => {
    const anchor = '2026-01-01T00:00:00.000Z';
    const early = new Date('2026-03-01T00:00:00.000Z');
    expect(matchesTimeRelativeTrigger(r, anchor, early)).toBe(false);
  });
  it('fails closed on a null or invalid anchor', () => {
    const now = new Date('2027-01-01T00:00:00.000Z');
    expect(matchesTimeRelativeTrigger(r, null, now)).toBe(false);
    expect(matchesTimeRelativeTrigger(r, 'not-a-date', now)).toBe(false);
  });
  it('fails closed on a missing offset_days', () => {
    const bad = rule({ trigger_type: 'time_relative', trigger_config: { anchor: 'retained_date' } });
    expect(matchesTimeRelativeTrigger(bad, '2026-01-01T00:00:00.000Z', new Date('2027-01-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('computeStepScheduledAt', () => {
  it('adds delay_hours to the anchor', () => {
    const at = computeStepScheduledAt('2026-07-03T00:00:00.000Z', 48);
    expect(at.toISOString()).toBe('2026-07-05T00:00:00.000Z');
  });
  it('a zero delay returns the anchor', () => {
    const at = computeStepScheduledAt('2026-07-03T00:00:00.000Z', 0);
    expect(at.toISOString()).toBe('2026-07-03T00:00:00.000Z');
  });
});

describe('dueSteps', () => {
  const steps = [
    step({ step_number: 1, delay_hours: 0 }),
    step({ step_number: 2, delay_hours: 48 }),
    step({ step_number: 3, delay_hours: 240 }),
  ];

  it('returns steps whose scheduled time has passed, from next_step_number onward', () => {
    const now = new Date('2026-07-05T01:00:00.000Z'); // anchor + ~49h
    const d = dueSteps(run({ next_step_number: 1 }), steps, now);
    expect(d.map((s) => s.step_number)).toEqual([1, 2]);
  });

  it('excludes steps below next_step_number (already processed)', () => {
    const now = new Date('2026-07-05T01:00:00.000Z');
    const d = dueSteps(run({ next_step_number: 2 }), steps, now);
    expect(d.map((s) => s.step_number)).toEqual([2]);
  });

  it('excludes future steps', () => {
    const now = new Date('2026-07-03T00:30:00.000Z'); // only step 1 (delay 0) due
    const d = dueSteps(run({ next_step_number: 1 }), steps, now);
    expect(d.map((s) => s.step_number)).toEqual([1]);
  });

  it('excludes inactive steps', () => {
    const withInactive = [...steps, step({ step_number: 4, delay_hours: 0, active: false })];
    const now = new Date('2026-08-01T00:00:00.000Z');
    const d = dueSteps(run({ next_step_number: 1 }), withInactive, now);
    expect(d.map((s) => s.step_number)).toEqual([1, 2, 3]);
  });

  it('ignores steps belonging to a different rule', () => {
    const other = step({ step_number: 1, delay_hours: 0, cadence_rule_id: 'other-rule' });
    const now = new Date('2026-08-01T00:00:00.000Z');
    const d = dueSteps(run({ next_step_number: 1 }), [...steps, other], now);
    expect(d.every((s) => s.cadence_rule_id === RULE_ID)).toBe(true);
  });
});

describe('lastStepNumber', () => {
  it('returns the highest active step number for the rule', () => {
    const steps = [step({ step_number: 1 }), step({ step_number: 2 }), step({ step_number: 3, active: false })];
    expect(lastStepNumber(steps, RULE_ID)).toBe(2);
  });
  it('returns 0 when the rule has no active steps', () => {
    expect(lastStepNumber([], RULE_ID)).toBe(0);
    expect(lastStepNumber([step({ active: false })], RULE_ID)).toBe(0);
  });
});

describe('interpolateTemplate', () => {
  it('substitutes known tokens', () => {
    expect(interpolateTemplate('Hi {first_name} at {firm_name}', { first_name: 'Ana', firm_name: 'DRG Law' }))
      .toBe('Hi Ana at DRG Law');
  });
  it('renders null/undefined values as empty string', () => {
    expect(interpolateTemplate('Hi {first_name}', { first_name: null })).toBe('Hi ');
  });
  it('leaves unknown tokens intact (visible authoring error)', () => {
    expect(interpolateTemplate('Hi {mystery}', { first_name: 'Ana' })).toBe('Hi {mystery}');
  });
});

describe('seed library integrity', () => {
  it('has the four launch cadences', () => {
    expect(CADENCE_SEED_LIBRARY.map((r) => r.cadence_key).sort()).toEqual(['J11', 'J6', 'J7', 'J9']);
  });

  it('every seed trigger is a real journeyTriggerForTransition output (enrollment invariant)', () => {
    // The set of cadence_triggers the stage machine can emit.
    const emitted = new Set(
      [
        journeyTriggerForTransition('intake', 'retainer_pending'),
        journeyTriggerForTransition('retainer_pending', 'active'),
        journeyTriggerForTransition('active', 'closing'),
        journeyTriggerForTransition('closing', 'closed'),
      ].filter((x): x is string => !!x),
    );
    for (const r of CADENCE_SEED_LIBRARY) {
      expect(emitted.has(r.cadence_trigger)).toBe(true);
    }
  });

  it('J9 keeps the documented 0/72/168 hour cadence', () => {
    const j9 = CADENCE_SEED_LIBRARY.find((r) => r.cadence_key === 'J9')!;
    expect(j9.steps.map((s) => s.delay_hours)).toEqual([0, 72, 168]);
  });

  it('step numbers are contiguous from 1 within each cadence', () => {
    for (const r of CADENCE_SEED_LIBRARY) {
      const nums = r.steps.map((s) => s.step_number);
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    }
  });
});
