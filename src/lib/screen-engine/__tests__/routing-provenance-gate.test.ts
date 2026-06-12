/**
 * DR-069 routing provenance gate: "Inference informs; only the lead routes."
 *
 * Field defect (2026-06-11, Damaris widget test): the lead wrote "I need
 * to lease a space for my business". The deterministic classifier fell to
 * real_estate_general; the LLM force-fit the routing slot
 * real_estate_problem_type to "Buying or selling commercial property"
 * (the taxonomy had no leasing bucket); the processor rerouted the matter
 * on that llm_inferred value; and because the routing slot applies_to
 * only the *_general lane, the routing question became unaskable. The
 * brief asserted a sale that did not exist.
 *
 * The global fix this file pins:
 *  1. rerouteFrom*General fires ONLY on user-grounded routing answers
 *     (source answered / explicit / legacy inferred) and no-ops on
 *     llm_inferred fills, missing meta, and stale (already-routed) states.
 *  2. Reroutes stamp matter_type_provenance 'user_routing_answer'.
 *  3. mergeLlmResults promotes *_general catch-alls only with
 *     allowGeneralPromotion (single-pass flows); the 'unknown' lane
 *     always promotes (DR-039); promotions stamp 'llm_inferred'.
 *     (Pinned in routing-classifier-promotion.test.ts.)
 *  4. The LLM merge never clobbers a user-grounded slot value.
 *  5. Employment and estates gained deterministic reroutes (parity).
 *  6. The brief renders inference-routed classifications honestly.
 *  7. The band escape demotion requires the LEAD's "Something else".
 */

import { describe, it, expect } from 'vitest';
import {
  initialiseState,
  rerouteFromCorporateGeneral,
  rerouteFromRealEstateGeneral,
  rerouteFromEmploymentGeneral,
  rerouteFromEstatesGeneral,
} from '../extractor';
import { applyAnswer } from '../control';
import { mergeLlmResults } from '../llm/extractor';
import { MATTER_TYPE_CLASSIFIER_FIELD } from '../llm/schema';
import { buildReport } from '../report';
import { computeBand } from '../band';
import { selectNextSlot } from '../selector';
import type { EngineState, SlotMetaSource } from '../types';

function stateWithRoutingFill(
  base: EngineState,
  slotId: string,
  value: string,
  source: SlotMetaSource,
): EngineState {
  return {
    ...base,
    slots: { ...base.slots, [slotId]: value },
    slot_meta: {
      ...base.slot_meta,
      [slotId]: { source, confidence: 0.7 },
    },
  };
}

function realEstateGeneralState(): EngineState {
  const s = initialiseState('I need help with a real estate matter');
  if (s.matter_type !== 'real_estate_general') {
    throw new Error(
      `Test premise violation: expected real_estate_general but got ${s.matter_type}`,
    );
  }
  return s;
}

function corporateGeneralState(): EngineState {
  const s = initialiseState('my business partner and I are in a dispute about a buyout offer');
  if (s.matter_type !== 'corporate_general') {
    throw new Error(
      `Test premise violation: expected corporate_general but got ${s.matter_type}`,
    );
  }
  return s;
}

function generalLaneState(matter: 'employment_general' | 'estates_general'): EngineState {
  return { ...initialiseState('I need help with a legal situation'), matter_type: matter };
}

// ── 1. The reroute provenance gate ───────────────────────────────────────

