/**
 * Scoring coverage contract — 2026-06-01.
 *
 * Field-detected pattern: each time a new matter pack was added to the
 * engine (Phase A general lanes, Phase B sub-types, future packs), the
 * extraction + classification + reporting layers got wired but the
 * scoring layer in band.ts was sometimes left at `return 0` for the
 * new matter type. This is invisible until a real lead from that
 * matter type lands in production. Operator surfaced the pattern
 * 2026-06-01 PSTN test #2 (will_drafting + 5 other Phase B types
 * silently scoring all-zero Band C for 11 days).
 *
 * The fix is a contract, not a patch: every in-scope matter type must
 * be representable in the slot system AND must avoid the collapsed
 * all-zero scoring state when a real lead reaches the scorer.
 *
 * Two contracts in this file, deliberately separate because they
 * measure different things:
 *
 *   1. SLOT COVERAGE — every in-scope MatterType has at least one
 *      non-contact slot in SLOT_REGISTRY with applies_to including it.
 *      Without applicable slots, the matter can never be deepened
 *      through extraction or follow-up, regardless of the scorer.
 *
 *   2. SCORING COVERAGE — every in-scope MatterType, given a minimally
 *      populated state (contact complete + at least one applicable
 *      matter slot filled with a reasonable value), must NOT return
 *      all-four-axes-zero. The exact broken signature surfaced
 *      2026-06-01: {value:0, urgency:0, readiness:0, complexity:0}
 *      with a generic "Weak signal. Standard follow-up cadence."
 *      reasoning is the failure mode. Value/readiness/complexity CAN
 *      be lifted by structural signal alone; urgency MAY remain 0 if
 *      no deadline/timeline signal is present.
 *
 * The contract MUST stay enforceable on every commit. Adding a new
 * MatterType to the union and forgetting to wire scoring should fail
 * THIS test, not a future production call.
 *
 * Doctrine: this is a capability-layer contract, not a matter-specific
 * patch. The dispatch pattern in band.ts uses `{ score, handled }` so
 * `score: 0` from a specific scorer does NOT automatically mean
 * "missing branch" — only `handled: false` does. The contract proves
 * the dispatch produces non-collapsed scoring per matter type.
 */

import { describe, it, expect } from 'vitest';
import { computeBand, scoreFourAxes } from '../screen-engine/band';
import {
  SLOT_REGISTRY,
  IN_SCOPE_MATTER_TYPES,
} from '../screen-engine/slotRegistry';
import type {
  EngineState,
  MatterType,
  SlotDefinition,
  DisputeFamily,
  IntentFamily,
} from '../screen-engine/types';

// ─── Helpers ────────────────────────────────────────────────────────────

function isContactSlot(slot: SlotDefinition): boolean {
  return slot.tier === 'contact';
}

function applicableMatterSlots(matter: MatterType): SlotDefinition[] {
  return SLOT_REGISTRY.filter(
    (s) => !isContactSlot(s) && (s.applies_to ?? []).includes(matter),
  );
}

/**
 * Pick a "reasonable" answer value for a slot.
 *   - single_select: take the first option (deterministic; this is the
 *     same shape the LLM extractor produces).
 *   - free_text: a short generic string.
 *   - Anything else: skip.
 */
function pickSlotValue(slot: SlotDefinition): string | null {
  if (slot.input_type === 'single_select' && slot.options && slot.options.length > 0) {
    return slot.options[0].value;
  }
  if (slot.input_type === 'free_text') {
    return 'A reasonable test value';
  }
  return null;
}

/**
 * Family / discriminator inference for a MatterType, used only to make
 * the test fixture state valid (intent_family, dispute_family, etc.
 * are required on EngineState even though the band scorer reads
 * matter_type primarily).
 *
 * This is intentionally coarse — it just has to produce a type-legal
 * EngineState, not match production extractor behaviour exactly.
 */
