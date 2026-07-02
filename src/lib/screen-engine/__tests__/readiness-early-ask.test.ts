/**
 * Readiness-starvation fix regression guard (qualification audit F2,
 * 2026-07-02; FOLLOWUPS 2026-06-09 "WhatsApp discovery never reaches the
 * readiness slot").
 *
 * L-2026-06-09-DF5: a business_setup_advisory solo_setup WhatsApp lead
 * answered 12 matter facts and never got asked hiring_timeline before the
 * session ended, because the solo_setup chain runs 10 matter-specific
 * slots before readiness gets a turn. Readiness drives the readiness axis
 * and therefore banding, so it was disproportionately the fact missing
 * when a lead went quiet mid-chain.
 *
 * Fix (scoped, not a getDecisionGap-wide change): solo_setup and
 * partner_setup, the two 10-slot business_setup_advisory chains, now
 * offer the readiness triple after their first 4 matter facts instead of
 * only at the end. Every other matter type, including the short
 * buy_in_or_joining chain and the Estates/Employment Phase B sentinel
 * types, is untouched. A broader getDecisionGap-level threshold was tried
 * first and reverted: it regressed three sandbox selector.test.ts
 * expectations for shareholder_dispute and buy_in_or_joining, which
 * confirmed those chains should run to completion before readiness, same
 * as before.
 */

import { describe, it, expect } from 'vitest';
import { getDecisionGap } from '../selector';
import { initialiseState } from '../extractor';
import type { EngineState } from '../types';

function answer(state: EngineState, slotId: string, value: string): EngineState {
  return {
    ...state,
    slots: { ...state.slots, [slotId]: value },
    slot_meta: { ...state.slot_meta, [slotId]: { source: 'answered', confidence: 1 } },
  };
}

function baseState(matterType: string): EngineState {
  const state = initialiseState('placeholder intake text for a fixture state');
  return { ...state, matter_type: matterType as EngineState['matter_type'] };
}

describe('readiness-starvation fix: business_setup_advisory long chains', () => {
  it('solo_setup: offers hiring_timeline after the first 4 matter facts, not only after all 10', () => {
    let state = baseState('business_setup_advisory');
    state = { ...state, advisory_subtrack: 'solo_setup' };
    state = answer(state, 'advisory_path', 'Starting a new business');
    state = answer(state, 'co_owner_count', 'Just me');
    state = answer(state, 'signed_anything', 'No formal agreement'); // resolves: agreement_proof
    state = answer(state, 'business_activity_type', 'Professional services');
    state = answer(state, 'business_stage', 'Not yet operating');
    state = answer(state, 'setup_needs', 'Incorporation');

    // The first 4 matter facts (post advisory_path/co_owner_count) are in;
    // readiness gets a turn before the remaining 6 matter facts.
    expect(getDecisionGap(state)).toBe('hiring_timeline');
  });

  it('solo_setup: still asks matter facts first before the first-4 prefix is done', () => {
    let state = baseState('business_setup_advisory');
    state = { ...state, advisory_subtrack: 'solo_setup' };
    state = answer(state, 'advisory_path', 'Starting a new business');
    state = answer(state, 'co_owner_count', 'Just me');

    expect(getDecisionGap(state)).toBe('agreement_proof');
  });

  it('solo_setup: readiness fully resolved, matter chain resumes past the insertion point', () => {
    let state = baseState('business_setup_advisory');
    state = { ...state, advisory_subtrack: 'solo_setup' };
    state = answer(state, 'advisory_path', 'Starting a new business');
    state = answer(state, 'co_owner_count', 'Just me');
    state = answer(state, 'signed_anything', 'No formal agreement');
    state = answer(state, 'business_activity_type', 'Professional services');
    state = answer(state, 'business_stage', 'Not yet operating');
    state = answer(state, 'setup_needs', 'Incorporation');
    state = answer(state, 'hiring_timeline', 'Now (this week)');
    state = answer(state, 'other_counsel', 'No, you are the first');
    state = answer(state, 'decision_authority', 'Just me');

    expect(getDecisionGap(state)).toBe('regulated_industry');
  });

  it('partner_setup: offers hiring_timeline after its first 4 matter facts', () => {
    let state = baseState('business_setup_advisory');
    state = { ...state, advisory_subtrack: 'partner_setup' };
    state = answer(state, 'advisory_path', 'Starting a business with a partner');
    state = answer(state, 'co_owner_count', 'One other person');
    state = answer(state, 'signed_anything', 'No formal agreement');
    state = answer(state, 'ownership_split_discussed', '50/50'); // resolves: ownership
    state = answer(state, 'advisory_concern', 'Structuring the partnership');
    state = answer(state, 'business_activity_type', 'Professional services');

    expect(getDecisionGap(state)).toBe('hiring_timeline');
  });

  it('buy_in_or_joining (short 3-slot chain): unaffected, runs to completion before readiness', () => {
    let state = baseState('business_setup_advisory');
    state = { ...state, advisory_subtrack: 'buy_in_or_joining' };
    state = answer(state, 'advisory_path', 'Joining an existing business');

    // co_owner_count is explicitly skipped for buy_in_or_joining.
    expect(getDecisionGap(state)).toBe('agreement_proof');

    state = answer(state, 'signed_anything', 'No formal agreement');
    expect(getDecisionGap(state)).toBe('advisory_timing');

    state = answer(state, 'advisory_timing', 'Within 30 days');
    expect(getDecisionGap(state)).toBe('business_location');

    state = answer(state, 'business_location', 'Ontario');
    // Full (short) chain resolved: readiness now, unaffected by the fix.
    expect(getDecisionGap(state)).toBe('hiring_timeline');
  });

  it('will_drafting (sentinel matter_qualification): never offers readiness ahead of the qualification chain (2026-06-07 regression)', () => {
    let state = baseState('will_drafting');
    state = answer(state, 'hiring_timeline', 'Now (this week)');
    state = answer(state, 'other_counsel', 'No, you are the first');
    state = answer(state, 'decision_authority', 'Just me');

    expect(getDecisionGap(state)).toBe('matter_qualification');
  });

  it('out_of_scope / unknown / notary_services: untouched by this fix', () => {
    expect(getDecisionGap(baseState('out_of_scope'))).toBe('none');
    expect(getDecisionGap(baseState('unknown'))).toBe('none');
    let notary = baseState('notary_services');
    notary = answer(notary, 'hiring_timeline', 'Now (this week)');
    expect(getDecisionGap(notary)).toBe('none');
  });
});