describe('rerouteFrom*General: provenance gate (DR-069)', () => {
  it('does NOT reroute on an llm_inferred routing fill (the field defect)', () => {
    const base = realEstateGeneralState();
    const filled = stateWithRoutingFill(
      base, 'real_estate_problem_type', 'Buying or selling commercial property', 'llm_inferred',
    );
    const after = rerouteFromRealEstateGeneral(filled, 'Buying or selling commercial property');
    expect(after.matter_type).toBe('real_estate_general');
    expect(after.matter_type_provenance).toBe('deterministic');
  });

  it('does NOT reroute when the routing slot has no meta at all', () => {
    const base = corporateGeneralState();
    const after = rerouteFromCorporateGeneral(base, 'Someone owes my company money');
    expect(after.matter_type).toBe('corporate_general');
  });

  it('reroutes on an answered routing fill and stamps user_routing_answer', () => {
    const base = realEstateGeneralState();
    const filled = stateWithRoutingFill(
      base, 'real_estate_problem_type', 'A landlord or tenant dispute', 'answered',
    );
    const after = rerouteFromRealEstateGeneral(filled, 'A landlord or tenant dispute');
    expect(after.matter_type).toBe('landlord_tenant');
    expect(after.matter_type_provenance).toBe('user_routing_answer');
    expect(after.intent_family).toBe('real_estate_dispute');
  });

  it('no-ops when the matter has already left the catch-all (stale answer guard)', () => {
    const base = realEstateGeneralState();
    const routed = rerouteFromRealEstateGeneral(
      stateWithRoutingFill(base, 'real_estate_problem_type', 'A landlord or tenant dispute', 'answered'),
      'A landlord or tenant dispute',
    );
    expect(routed.matter_type).toBe('landlord_tenant');
    const late = rerouteFromRealEstateGeneral(routed, 'Buying or selling a home or condo');
    expect(late.matter_type).toBe('landlord_tenant');
  });

  it('applyAnswer end-to-end: a chip answer routes (the legitimate path)', () => {
    const base = corporateGeneralState();
    const after = applyAnswer(base, 'corporate_problem_type', 'Someone owes my company money');
    expect(after.matter_type).toBe('unpaid_invoice');
    expect(after.matter_type_provenance).toBe('user_routing_answer');
  });
});

// ── 2. New taxonomy buckets route correctly ──────────────────────────────

describe('DR-070 taxonomy buckets: routing destinations', () => {
  it('leasing commercial space routes to commercial_real_estate', () => {
    const base = realEstateGeneralState();
    const after = applyAnswer(
      base, 'real_estate_problem_type', 'Leasing commercial space (new lease, renewal, or review)',
    );
    expect(after.matter_type).toBe('commercial_real_estate');
    expect(after.intent_family).toBe('real_estate_transaction');
    expect(after.matter_type_provenance).toBe('user_routing_answer');
  });

  it('title transfer (no sale) stays real_estate_general (honest thin brief)', () => {
    const base = realEstateGeneralState();
    const after = applyAnswer(
      base, 'real_estate_problem_type', 'Adding or removing someone on title (no sale)',
    );
    expect(after.matter_type).toBe('real_estate_general');
    expect(after.slots['real_estate_problem_type']).toBe('Adding or removing someone on title (no sale)');
  });

  it('corporate transactional buckets route to business_setup_advisory', () => {
    const base = corporateGeneralState();
    const setup = applyAnswer(base, 'corporate_problem_type', 'Starting, buying, or restructuring a business');
    expect(setup.matter_type).toBe('business_setup_advisory');
    expect(setup.intent_family).toBe('setup_advisory');

    const review = applyAnswer(base, 'corporate_problem_type', 'A contract I need drafted or reviewed before signing');
    expect(review.matter_type).toBe('business_setup_advisory');
  });
});

// ── 3. Employment / estates reroute parity ───────────────────────────────

