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
import { getNextStep } from '../control';
import { mergeLlmResults } from '../llm/extractor';
import { MATTER_TYPE_CLASSIFIER_FIELD } from '../llm/schema';

describe('clarify step doctrine (DR-071)', () => {
  it('leaves matter_type=unknown for inputs the regex classifier cannot place', () => {
    // The exact Damaris field repro. "Fractional Counsel" is not in any
    // matter-type regex keyword set.
    const state = initialiseState(
      'I want to learn more about the Fractional Counsel services',
    );
    expect(state.matter_type).toBe('unknown');
  });

  it('getNextStep returns the clarify NextStep for matter_type=unknown', () => {
    const state = initialiseState(
      'I want to learn more about the Fractional Counsel services',
    );
    const step = getNextStep(state);
    expect(step.type).toBe('clarify');
  });

  it('the clarify NextStep carries a message and NO slot', () => {
    const state = initialiseState(
      'I want to learn more about the Fractional Counsel services',
    );
    const step = getNextStep(state);
    expect(step.type).toBe('clarify');
    expect(step.message).toBeTruthy();
    expect(step.slot).toBeUndefined();
  });

  it("clarify message is warm, not internal ('route this correctly' phrasing removed)", () => {
    const state = initialiseState(
      'I want to learn more about the Fractional Counsel services',
    );
    const step = getNextStep(state);
    expect(step.message).toBeTruthy();
    expect(step.message?.toLowerCase()).not.toContain('route this correctly');
    expect(step.message?.toLowerCase()).not.toContain('to route this');
  });

  it('clarify message names all DRG practice areas (corporate, RE, wills, estates, employment)', () => {
    const state = initialiseState(
      'I want to learn more about the Fractional Counsel services',
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
      'I want to learn more about the Fractional Counsel services',
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
      'I want to learn more about the Fractional Counsel services',
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
