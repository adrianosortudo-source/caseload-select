/**
 * Business setup advisory band calibration: regression guard.
 *
 * Field-detected 2026-06-07: a solo-owner corporate-advisory file
 * (sole_setup subtrack, sole proprietor at $30-100k revenue, "Already
 * operating" stage, "Just me" decision authority, "Within the next 30
 * days" timeline, no signed exposure, no urgent timing) was landing as
 * Band A "High Priority · Call same day" with a $1,500-3,000 estimated
 * fee. Three calibration causes in band.ts:
 *
 *   1. scoreValueSpecific treated business revenue as legal fee value.
 *      $30-100k sole operator gave +4; should be +2 because the matter
 *      is $1.5-3k of work.
 *   2. scoreUrgency added a flat +4 for "Already operating" regardless
 *      of business scale. A sole consultant proprietorship is not
 *      accumulating dangerous exposure the way a staffed operating
 *      business is.
 *   3. No commodity-demotion gate caught the combined-lift Band A
 *      promotion when readiness was very high.
 *
 * This file pins all three fixes:
 *
 *   - Reproduces the exact intake that surfaced the bug. Asserts Band B
 *     (the correct treatment for a small-ticket solo file).
 *   - Asserts a "signed exposure" variant of the same intake still
 *     lands in Band A (the crisis path that the suppression respects).
 *   - Asserts a partner_setup variant with high-value revenue stays
 *     Band A (the materially-scoped path that the suppression respects).
 *   - Pins the value-tier deltas (4 to 2 for $30-100k, 5 to 4 for
 *     $100-500k).
 *   - Pins the "Already operating" urgency split (+1 when small-solo,
 *     +4 when materially exposed).
 *
 * Any future engine pass that promotes a small-ticket solo advisory
 * file to Band A without the crisis or high-scope signal fails THIS
 * test.
 */

import { describe, it, expect } from 'vitest';
import { computeBand, scoreFourAxes } from '../band';
import type { EngineState } from '../types';

// ─── Fixture builder ─────────────────────────────────────────────────────

interface AdvisoryFixtureOverrides {
  advisory_subtrack?: EngineState['advisory_subtrack'];
  revenue_expectation?: string;
  business_stage?: string;
  signed_anything?: string;
  hiring_timeline?: string;
  other_counsel?: string;
  decision_authority?: string;
  employees_planned?: string;
  cross_border_work?: string;
  ip_planned?: string;
  regulated_industry?: string;
  advisory_timing?: string;
  business_path?: string;
  co_owner_count?: string;
}

/**
 * Build a `business_setup_advisory` EngineState that matches the live
 * intake shape (contact complete, full universal-readiness triple, the
 * core advisory slots that drove the field-detected case). Defaults to
 * the solo-setup intake that surfaced the calibration bug.
 */
function makeAdvisoryState(overrides: AdvisoryFixtureOverrides = {}): EngineState {
  const slots: Record<string, string> = {
    // Contact triple (gate satisfied).
    client_name: 'adriano a domingues',
    client_phone: '+14165550100',
    client_email: 'adrianos@example.com',
    // Universal readiness.
    hiring_timeline: overrides.hiring_timeline ?? 'Within the next 30 days',
    other_counsel: overrides.other_counsel ?? 'No, you are the first',
    decision_authority: overrides.decision_authority ?? 'Just me',
    // Core advisory slots.
    revenue_expectation: overrides.revenue_expectation ?? '$30,000–$100,000 (full-time, sole operator)',
    business_stage: overrides.business_stage ?? 'Already operating',
    signed_anything: overrides.signed_anything ?? 'No',
    employees_planned: overrides.employees_planned ?? 'No, just me',
    cross_border_work: overrides.cross_border_work ?? 'No, Canada only',
    ip_planned: overrides.ip_planned ?? 'Yes, a brand name or logo to protect',
    regulated_industry: overrides.regulated_industry ?? 'No, general services or products',
    business_path: overrides.business_path ?? 'Starting a new business',
    co_owner_count: overrides.co_owner_count ?? 'Just me',
  };
  if (overrides.advisory_timing) slots.advisory_timing = overrides.advisory_timing;

  const slot_meta: EngineState['slot_meta'] = {};
  for (const id of Object.keys(slots)) {
    slot_meta[id] = { source: 'answered' };
  }

  return {
    input: '',
    practice_area: 'corporate',
    matter_type: 'business_setup_advisory',
    intent_family: 'setup_advisory',
    dispute_family: 'general_business',
    advisory_subtrack: overrides.advisory_subtrack ?? 'solo_setup',
    slots,
    slot_meta,
    slot_evidence: {},
    raw: {
      mentions_urgency: false,
      mentions_money: false,
      mentions_access: false,
      mentions_ownership: false,
      mentions_documents: false,
      mentions_payment: false,
      mentions_agreement: false,
      mentions_vendor: false,
      mentions_fraud: false,
      mentions_property: false,
      mentions_closing: false,
      mentions_lease: false,
      mentions_construction: false,
      mentions_mortgage: false,
      mentions_preconstruction: false,
      input_length: 60,
    },
    confidence: 0,
    coreCompleteness: 0.7,
    answeredQuestionGroups: [],
    questionHistory: [],
    insightShown: false,
    contactCaptureStarted: true,
    lead_id: 'L-2026-06-07-ADVISORY-TEST',
    submitted_at: '2026-06-07T18:00:00.000Z',
    language: 'en',
  };
}