function familyDefaultsFor(matter: MatterType): {
  intent_family: IntentFamily;
  dispute_family: DisputeFamily;
} {
  // Real estate cluster
  const realEstateSet = new Set<string>([
    'commercial_real_estate', 'residential_purchase_sale',
    'real_estate_litigation', 'landlord_tenant', 'construction_lien',
    'preconstruction_condo', 'mortgage_dispute', 'real_estate_general',
  ]);
  if (realEstateSet.has(matter)) {
    return { intent_family: 'real_estate_transaction', dispute_family: 'real_estate_transaction' };
  }
  // Employment cluster
  const employmentSet = new Set<string>([
    'wrongful_dismissal', 'severance_review', 'harassment_complaint',
    'wage_recovery', 'employment_contract_review', 'employment_general',
  ]);
  if (employmentSet.has(matter)) {
    return { intent_family: 'employment', dispute_family: 'general_employment' };
  }
  // Estates cluster
  const estatesSet = new Set<string>([
    'will_drafting', 'power_of_attorney', 'probate',
    'estate_dispute', 'estates_general',
  ]);
  if (estatesSet.has(matter)) {
    return { intent_family: 'estates', dispute_family: 'general_estates' };
  }
  // Setup advisory
  if (matter === 'business_setup_advisory') {
    return { intent_family: 'setup_advisory', dispute_family: 'general_business' };
  }
  // Default to business dispute family (corporate dispute matters)
  return { intent_family: 'business_dispute', dispute_family: 'general_business' };
}

function makeMinPopulatedState(matter: MatterType): EngineState {
  const families = familyDefaultsFor(matter);
  const applicable = applicableMatterSlots(matter);

  // Fill contact slots so the contact gate is satisfied.
  const slots: Record<string, string> = {
    client_name: 'Test Caller',
    client_phone: '+14165550100',
    client_postal_code: 'M5T 1B3',
  };
  const slot_meta: Record<string, { source: 'explicit' | 'answered' }> = {
    client_name: { source: 'answered' },
    client_phone: { source: 'answered' },
    client_postal_code: { source: 'answered' },
  };

  // Fill ONE applicable matter-specific slot. The test's job is to
  // prove that even the minimal in-scope signal lifts the scorer off
  // the all-zero floor.
  //
  // THROW if no applicable slot can be picked. Two reasons:
  //   1. If `applicable.length === 0` the slot-coverage contract has
  //      already failed for this matter; this branch should be
  //      unreachable in a healthy registry.
  //   2. If applicable slots exist but none are pickable, the helper
  //      can't construct a realistic state. The scoring-coverage
  //      assertions would silently run on contact-only state and
  //      probably pass for the wrong reason. Loud failure forces a
  //      fix to `pickSlotValue` or a new slot.
  const applicableMatter = applicable.find((s) => pickSlotValue(s) !== null);
  if (!applicableMatter) {
    throw new Error(
      `Test fixture cannot build a min-populated state for matter type ` +
        `'${matter}': no applicable non-contact slot has a pickable value. ` +
        `Either (a) the matter has zero applicable slots in SLOT_REGISTRY ` +
        `(slot-coverage gap — should be caught by the sibling contract), ` +
        `or (b) every applicable slot uses an input_type the helper does ` +
        `not yet know how to fill. Extend pickSlotValue() to cover the new ` +
        `input_type, or add a matter-specific slot to slotRegistry.ts.`,
    );
  }
  const pickedValue = pickSlotValue(applicableMatter);
  if (pickedValue === null) {
    // Unreachable given the `find` predicate above, but the type
    // system does not know that.
    throw new Error(
      `Test fixture invariant violated: pickSlotValue returned null for ` +
        `slot '${applicableMatter.id}' on matter '${matter}' after the ` +
        `find predicate said it was non-null.`,
    );
  }
  slots[applicableMatter.id] = pickedValue;
  slot_meta[applicableMatter.id] = { source: 'answered' };

  return {
    input: '',
    practice_area: families.intent_family === 'estates' ? 'estates'
                 : families.intent_family === 'employment' ? 'employment'
                 : families.intent_family.startsWith('real_estate') ? 'real_estate'
                 : 'corporate',
    matter_type: matter,
    intent_family: families.intent_family,
    dispute_family: families.dispute_family,
    advisory_subtrack: 'unknown',
    slots,
    slot_meta: slot_meta as EngineState['slot_meta'],
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
      input_length: 50,
    },
    confidence: 0,
    coreCompleteness: 0.5,
    answeredQuestionGroups: [],
    questionHistory: [],
    insightShown: false,
    contactCaptureStarted: true,
    lead_id: `L-2026-06-01-CONTRACT-${matter.toUpperCase()}`,
    submitted_at: '2026-06-01T18:00:00.000Z',
    language: 'en',
  };
}

// ─── Contract 1: SLOT COVERAGE ──────────────────────────────────────────

