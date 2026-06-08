/**
 * Advisory subtrack classification + persistence: regression guard.
 *
 * Background. The 2026-06-07 business_setup_advisory band calibration
 * deploy relies on `state.advisory_subtrack` to differentiate solo files
 * (Band B unless crisis) from partner / buy-in files (real legal scope,
 * Band A eligible). Investigation of historical rows surfaced two
 * structural gaps:
 *
 *   1. Persistence gap. `LawyerReport` did not include
 *      `advisory_subtrack`, so the field was dropped during brief
 *      serialization. Every business_setup_advisory row in production
 *      shows `advisory_subtrack = null` on retrospective query,
 *      regardless of what the engine actually classified.
 *
 *   2. Trigger gap. `control.ts` only re-derived subtrack when
 *      `advisory_path` or `co_owner_count` was the answered slot. A file
 *      that captured `decision_authority` but not co_owner_count
 *      (possible on shorter channel flows or LLM-driven extraction)
 *      kept its subtrack as the kickoff default and never reflected the
 *      partner signal.
 *
 * Three fixes ship together:
 *
 *   - `LawyerReport.advisory_subtrack` is now a required field.
 *     `buildReport()` writes `state.advisory_subtrack` into it. This
 *     makes the subtrack observable in `brief_json` going forward.
 *
 *   - `deriveAdvisorySubtrack` accepts a fourth argument
 *     `decisionAuthority`. When the direct signals (advisory_path,
 *     co_owner_count, input keywords) all return unknown, the
 *     classifier falls back to decision_authority:
 *       "Me with a partner or family member" or "Multiple owners or
 *         directors" become partner_setup
 *       "Just me" becomes solo_setup
 *
 *   - `control.ts` adds `decision_authority` to the trigger set, so
 *     the subtrack is re-derived as soon as that slot is answered.
 *
 *   - `band.ts` defense-in-depth: the small-ticket gate calls
 *     `updateAdvisorySubtrack(state)` whenever state.advisory_subtrack
 *     is missing or 'unknown'. Protects reconstruction paths (admin
 *     reclassify, future backfills) that rebuild state from
 *     slot_answers without re-running the engine's setter chain.
 *
 * This file pins all four behaviors.
 */

import { describe, it, expect } from 'vitest';
import { buildReport } from '../report';
import { computeBand } from '../band';
import { updateAdvisorySubtrack } from '../extractor';
import type { AdvisorySubtrack, EngineState } from '../types';

// ─── Fixture builder ─────────────────────────────────────────────────────

interface AdvisoryFixtureOverrides {
  advisory_path?: string;
  co_owner_count?: string;
  decision_authority?: string;
  revenue_expectation?: string;
  business_stage?: string;
  signed_anything?: string;
  hiring_timeline?: string;
  other_counsel?: string;
  employees_planned?: string;
  ip_planned?: string;
  cross_border_work?: string;
  regulated_industry?: string;
  advisory_timing?: string;
  business_path?: string;
  input?: string;
  // Optional: pre-set advisory_subtrack on the state to test cases where
  // the field is dropped or stale and the band gate must self-heal.
  advisory_subtrack?: AdvisorySubtrack;
}

function makeAdvisoryState(overrides: AdvisoryFixtureOverrides = {}): EngineState {
  const slots: Record<string, string> = {
    client_name: 'Test Caller',
    client_phone: '+14165550100',
    client_email: 'test@example.com',
    hiring_timeline: overrides.hiring_timeline ?? 'Within the next 30 days',
    other_counsel: overrides.other_counsel ?? 'No, you are the first',
    revenue_expectation: overrides.revenue_expectation ?? '$30,000–$100,000 (full-time, sole operator)',
    business_stage: overrides.business_stage ?? 'Already operating',
    signed_anything: overrides.signed_anything ?? 'No',
    employees_planned: overrides.employees_planned ?? 'No, just me',
    cross_border_work: overrides.cross_border_work ?? 'No, Canada only',
    ip_planned: overrides.ip_planned ?? 'No, services only',
    regulated_industry: overrides.regulated_industry ?? 'No, general services or products',
    business_path: overrides.business_path ?? 'Starting a new business',
  };
  if (overrides.advisory_path !== undefined) slots.advisory_path = overrides.advisory_path;
  if (overrides.co_owner_count !== undefined) slots.co_owner_count = overrides.co_owner_count;
  if (overrides.decision_authority !== undefined) slots.decision_authority = overrides.decision_authority;
  if (overrides.advisory_timing !== undefined) slots.advisory_timing = overrides.advisory_timing;

  const slot_meta: EngineState['slot_meta'] = {};
  for (const id of Object.keys(slots)) {
    slot_meta[id] = { source: 'answered' };
  }

  return {
    input: overrides.input ?? '',
    practice_area: 'corporate',
    matter_type: 'business_setup_advisory',
    intent_family: 'setup_advisory',
    dispute_family: 'general_business',
    advisory_subtrack: overrides.advisory_subtrack ?? 'unknown',
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
    lead_id: 'L-2026-06-07-SUBTRACK-TEST',
    submitted_at: '2026-06-07T18:00:00.000Z',
    language: 'en',
  };
}