describe('rerouteFromEmploymentGeneral / rerouteFromEstatesGeneral (DR-069 parity)', () => {
  const employmentMap: Array<[string, string]> = [
    ['I was fired or let go', 'wrongful_dismissal'],
    ['My job changed so much I had to leave, or I felt forced out', 'wrongful_dismissal'],
    ['I work as a contractor and the company ended or changed my contract', 'wrongful_dismissal'],
    ['I have a severance offer to review', 'severance_review'],
    ['I am being harassed or discriminated against', 'harassment_complaint'],
    ['I am owed wages that have not been paid', 'wage_recovery'],
    ['I need an employment contract reviewed', 'employment_contract_review'],
  ];
  for (const [option, target] of employmentMap) {
    it(`employment chip "${option}" routes to ${target}`, () => {
      const base = generalLaneState('employment_general');
      const after = applyAnswer(base, 'employment_problem_type', option);
      expect(after.matter_type).toBe(target);
      expect(after.matter_type_provenance).toBe('user_routing_answer');
      expect(after.practice_area).toBe('employment');
    });
  }

  it('employer-side option stays employment_general (no employer pack yet)', () => {
    const base = generalLaneState('employment_general');
    const after = applyAnswer(base, 'employment_problem_type', 'I am an employer and need help with an employee matter');
    expect(after.matter_type).toBe('employment_general');
  });

  const estatesMap: Array<[string, string]> = [
    ['I need a will drafted or updated', 'will_drafting'],
    ['I want to set up a trust', 'will_drafting'],
    ['I need a power of attorney', 'power_of_attorney'],
    ['A family member can no longer manage their affairs and nothing is in place', 'power_of_attorney'],
    ['Someone has passed and I need help with probate', 'probate'],
    ['There is a dispute over a will or an estate', 'estate_dispute'],
    ['Someone is misusing a power of attorney', 'estate_dispute'],
  ];
  for (const [option, target] of estatesMap) {
    it(`estates chip "${option}" routes to ${target}`, () => {
      const base = generalLaneState('estates_general');
      const after = applyAnswer(base, 'estates_problem_type', option);
      expect(after.matter_type).toBe(target);
      expect(after.matter_type_provenance).toBe('user_routing_answer');
      expect(after.practice_area).toBe('estates');
    });
  }

  it('estates llm_inferred fill does not route (gate applies to the new functions too)', () => {
    const base = generalLaneState('estates_general');
    const filled = stateWithRoutingFill(
      base, 'estates_problem_type', 'I need a will drafted or updated', 'llm_inferred',
    );
    const after = rerouteFromEstatesGeneral(filled, 'I need a will drafted or updated');
    expect(after.matter_type).toBe('estates_general');
  });

  it('employment llm_inferred fill does not route', () => {
    const base = generalLaneState('employment_general');
    const filled = stateWithRoutingFill(
      base, 'employment_problem_type', 'I was fired or let go', 'llm_inferred',
    );
    const after = rerouteFromEmploymentGeneral(filled, 'I was fired or let go');
    expect(after.matter_type).toBe('employment_general');
  });
});

// ── 4. The Damaris repro, end to end at engine level ─────────────────────

describe('field-defect repro: lease inquiry can no longer be force-routed', () => {
  it('the original input now classifies deterministically to commercial_real_estate', () => {
    const s = initialiseState('I need to lease a space for my business');
    expect(s.matter_type).toBe('commercial_real_estate');
    expect(s.matter_type_provenance).toBe('deterministic');
  });

  it('an ambiguous RE lead with an llm_inferred routing fill keeps the routing question askable', () => {
    const base = realEstateGeneralState();
    // Interactive merge (no allowGeneralPromotion): the LLM fills the
    // routing slot and offers a classifier promotion; neither may route.
    const merged = mergeLlmResults(base, {
      real_estate_problem_type: 'Buying or selling commercial property',
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'commercial_real_estate',
    });
    expect(merged.matter_type).toBe('real_estate_general');
    expect(merged.slot_meta['real_estate_problem_type']?.source).toBe('llm_inferred');

    // The selector still asks the routing question.
    const next = selectNextSlot(merged);
    expect(next?.id).toBe('real_estate_problem_type');

    // The lead's own answer (the new leasing bucket) routes with full
    // authority and overwrites the LLM's force-fit value.
    const answered = applyAnswer(
      merged, 'real_estate_problem_type', 'Leasing commercial space (new lease, renewal, or review)',
    );
    expect(answered.matter_type).toBe('commercial_real_estate');
    expect(answered.matter_type_provenance).toBe('user_routing_answer');
    expect(answered.slots['real_estate_problem_type']).toBe('Leasing commercial space (new lease, renewal, or review)');
    expect(answered.slot_meta['real_estate_problem_type']?.source).toBe('answered');
  });
});

// ── 5. The merge never clobbers user-grounded values ─────────────────────