describe('Slot coverage contract: every in-scope MatterType has applicable non-contact slots', () => {
  for (const matter of IN_SCOPE_MATTER_TYPES) {
    it(`${matter} has at least one applicable non-contact slot`, () => {
      const applicable = applicableMatterSlots(matter);
      expect(
        applicable.length,
        `MatterType '${matter}' has no non-contact slots with applies_to including it. ` +
          `Without applicable slots, the engine cannot deepen this matter through ` +
          `extraction or follow-up. Add at least one matter-specific slot in ` +
          `slotRegistry.ts with applies_to: ['${matter}', ...].`,
      ).toBeGreaterThan(0);
    });
  }
});

// ─── Contract 2: SCORING COVERAGE ────────────────────────────────────────

describe('Scoring coverage contract: in-scope matters with min signal avoid collapsed all-zero scoring', () => {
  for (const matter of IN_SCOPE_MATTER_TYPES) {
    it(`${matter} with min signal does NOT return all-four-axes zero`, () => {
      const state = makeMinPopulatedState(matter);
      const scores = scoreFourAxes(state);

      const allZero =
        scores.value === 0 &&
        scores.urgency === 0 &&
        scores.readiness === 0 &&
        scores.complexity === 0;

      expect(
        allZero,
        `MatterType '${matter}' returned all-four-axes zero with contact ` +
          `complete and at least one applicable matter slot filled. This is ` +
          `the broken-default signature: the scorer has no idea what to do ` +
          `with this matter type. Wire a per-matter branch in band.ts, OR ` +
          `lean on the data-driven baseline scorer (driven by slot tier / ` +
          `question_group / resolves / decision_value). Scores were: ` +
          `value=${scores.value}, urgency=${scores.urgency}, ` +
          `readiness=${scores.readiness}, complexity=${scores.complexity}.`,
      ).toBe(false);
    });

    it(`${matter} with min signal lifts value/readiness/complexity from structural signal alone`, () => {
      const state = makeMinPopulatedState(matter);
      const scores = scoreFourAxes(state);

      // Urgency may legitimately stay at 0 (no deadline/timeline signal
      // in min-populated state, and not every matter has matter-specific
      // urgency triggers). But value + readiness + complexity should
      // see SOME structural lift across the three.
      const structuralAxes = scores.value + scores.readiness + scores.complexity;
      expect(
        structuralAxes,
        `MatterType '${matter}' shows no structural lift (value + readiness + ` +
          `complexity all 0) when at least one applicable matter slot is filled. ` +
          `Even without a specific scorer branch, the baseline should derive at ` +
          `least 1 point from the slot's tier / question_group / decision_value.`,
      ).toBeGreaterThan(0);
    });

    it(`${matter} with min signal produces matter/slot-aware reasoning, not generic-weak fallback`, () => {
      const state = makeMinPopulatedState(matter);
      const result = computeBand(state);

      // The generic-weak signature was "Weak signal. Standard follow-up
      // cadence." with all-zero ratio. We assert NOT EXACTLY that text
      // alone (matter-specific scorers may still produce low-signal
      // bands legitimately) — but we DO assert that the reasoning string
      // is non-empty and contains some structured detail. Catching the
      // "Value 0/10 · Simplicity 10/10 · Urgency 0/10 · Readiness 0/10 ...
      // Weak signal" pattern specifically.
      expect(result.reasoning).toBeTruthy();
      expect(result.reasoning.length).toBeGreaterThan(20);

      // The exact broken pattern: weighted score 0.0 with weak-signal
      // text. If we see this, the scorer is in fallback mode.
      const isCollapsedDefault =
        result.reasoning.includes('Weighted 0.0') &&
        /Weak signal/i.test(result.reasoning);
      expect(
        isCollapsedDefault,
        `MatterType '${matter}' produced the collapsed-default reasoning ` +
          `(Weighted 0.0 + Weak signal). This is the all-zero scorer signature. ` +
          `Reasoning: ${result.reasoning}`,
      ).toBe(false);
    });
  }
});

// ─── Disqualifier gates remain intact (control test) ─────────────────────

describe('Disqualifier gates: out_of_scope and unknown are NOT subject to the scoring contract', () => {
  it('out_of_scope returns Band D regardless of slot fill', () => {
    const state = makeMinPopulatedState('estates_general'); // any base state
    state.matter_type = 'out_of_scope';
    state.practice_area = 'family';
    const result = computeBand(state);
    expect(result.band).toBe('D');
  });

  it('unknown returns Band C confidence 0 regardless of slot fill', () => {
    const state = makeMinPopulatedState('estates_general');
    state.matter_type = 'unknown';
    const result = computeBand(state);
    expect(result.band).toBe('C');
    expect(result.confidence).toBe(0);
  });
});