// ─── Test 1: Classifier (the four canonical paths) ──────────────────────

describe('deriveAdvisorySubtrack · classifier returns the correct subtrack per signal source', () => {
  it('co_owner_count="Just me" routes to solo_setup', () => {
    const state = makeAdvisoryState({ co_owner_count: 'Just me' });
    expect(updateAdvisorySubtrack(state)).toBe('solo_setup');
  });

  it('co_owner_count="One partner" routes to partner_setup', () => {
    const state = makeAdvisoryState({ co_owner_count: 'One partner' });
    expect(updateAdvisorySubtrack(state)).toBe('partner_setup');
  });

  it('co_owner_count="Multiple partners" routes to partner_setup', () => {
    const state = makeAdvisoryState({ co_owner_count: 'Multiple partners' });
    expect(updateAdvisorySubtrack(state)).toBe('partner_setup');
  });

  it('advisory_path="Buying into an existing business" routes to buy_in_or_joining', () => {
    const state = makeAdvisoryState({ advisory_path: 'Buying into an existing business' });
    expect(updateAdvisorySubtrack(state)).toBe('buy_in_or_joining');
  });

  it('input mentions "joining an existing company" routes to buy_in_or_joining', () => {
    const state = makeAdvisoryState({
      input: 'I am joining an existing company as the third partner. Need someone to review documents.',
    });
    expect(updateAdvisorySubtrack(state)).toBe('buy_in_or_joining');
  });

  it('sparse state with no signals stays unknown', () => {
    // Only contact slots and stage-of-business defaults; no advisory_path,
    // no co_owner_count, no decision_authority, no qualifying input.
    const state = makeAdvisoryState();
    expect(updateAdvisorySubtrack(state)).toBe('unknown');
  });

  it('co_owner_count="Not sure yet" stays unknown rather than guessing', () => {
    const state = makeAdvisoryState({ co_owner_count: 'Not sure yet' });
    expect(updateAdvisorySubtrack(state)).toBe('unknown');
  });
});

// ─── Test 2: decision_authority as tertiary signal ──────────────────────

describe('deriveAdvisorySubtrack · decision_authority is a tertiary fallback signal', () => {
  it('decision_authority="Me with a partner or family member" routes to partner_setup (when no direct signal)', () => {
    // This is the SFJ-shape: no co_owner_count answered, no advisory_path
    // beyond "Starting a new business", but decision_authority strongly
    // implies a multi-party setup. Without the fallback, this state
    // would classify as unknown and get treated like solo by the band gate.
    const state = makeAdvisoryState({
      decision_authority: 'Me with a partner or family member',
    });
    expect(updateAdvisorySubtrack(state)).toBe('partner_setup');
  });

  it('decision_authority="Multiple owners or directors" routes to partner_setup', () => {
    const state = makeAdvisoryState({
      decision_authority: 'Multiple owners or directors',
    });
    expect(updateAdvisorySubtrack(state)).toBe('partner_setup');
  });

  it('decision_authority="Just me" routes to solo_setup (when no direct signal)', () => {
    const state = makeAdvisoryState({
      decision_authority: 'Just me',
    });
    expect(updateAdvisorySubtrack(state)).toBe('solo_setup');
  });

  it('direct co_owner_count signal wins over decision_authority', () => {
    // If co_owner_count is "One partner" but decision_authority is
    // "Just me" (contradictory), the more specific co_owner_count signal
    // should win because it is a direct subtrack-resolving slot.
    const state = makeAdvisoryState({
      co_owner_count: 'One partner',
      decision_authority: 'Just me',
    });
    expect(updateAdvisorySubtrack(state)).toBe('partner_setup');
  });

  it('decision_authority="Someone else decides" does not imply any subtrack', () => {
    const state = makeAdvisoryState({
      decision_authority: 'Someone else decides',
    });
    expect(updateAdvisorySubtrack(state)).toBe('unknown');
  });

  it('decision_authority="Not sure" does not imply any subtrack', () => {
    const state = makeAdvisoryState({
      decision_authority: 'Not sure',
    });
    expect(updateAdvisorySubtrack(state)).toBe('unknown');
  });
});