// ─── Test 1: the field-detected case lands in Band B ─────────────────────

describe('business_setup_advisory · solo file with no crisis lands in Band B', () => {
  it('reproduces the field-detected intake and lands as Band B', () => {
    // Exact match to the live brief Adriano flagged: solo_setup, sole
    // operator $30-100k, already operating, "Just me" decision authority,
    // "you are the first", "Within next 30 days", IP planned, no
    // employees, no cross-border, no signed exposure, no advisory_timing.
    const state = makeAdvisoryState();
    const result = computeBand(state);
    const scores = scoreFourAxes(state);

    // Value: 2 (sole operator $30-100k floor after calibration; was 4).
    expect(scores.value, 'value should be 2/10 after calibration (was 4)').toBe(2);
    // Urgency: 1 (already-operating sole consultant; was 4).
    expect(scores.urgency, 'urgency should be 1/10 for solo-no-exposure path (was 4)').toBe(1);
    // Readiness: 9 (4 + 3 + 2). Unchanged.
    expect(scores.readiness, 'readiness should remain 9/10').toBe(9);
    // Complexity: small. The brief showed 0.
    expect(scores.complexity).toBeLessThanOrEqual(2);
    // Band: B with the demotion reasoning string surfaced.
    expect(result.band).toBe('B');
  });
});

// ─── Test 2: signed exposure preserves Band A ────────────────────────────

describe('business_setup_advisory · signed exposure preserves the Band A path', () => {
  it('solo file with signed_anything=Yes still lands in Band A', () => {
    // Same shape, but the lead has already signed something. That's a
    // real "review window may be tight" file even on a small fee, and
    // the suppression must respect that.
    const state = makeAdvisoryState({
      signed_anything: 'Yes',
    });
    const result = computeBand(state);
    const scores = scoreFourAxes(state);

    // Urgency lifts: +3 for signed plus +4 for "Already operating" with
    // material exposure (signed counts as material) = 7. The +7 urgency
    // also flips the crisis-override gate, so the band would be A even
    // without the suppression carve-out. Important: this proves both
    // the crisis-override and the suppression carve-out independently
    // route to Band A on this path.
    expect(scores.urgency, 'signed + already operating with exposure lifts urgency').toBeGreaterThanOrEqual(7);
    expect(result.band, 'signed exposure must keep the file in Band A').toBe('A');
  });

  it('solo file with advisory_timing=Urgent stays in Band A', () => {
    const state = makeAdvisoryState({
      advisory_timing: 'Urgent',
    });
    const result = computeBand(state);
    // Crisis path: urgent timing alone is enough to keep Band A.
    expect(result.band).toBe('A');
  });

  it('solo file with advisory_timing=This week stays in Band A', () => {
    const state = makeAdvisoryState({
      advisory_timing: 'This week',
    });
    const result = computeBand(state);
    expect(result.band).toBe('A');
  });
});

// ─── Test 3: partner / buy-in subtracks preserve Band A eligibility ─────

