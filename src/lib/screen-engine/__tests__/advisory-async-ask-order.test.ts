/**
 * Advisory async ask-order regression (DR-121).
 *
 * Field case 2026-08-07 (DRG Law Test, solo_setup): a WhatsApp session
 * answered 11 questions and the brief reported LOW confidence with 34%
 * completeness. Root cause: before DR-121, business_setup_advisory had
 * no entry in MATTER_SPECIFIC_SLOT_ORDER, so selectNextSlot followed the
 * literal getMatterGap chain, which places 4 of the 6 core-tier scoring
 * drivers (regulated_industry, revenue_expectation, cross_border_work,
 * employees_planned) at walk positions 10 through 14, past any realistic
 * async question budget.
 *
 * This file pins the walk order and the resulting completeness / axis
 * numbers BEFORE and AFTER the DR-121 reorder, using a fixture that
 * mirrors the field case: a solo consultant, no crisis signal, ordinary
 * readiness. The "before" block documents behavior this repo no longer
 * has (kept as a comment, not a live assertion, once DR-121 ships) so a
 * future reader can see exactly what changed and why.
 *
 * Numbers are hand-derived from selector.ts / band.ts and cross-checked
 * against a live vitest run at authoring time (see DR-121 for the full
 * arithmetic). Any future change to MATTER_SPECIFIC_SLOT_ORDER,
 * getMatterGap, or the four-axis scorer for this matter type should make
 * this test fail loud rather than silently drifting the operator-facing
 * completeness number.
 */
import { describe, it, expect } from 'vitest';
import { applyAnswer } from '../control';
import { selectNextSlot, computeCoreCompleteness } from '../selector';
import { scoreFourAxes } from '../band';
import type { EngineState, AdvisorySubtrack } from '../types';

function baseState(advisory_subtrack: AdvisorySubtrack): EngineState {
  return {
    input: '',
    practice_area: 'corporate',
    matter_type: 'business_setup_advisory',
    intent_family: 'setup_advisory',
    dispute_family: 'general_business',
    advisory_subtrack,
    slots: {},
    slot_meta: {},
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
      input_length: 0,
    },
    confidence: 0,
    coreCompleteness: 0,
    answeredQuestionGroups: [],
    questionHistory: [],
    insightShown: false,
    contactCaptureStarted: false,
    lead_id: 'test-lead',
    submitted_at: new Date(0).toISOString(),
    channel: 'whatsapp',
    language: 'en',
  };
}

// Realistic mid-signal values matching the 2026-08-07 field case: a solo
// operator formalising a small services business. No crisis signal
// (nothing signed, no urgent timing), ordinary readiness.
const REALISTIC_ANSWERS: Record<string, string> = {
  advisory_path: 'Starting a new business',
  co_owner_count: 'Just me',
  advisory_concern: 'Knowing what kind of company to set up',
  signed_anything: 'No',
  documents_exist: 'No',
  business_stage: 'Already operating',
  advisory_timing: 'No rush',
  hiring_timeline: 'Within the next 30 days',
  other_counsel: 'No, you are the first',
  decision_authority: 'Just me',
  revenue_expectation: '$30,000–$100,000 (full-time, sole operator)',
  regulated_industry: 'No, general services or products',
  employees_planned: 'No, just me',
  cross_border_work: 'No, Canada only',
  ip_planned: 'No, services only',
  business_activity_type: 'Professional services',
  setup_needs: 'Incorporating the company',
  ownership_split_discussed: 'Yes',
  business_location: 'Toronto',
  advisory_actionability: 'Ready to move forward',
  advisory_specific_task: 'Choosing the right structure',
};

function walkNTurns(state: EngineState, n: number): { state: EngineState; order: string[] } {
  const order: string[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    const next = selectNextSlot(s);
    if (!next) break;
    order.push(next.id);
    const value = REALISTIC_ANSWERS[next.id];
    if (!value) throw new Error(`No fixture answer defined for slot "${next.id}"`);
    s = applyAnswer(s, next.id, value);
  }
  return { state: s, order };
}