// ─── Test 3: Persistence (LawyerReport carries advisory_subtrack) ───────

describe('buildReport · advisory_subtrack flows from state into LawyerReport', () => {
  it('persists state.advisory_subtrack="solo_setup" into the brief', () => {
    const state = makeAdvisoryState({
      co_owner_count: 'Just me',
      advisory_subtrack: 'solo_setup',
    });
    const report = buildReport(state);
    expect(report.advisory_subtrack).toBe('solo_setup');
  });

  it('persists state.advisory_subtrack="partner_setup" into the brief', () => {
    const state = makeAdvisoryState({
      co_owner_count: 'One partner',
      advisory_subtrack: 'partner_setup',
    });
    const report = buildReport(state);
    expect(report.advisory_subtrack).toBe('partner_setup');
  });

  it('persists state.advisory_subtrack="buy_in_or_joining" into the brief', () => {
    const state = makeAdvisoryState({
      advisory_path: 'Buying into an existing business',
      advisory_subtrack: 'buy_in_or_joining',
    });
    const report = buildReport(state);
    expect(report.advisory_subtrack).toBe('buy_in_or_joining');
  });

  it('persists "unknown" when the engine could not classify', () => {
    const state = makeAdvisoryState({ advisory_subtrack: 'unknown' });
    const report = buildReport(state);
    expect(report.advisory_subtrack).toBe('unknown');
  });
});

// ─── Test 4: band.ts defense-in-depth ────────────────────────────────────

describe('computeBand · business_setup_advisory gate re-derives subtrack when stale', () => {
  it('reconstructed state with subtrack=unknown but partner slots present routes through high-scope path', () => {
    // Simulates an admin reclassify or backfill that rebuilt state from
    // slot_answers but did not re-run the assignWithReDerive setter
    // chain. The advisory_subtrack field arrives as 'unknown', but
    // co_owner_count="One partner" plus material exposure means this
    // should be eligible for Band A. Without defense-in-depth, the
    // suppression would demote to B.
    const state = makeAdvisoryState({
      co_owner_count: 'One partner',
      revenue_expectation: '$100,000–$500,000 (small team or busy practice)',
      decision_authority: 'Me with a partner or family member',
      advisory_subtrack: 'unknown', // simulate the reconstruction gap
    });
    const result = computeBand(state);
    expect(result.band).toBe('A');
  });

  it('reconstructed state with subtrack=unknown but only solo slots stays in the small-ticket lane', () => {
    // The defense-in-depth must not over-promote: a state that
    // re-derives to solo_setup should still get the suppression when
    // no crisis signal is present.
    const state = makeAdvisoryState({
      co_owner_count: 'Just me',
      revenue_expectation: '$30,000–$100,000 (full-time, sole operator)',
      decision_authority: 'Just me',
      advisory_subtrack: 'unknown', // simulate the reconstruction gap
    });
    const result = computeBand(state);
    expect(result.band).toBe('B');
  });

  it('the SFJ-shaped case reconstructs to Band A after the fix (was: would have demoted to B)', () => {
    // L-2026-06-06-SFJ in production: $100-500k revenue, "Maybe one or
    // two contractors", "Me with a partner or family member" decision,
    // co_owner_count="One partner", signed=No, no advisory_timing.
    // Pre-fix: advisory_subtrack persisted as null, recompute treats
    // it as solo, suppression demotes A to B incorrectly.
    // Post-fix: defense-in-depth re-derivation reads co_owner_count
    // and lifts to partner_setup, suppression bypasses, A stays A.
    const state = makeAdvisoryState({
      co_owner_count: 'One partner',
      employees_planned: 'Maybe one or two contractors',
      decision_authority: 'Me with a partner or family member',
      revenue_expectation: '$100,000–$500,000 (small team or busy practice)',
      signed_anything: 'No',
      advisory_subtrack: 'unknown', // the persisted-as-null case
    });
    const result = computeBand(state);
    expect(result.band).toBe('A');
  });
});