describe('mergeLlmResults: user-grounded values survive the merge (DR-069 widening)', () => {
  it('an answered slot value is not overwritten or downgraded by a later merge', () => {
    const base = initialiseState('I want to start a business with a friend');
    if (base.matter_type !== 'business_setup_advisory') {
      throw new Error(
        `Test premise violation: expected business_setup_advisory but got ${base.matter_type}`,
      );
    }
    const answered = applyAnswer(base, 'advisory_timing', 'This week');
    const merged = mergeLlmResults(answered, { advisory_timing: 'No rush' });
    expect(merged.slots['advisory_timing']).toBe('This week');
    expect(merged.slot_meta['advisory_timing']?.source).toBe('answered');
  });

  it('an llm_inferred value remains overwritable by a later merge', () => {
    const base = initialiseState('I want to start a business with a friend');
    const first = mergeLlmResults(base, { advisory_timing: 'No rush' });
    expect(first.slot_meta['advisory_timing']?.source).toBe('llm_inferred');
    const second = mergeLlmResults(first, { advisory_timing: 'This week' });
    expect(second.slots['advisory_timing']).toBe('This week');
  });
});

// ── 6. Brief honesty for inference-routed classifications ────────────────

describe('buildReport: inference-routed classification renders honestly (DR-069)', () => {
  function voicePromotedState(): EngineState {
    const base = { ...corporateGeneralState(), channel: 'voice' as const };
    return mergeLlmResults(base, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'shareholder_dispute',
    }, { allowGeneralPromotion: true });
  }

  it('persists matter_type_provenance on the LawyerReport', () => {
    const report = buildReport(voicePromotedState());
    expect(report.matter_type_provenance).toBe('llm_inferred');
  });

  it('user-routed and deterministic classifications persist their provenance too', () => {
    const routed = applyAnswer(
      corporateGeneralState(), 'corporate_problem_type', 'Someone owes my company money',
    );
    expect(buildReport(routed).matter_type_provenance).toBe('user_routing_answer');
    expect(buildReport(initialiseState('I was fired from my job last week')).matter_type_provenance).toBe('deterministic');
  });

  it('adds the AI-inferred risk flag on the rerouted matter type', () => {
    const report = buildReport(voicePromotedState());
    expect(report.risk_flags.join(' ')).toContain('AI-inferred');
  });

  it('adds the truth warning', () => {
    const report = buildReport(voicePromotedState());
    expect(report.truth_warnings.join(' ')).toContain('inferred by the engine');
  });

  it('leads the open questions with the confirm-classification item, including on voice', () => {
    const report = buildReport(voicePromotedState());
    expect(report.open_questions[0]).toContain('Confirm the matter classification');
  });

  it('band reasoning does not overclaim on an inferred routing', () => {
    const report = buildReport(voicePromotedState());
    expect(report.band_reasoning_bullets[0]).toContain('AI inference');
    expect(report.band_reasoning_bullets[0]).not.toContain("based on lead's own description");
  });

  it('resolved facts carry llm_inferred provenance instead of collapsing to unknown', () => {
    const base = initialiseState('I want to start a business with a friend');
    const merged = mergeLlmResults(base, { advisory_timing: 'This week' });
    const report = buildReport(merged);
    const fact = report.resolved_facts_v2.find((f) => f.label.toLowerCase().includes('timing'));
    expect(fact?.source).toBe('llm_inferred');
  });

  it('a clean deterministic report carries none of the honesty surfaces', () => {
    const report = buildReport(initialiseState('I was fired from my job last week'));
    expect(report.risk_flags.join(' ')).not.toContain('AI-inferred');
    expect(report.truth_warnings.join(' ')).not.toContain('inferred by the engine');
    expect(report.open_questions.join(' ')).not.toContain('Confirm the matter classification');
  });
});

// ── 7. Band escape demotion requires the lead's own answer ───────────────

describe('computeBand: escape demotion is provenance-gated (DR-070)', () => {
  it('llm_inferred "Something else" does NOT demote to Band C', () => {
    const base = corporateGeneralState();
    const filled = stateWithRoutingFill(base, 'corporate_problem_type', 'Something else', 'llm_inferred');
    const result = computeBand(filled);
    expect(result.band).toBe('B');
    expect(result.reasoning).toContain('Routing question pending');
  });

  it('a lead-answered "Something else" still demotes to Band C', () => {
    const base = corporateGeneralState();
    const filled = stateWithRoutingFill(base, 'corporate_problem_type', 'Something else', 'answered');
    const result = computeBand(filled);
    expect(result.band).toBe('C');
    expect(result.confidence).toBe(25);
  });
});
