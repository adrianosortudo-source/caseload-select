/**
 * DR-071 (2026-06-11): the clarify step doctrine.
 *
 * Field defect (Damaris widget test): the lead typed "I want to learn
 * more about the Fractional Counsel services" and the widget loaded
 * forever. Root cause: post-DR-070 the LLM no longer force-fits unknown
 * inputs to a nearest matter type (rule 2a, no-force-fit), so matter_type
 * stays 'unknown' for any input the engine cannot honestly classify. The
 * engine then emits `getNextStep => { type: 'clarify', message }` with
 * no `slot`. The widget had no clarify renderer; it sat on
 * `if (!currentItem) return spinner` indefinitely.
 *
 * This file pins the engine-side invariants the widget fix depends on:
 *  1. An unclassifiable input leaves matter_type='unknown' (not
 *     force-fit to a nearest type).
 *  2. getNextStep on an unknown state returns the clarify NextStep.
 *  3. The clarify NextStep carries a `message` and no `slot`.
 *  4. The clarify message is warm and inclusive of all DRG practice
 *     areas (no internal language like "route this correctly", and the
 *     wills/estates/employment areas are mentioned alongside corporate
 *     and real estate).
 *  5. When the lead's augmented input DOES classify, the engine moves
 *     on to a real slot question and never emits clarify again for that
 *     state.
 */

import { describe, it, expect } from 'vitest';
import { initialiseState } from '../extractor';
import { getNextStep, applyClarifyChoice, CLARIFY_AREA_OPTIONS } from '../control';
import { mergeLlmResults } from '../llm/extractor';
import { MATTER_TYPE_CLASSIFIER_FIELD } from '../llm/schema';

describe('clarify step doctrine (DR-071)', () => {
  it('leaves matter_type=unknown for inputs the regex classifier cannot place', () => {
    // A genuinely unclassifiable opener (no business / RE / employment /
    // estates / general-counsel signal). NOTE: the original Damaris repro
    // ("Fractional Counsel services") now classifies to
    // general_counsel_advisory under DR-072, so it no longer dead-ends in
    // clarify. See the DR-072 graduation test below.
    const state = initialiseState(
      'I would like to learn more about how you can help me',
    );
    expect(state.matter_type).toBe('unknown');
  });

  it('DR-072 graduation: "Fractional Counsel" now classifies, no longer hits clarify', () => {
    // The original field defect. DR-071 caught the spinner; DR-072 gave
    // the input a real home so it never reaches clarify at all.
    const state = initialiseState(
      'I want to learn more about the Fractional Counsel services',
    );
    expect(state.matter_type).toBe('general_counsel_advisory');
    expect(getNextStep(state).type).not.toBe('clarify');
  });

  it('getNextStep returns the clarify NextStep for matter_type=unknown', () => {
    const state = initialiseState(
      'I would like to learn more about how you can help me',
    );
    const step = getNextStep(state);
    expect(step.type).toBe('clarify');
  });

  it('the clarify NextStep carries a message and NO slot', () => {
    const state = initialiseState(
      'I would like to learn more about how you can help me',
    );
    const step = getNextStep(state);
    expect(step.type).toBe('clarify');
    expect(step.message).toBeTruthy();
    expect(step.slot).toBeUndefined();
  });

  it("clarify message is warm, not internal ('route this correctly' phrasing removed)", () => {
    const state = initialiseState(
      'I would like to learn more about how you can help me',
    );
    const step = getNextStep(state);
    expect(step.message).toBeTruthy();
    expect(step.message?.toLowerCase()).not.toContain('route this correctly');
    expect(step.message?.toLowerCase()).not.toContain('to route this');
  });

  it('clarify message names all DRG practice areas (corporate, RE, wills, estates, employment)', () => {
    const state = initialiseState(
      'I would like to learn more about how you can help me',
    );
    const step = getNextStep(state);
    const msg = (step.message ?? '').toLowerCase();
    expect(msg).toContain('business');
    expect(msg).toContain('contract');
    expect(msg).toContain('real estate');
    expect(msg).toContain('wills');
    expect(msg).toMatch(/estates?/);
    expect(msg).toContain('employment');
  });

  it('LLM honest-null on the unknown classifier keeps matter_type=unknown and the clarify path active', () => {
    // The DR-070 no-force-fit rule tells the LLM to return null when no
    // canonical type matches. Simulate: classifier slot returns null
    // (Gemini honestly declines). Merge should NOT promote, matter_type
    // stays unknown, clarify still fires.
    const before = initialiseState(
      'I would like to learn more about how you can help me',
    );
    const after = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: null,
    });
    expect(after.matter_type).toBe('unknown');
    expect(getNextStep(after).type).toBe('clarify');
  });

  it('an augmented input that DOES classify exits the clarify loop on next pass', () => {
    // The widget's submitClarify concatenates the original text with the
    // lead's clarification. When the augmented text contains a real
    // matter-type signal, initialiseState classifies it; clarify never
    // fires for that state.
    const augmented =
      'I want to learn more about the Fractional Counsel services. ' +
      "Specifically, I'm starting a new business and want a lawyer on retainer.";
    const state = initialiseState(augmented);
    expect(state.matter_type).toBe('business_setup_advisory');
    expect(getNextStep(state).type).not.toBe('clarify');
  });

  it('engine NEVER returns a NextStep without a slot AND without a clarify message', () => {
    // The widget invariant: every possible NextStep returned for an
    // unknown matter must be either type='clarify' (widget renders the
    // clarify card) OR carry a slot (widget renders the question). The
    // legacy spinner-forever bug was: type was something else, slot was
    // missing, widget had no fallback. This guards against re-introducing
    // that shape.
    const inputs = [
      'I would like to learn more about how you can help me',
      'I need notary services',
      'I need help with records upkeep',
      'I am looking for a lawyer',
    ];
    for (const input of inputs) {
      const state = initialiseState(input);
      const step = getNextStep(state);
      const hasSlot = !!step.slot;
      const hasClarifyMessage =
        step.type === 'clarify' && !!step.message;
      const isTerminal =
        step.type === 'present_insight' ||
        step.type === 'capture_contact' ||
        step.type === 'stop';
      expect(hasSlot || hasClarifyMessage || isTerminal).toBe(true);
    }
  });
});