describe('business_setup_advisory ask order (DR-121, solo_setup)', () => {
  it('walks the DR-121 order for the first 9 questions', () => {
    const { order } = walkNTurns(baseState('solo_setup'), 9);
    expect(order).toEqual([
      'advisory_path',
      'co_owner_count',
      'signed_anything', // urgency + complexity input, asked early
      'business_stage', // urgency input, asked early
      'hiring_timeline', // readiness triple (DR-083 precedent, kept early)
      'other_counsel',
      'decision_authority',
      'revenue_expectation', // core-tier value driver, now inside the first 9
      'regulated_industry', // core-tier complexity driver, now inside the first 9
    ]);
  });

  it('reaches materially higher core completeness at question 9 than the pre-DR-121 order did', () => {
    const { state } = walkNTurns(baseState('solo_setup'), 9);
    // Pre-DR-121 order reached 45% at question 9 (5 of 11 core slots:
    // advisory_path, co_owner_count, hiring_timeline, other_counsel,
    // decision_authority). DR-121's order reaches 7 of 11: the same five
    // plus revenue_expectation and regulated_industry.
    expect(computeCoreCompleteness(state)).toBe(64);
  });

  it('does not regress the readiness or urgency axes DR-083 already protected', () => {
    const { state } = walkNTurns(baseState('solo_setup'), 9);
    const axes = scoreFourAxes(state);
    expect(axes.readinessAnswered).toBe(true);
    // signed_anything=No (+0), business_stage='Already operating' with no
    // material exposure yet (employees_planned unanswered at question 9,
    // revenue tier is not on the material-exposure list) => +1.
    expect(axes.urgency).toBe(1);
  });

  it('completes every core-tier slot solo_setup can ever reach by question 13 (the documented ceiling)', () => {
    const { state } = walkNTurns(baseState('solo_setup'), 13);
    // solo_setup can never answer advisory_concern (excluded by its own
    // applies_to_subtrack), so the ceiling is 10 of 11 core slots, not
    // 11 of 11. This is a pre-existing, subtrack-blind property of
    // computeCoreCompleteness's denominator, not something DR-121
    // changes. Logged as a followup in the executing build plan.
    expect(computeCoreCompleteness(state)).toBe(91);
  });
});

describe('business_setup_advisory ask order (DR-121, partner_setup and buy_in_or_joining)', () => {
  it('partner_setup follows the same routing/urgency/readiness spine as solo_setup', () => {
    const { order } = walkNTurns(baseState('partner_setup'), 6);
    // advisory_concern is core-tier but feeds no axis in band.ts (it only
    // shapes buildLikelyServices/buildFeeEstimate narrative text), so it
    // sits after the true scoring drivers, not before. It lands around
    // position 13 for partner_setup (after revenue/regulated/employees/
    // cross_border/ip), well past this 6-question window.
    expect(order).toEqual([
      'advisory_path',
      'co_owner_count',
      'signed_anything',
      'business_stage',
      'hiring_timeline',
      'other_counsel',
    ]);
  });

  it('buy_in_or_joining now asks signed_anything (deliberate behavior change; DR-121)', () => {
    const { order } = walkNTurns(baseState('buy_in_or_joining'), 4);
    // Before DR-121, buy_in_or_joining's own getMatterGap chain asked
    // agreement_proof via documents_exist and never touched
    // signed_anything (which has no applies_to_subtrack restriction, so
    // it is a valid candidate for every subtrack, including buy_in).
    // DR-121's explicit order asks signed_anything for every subtrack;
    // documents_exist (buy_in's own proof slot) still follows shortly
    // after. This is an accepted, deliberate change per the build plan.
    expect(order).toContain('signed_anything');
    expect(order[0]).toBe('advisory_path');
  });
});