describe('business_setup_advisory · high-scope subtracks preserve Band A', () => {
  it('partner_setup with $100-500k revenue lands in Band A', () => {
    // Partner setup is multi-party, shareholders agreement scope, real
    // legal weight. Plus it triggers the value lift (+2) and complexity
    // lift (+2). Must not be demoted by the small-ticket suppression.
    const state = makeAdvisoryState({
      advisory_subtrack: 'partner_setup',
      revenue_expectation: '$100,000–$500,000 (small team or busy practice)',
      decision_authority: 'Multiple owners or directors',
    });
    const result = computeBand(state);
    const scores = scoreFourAxes(state);

    // Value: 4 (recalibrated $100-500k tier from 5 to 4) + 2 (partner_setup) = 6.
    expect(scores.value, 'value should be 6/10 ($100-500k base + partner lift)').toBe(6);
    // Band: A. The high-scope subtrack carve-out must hold even with
    // the lower readiness from multi-party decision.
    expect(result.band, 'partner_setup at $100-500k must stay eligible for Band A').toBe('A');
  });

  it('buy_in_or_joining at high revenue lands in Band A', () => {
    // Buy-in to an existing entity carries due-diligence scope.
    const state = makeAdvisoryState({
      advisory_subtrack: 'buy_in_or_joining',
      revenue_expectation: 'Over $500,000 (early-stage business with momentum)',
      business_stage: 'Already operating',
      decision_authority: 'Me with a partner or family member',
    });
    const result = computeBand(state);
    expect(result.band).toBe('A');
  });
});

// ─── Test 4: value-tier deltas (pin the recalibration) ──────────────────

describe('business_setup_advisory · value-tier deltas are stable', () => {
  it('Over $500k revenue still scores 7/10 value (unchanged)', () => {
    const state = makeAdvisoryState({
      revenue_expectation: 'Over $500,000 (early-stage business with momentum)',
    });
    const scores = scoreFourAxes(state);
    expect(scores.value).toBe(7);
  });

  it('$100-500k revenue scores 4/10 value (was 5; calibration delta)', () => {
    const state = makeAdvisoryState({
      revenue_expectation: '$100,000–$500,000 (small team or busy practice)',
    });
    const scores = scoreFourAxes(state);
    expect(scores.value).toBe(4);
  });

  it('$30-100k revenue scores 2/10 value (was 4; calibration delta)', () => {
    const state = makeAdvisoryState({
      revenue_expectation: '$30,000–$100,000 (full-time, sole operator)',
    });
    const scores = scoreFourAxes(state);
    expect(scores.value).toBe(2);
  });

  it('Under $30k revenue stays at 2/10 value (unchanged)', () => {
    const state = makeAdvisoryState({
      revenue_expectation: 'Under $30,000 (small or part-time)',
    });
    const scores = scoreFourAxes(state);
    expect(scores.value).toBe(2);
  });
});

// ─── Test 5: Already-operating urgency split ────────────────────────────

describe('business_setup_advisory · already-operating urgency scales with exposure', () => {
  it('already operating + sole operator + no employees + no signed lifts +1', () => {
    const state = makeAdvisoryState({
      business_stage: 'Already operating',
      revenue_expectation: '$30,000–$100,000 (full-time, sole operator)',
      employees_planned: 'No, just me',
      signed_anything: 'No',
    });
    const scores = scoreFourAxes(state);
    // Sole consultant, no team, no signed paper: +1 urgency only.
    expect(scores.urgency).toBe(1);
  });

  it('already operating + employees planned lifts +4', () => {
    const state = makeAdvisoryState({
      business_stage: 'Already operating',
      revenue_expectation: '$30,000–$100,000 (full-time, sole operator)',
      employees_planned: 'Yes, one or two employees',
      signed_anything: 'No',
    });
    const scores = scoreFourAxes(state);
    // Employees count as material exposure: +4 urgency.
    expect(scores.urgency).toBe(4);
  });

  it('already operating + high revenue lifts +4', () => {
    const state = makeAdvisoryState({
      business_stage: 'Already operating',
      revenue_expectation: '$100,000–$500,000 (small team or busy practice)',
      employees_planned: 'No, just me',
      signed_anything: 'No',
    });
    const scores = scoreFourAxes(state);
    expect(scores.urgency).toBe(4);
  });

  it('already operating + signed exposure lifts urgency by +3 (signed) + +4 (op stage with material exposure)', () => {
    const state = makeAdvisoryState({
      business_stage: 'Already operating',
      revenue_expectation: '$30,000–$100,000 (full-time, sole operator)',
      employees_planned: 'No, just me',
      signed_anything: 'Yes',
    });
    const scores = scoreFourAxes(state);
    // +3 for signed + +4 for already-operating (signed makes it material) = 7.
    expect(scores.urgency).toBe(7);
  });
});