/**
 * DR-112: the clarify step is now structured (reason, messageKey, options)
 * on top of the DR-071 shape, and a menu choice deterministically exits
 * clarify via applyClarifyChoice. These tests extend, not replace, the
 * DR-071 invariants above.
 */
describe('structured clarify step (DR-112)', () => {
  it('carries reason=unclassified and the 4-option menu for a non-meta unclassifiable input', () => {
    const state = initialiseState('I would like to learn more about how you can help me');
    const step = getNextStep(state);
    expect(step.type).toBe('clarify');
    expect(step.reason).toBe('unclassified');
    expect(step.messageKey).toBe('clarify_body_default');
    expect(step.options).toEqual(CLARIFY_AREA_OPTIONS);
  });

  it('carries reason=contact_request and the same menu for a bare contact-request opener', () => {
    const state = initialiseState('i want to speak to a lawyer');
    expect(state.matter_type).toBe('unknown');
    const step = getNextStep(state);
    expect(step.type).toBe('clarify');
    expect(step.reason).toBe('contact_request');
    expect(step.messageKey).toBe('clarify_body_meta');
    expect(step.options).toEqual(CLARIFY_AREA_OPTIONS);
  });

  it('still carries a non-empty message (backward compatibility for callers that only read it)', () => {
    const state = initialiseState('i want to speak to a lawyer');
    const step = getNextStep(state);
    expect(step.message).toBeTruthy();
  });

  it.each(CLARIFY_AREA_OPTIONS.map((o) => o.value))(
    'applyClarifyChoice(%s) exits clarify: getNextStep returns a slot, never clarify',
    (choice) => {
      const state = initialiseState('I would like to learn more about how you can help me');
      expect(state.matter_type).toBe('unknown');
      const routed = applyClarifyChoice(state, choice);
      expect(routed.matter_type).toBe(choice);
      expect(routed.matter_type_provenance).toBe('user_routing_answer');
      const step = getNextStep(routed);
      expect(step.type).not.toBe('clarify');
      expect(step.slot).toBeTruthy();
    },
  );

  it('applyClarifyChoice(corporate_general) sets practice_area=corporate and routes to the corporate routing question', () => {
    const state = initialiseState('i want to speak to a lawyer');
    const routed = applyClarifyChoice(state, 'corporate_general');
    expect(routed.practice_area).toBe('corporate');
    const step = getNextStep(routed);
    expect(step.slot?.id).toBe('corporate_problem_type');
  });

  it('applyClarifyChoice(real_estate_general) sets practice_area=real_estate and routes to the real-estate routing question', () => {
    const state = initialiseState('i want to speak to a lawyer');
    const routed = applyClarifyChoice(state, 'real_estate_general');
    expect(routed.practice_area).toBe('real_estate');
    const step = getNextStep(routed);
    expect(step.slot?.id).toBe('real_estate_problem_type');
  });

  it('applyClarifyChoice(employment_general) sets practice_area=employment and routes to the employment routing question', () => {
    const state = initialiseState('i want to speak to a lawyer');
    const routed = applyClarifyChoice(state, 'employment_general');
    expect(routed.practice_area).toBe('employment');
    const step = getNextStep(routed);
    expect(step.slot?.id).toBe('employment_problem_type');
  });

  it('applyClarifyChoice(estates_general) sets practice_area=estates and routes to the estates routing question', () => {
    const state = initialiseState('i want to speak to a lawyer');
    const routed = applyClarifyChoice(state, 'estates_general');
    expect(routed.practice_area).toBe('estates');
    const step = getNextStep(routed);
    expect(step.slot?.id).toBe('estates_problem_type');
  });

  it('rejects a value outside CLARIFY_AREA_OPTIONS as a no-op', () => {
    const state = initialiseState('i want to speak to a lawyer');
    const routed = applyClarifyChoice(state, 'wrongful_dismissal');
    expect(routed).toEqual(state);
  });

  it('does not mutate clarify-round accounting fields (menu choice is not a free-text retry)', () => {
    // applyClarifyChoice only touches matter-type-derived fields + scoring.
    // Any round-budget counter lives on the surface (widget clarifyAttempts
    // state), not on EngineState, so there is nothing here to increment;
    // this test pins that assumption by checking no unexpected top-level
    // key beyond the classification + scoring fields changed.
    const state = initialiseState('i want to speak to a lawyer');
    const routed = applyClarifyChoice(state, 'corporate_general');
    expect(routed.lead_id).toBe(state.lead_id);
    expect(routed.slots).toBe(state.slots);
    expect(routed.slot_meta).toBe(state.slot_meta);
    expect(routed.questionHistory).toBe(state.questionHistory);
  });
});
