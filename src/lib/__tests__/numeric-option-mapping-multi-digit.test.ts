/**
 * applyMultiNumericAnswerMapping (WP-3c, 2026-08-13).
 *
 * Field case 2026-08-07: a lead replied "1 and 2 and 3" to a single-pick
 * question ("What are you most concerned about?"). The single-digit
 * mapper (DIGIT_REPLY_RE) does not match multi-digit text, so the reply
 * fell through to the LLM, which cannot map bare digits without question
 * context. The engine re-asked the same question with no acknowledgment.
 *
 * Lives in src/lib/ (not screen-engine/), same as the sibling
 * single-digit mapper this file extends: no sandbox mirror needed.
 */
import { describe, it, expect } from 'vitest';
import { applyMultiNumericAnswerMapping } from '../numeric-option-mapping';
import type { EngineState } from '../screen-engine/types';

function advisoryPathState(): EngineState {
  return {
    input: '',
    practice_area: 'corporate',
    matter_type: 'business_setup_advisory',
    intent_family: 'setup_advisory',
    dispute_family: 'general_business',
    advisory_subtrack: 'unknown',
    slots: {},
    slot_meta: {},
    slot_evidence: {},
    raw: {
      mentions_urgency: false, mentions_money: false, mentions_access: false,
      mentions_ownership: false, mentions_documents: false, mentions_payment: false,
      mentions_agreement: false, mentions_vendor: false, mentions_fraud: false,
      mentions_property: false, mentions_closing: false, mentions_lease: false,
      mentions_construction: false, mentions_mortgage: false,
      mentions_preconstruction: false, input_length: 0,
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

describe('applyMultiNumericAnswerMapping', () => {
  // advisory_path (4 options, no "All of the above") is the next-step
  // slot on a fresh business_setup_advisory state.
  it('picks the first named option and flags pickedFirstOfMultiple when no All-of-the-above exists', () => {
    const result = applyMultiNumericAnswerMapping('1 and 2', advisoryPathState());
    expect(result.pickedFirstOfMultiple).toBe(true);
    expect(result.state.slots.advisory_path).toBe('Starting a new business');
  });

  it.each(['1, 2', '1 and 2', '1 & 2', '1 e 2', '1 y 2', '1+2'])(
    'accepts "%s" as a multi-pick reply',
    (text) => {
      const result = applyMultiNumericAnswerMapping(text, advisoryPathState());
      expect(result.pickedFirstOfMultiple).toBe(true);
      expect(result.state.slots.advisory_path).toBe('Starting a new business');
    },
  );

  it('does not treat a single digit as a multi-pick', () => {
    const result = applyMultiNumericAnswerMapping('2', advisoryPathState());
    expect(result.pickedFirstOfMultiple).toBe(false);
    expect(result.state.slots.advisory_path).toBeUndefined();
  });

  it('does not treat repeated identical digits as a multi-pick', () => {
    const result = applyMultiNumericAnswerMapping('1 and 1', advisoryPathState());
    expect(result.pickedFirstOfMultiple).toBe(false);
    expect(result.state.slots.advisory_path).toBeUndefined();
  });

  it('no-ops when any named digit is out of range (punts to the out-of-range path)', () => {
    const result = applyMultiNumericAnswerMapping('1 and 11', advisoryPathState());
    expect(result.pickedFirstOfMultiple).toBe(false);
    expect(result.state.slots.advisory_path).toBeUndefined();
  });

  it('no-ops when the next-step slot already carries a raw value (e.g. an unconfirmed LLM guess)', () => {
    // advisory_path has a value but 'llm_inferred' provenance, so
    // isUserAnswered is false and getNextStep still targets it as the
    // next slot to ask; the multi-digit mapper's guard checks the raw
    // slots value (not provenance) and must not clobber it.
    const tentative: EngineState = {
      ...advisoryPathState(),
      slots: { advisory_path: 'Buying into an existing business' },
      slot_meta: { advisory_path: { source: 'llm_inferred' } },
    };
    const result = applyMultiNumericAnswerMapping('1 and 2', tentative);
    expect(result.pickedFirstOfMultiple).toBe(false);
    expect(result.state.slots.advisory_path).toBe('Buying into an existing business');
  });

  it('does not match free text that merely contains digits mid-sentence', () => {
    const result = applyMultiNumericAnswerMapping('I pick 1 and maybe 2 later', advisoryPathState());
    expect(result.pickedFirstOfMultiple).toBe(false);
    expect(result.state.slots.advisory_path).toBeUndefined();
  });
});
