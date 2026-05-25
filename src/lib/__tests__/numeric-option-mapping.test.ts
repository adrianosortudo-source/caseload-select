/**
 * Tests for numeric-option-mapping.ts.
 *
 * Pin the digit-reply mapping path that closes the Phase C loop hole
 * field-detected on 2026-05-24 (DRG Messenger: bot asks numbered
 * single_select, lead replies with bare digit, LLM can't extract
 * context-free digit, bot loops asking same question).
 *
 * Implementation routes through the engine's `applyAnswer` (same
 * canonical write path as web-widget chip clicks), so tests mock both
 * `getNextStep` and `applyAnswer` to keep the assertions on the
 * adapter logic (not on the engine helper's full re-derivation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyNumericAnswerMapping,
  detectOutOfRangeDigitReply,
  buildOutOfRangeDigitReply,
} from '../numeric-option-mapping';
import type { EngineState, SlotDefinition } from '../screen-engine/types';

// Mock the engine helpers used by applyNumericAnswerMapping.
vi.mock('../screen-engine/control', () => ({
  getNextStep: vi.fn(),
  applyAnswer: vi.fn(),
}));

import { getNextStep, applyAnswer } from '../screen-engine/control';
const getNextStepMock = vi.mocked(getNextStep);
const applyAnswerMock = vi.mocked(applyAnswer);

function baseState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    lead_id: 'L-TEST-002',
    input: '',
    matter_type: 'corporate_general',
    practice_area: 'corporate',
    intent_family: 'dispute',
    language: 'en',
    channel: 'facebook',
    slots: {},
    slot_meta: {},
    slot_evidence: {},
    submitted_at: new Date('2026-05-24T00:00:00Z').toISOString(),
    contactCaptureStarted: true,
    discoveryFollowUpCount: 1,
    ...overrides,
  } as EngineState;
}

function corporateProblemTypeSlot(): SlotDefinition {
  return {
    id: 'corporate_problem_type',
    question: 'What best describes the problem you are facing?',
    input_type: 'single_select',
    options: [
      { value: 'Someone owes my company money', label: 'Someone owes my company money' },
      { value: 'I have a dispute with a business partner or co-owner', label: 'I have a dispute with a business partner or co-owner' },
      { value: 'A vendor or supplier has billed us incorrectly', label: 'A vendor or supplier has billed us incorrectly' },
      { value: 'I am concerned about financial irregularities in the company', label: 'I am concerned about financial irregularities in the company' },
      { value: 'A contract or agreement was not honoured', label: 'A contract or agreement was not honoured' },
      { value: 'Something else', label: 'Something else' },
    ],
    applies_to: ['corporate_general'],
    tier: 'core',
    question_group: 'routing',
    abstraction_level: 'concrete',
    required: true,
    priority: 1,
  } as SlotDefinition;
}

/** Default applyAnswer mock returns the state with the slot written so
 *  downstream assertions can read it back. The real applyAnswer does
 *  much more (reroute, band recompute, etc.) — tests of THAT belong in
 *  control.ts's own test file; here we only verify the adapter calls
 *  it with the right (slotId, value) pair. */
function configureApplyAnswerMockToWriteSlot(): void {
  applyAnswerMock.mockImplementation((state, slotId, value) => ({
    ...state,
    slots: { ...state.slots, [slotId]: value },
    slot_meta: {
      ...state.slot_meta,
      [slotId]: { source: 'answered', confidence: 1.0 },
    },
  }));
}

describe('applyNumericAnswerMapping', () => {
  beforeEach(() => {
    getNextStepMock.mockReset();
    applyAnswerMock.mockReset();
    configureApplyAnswerMockToWriteSlot();
  });

  it('maps "2" to options[1].value and routes through applyAnswer', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: corporateProblemTypeSlot(),
    });
    const before = baseState();
    const after = applyNumericAnswerMapping('2', before);
    expect(applyAnswerMock).toHaveBeenCalledTimes(1);
    expect(applyAnswerMock).toHaveBeenCalledWith(
      before,
      'corporate_problem_type',
      'I have a dispute with a business partner or co-owner',
    );
    expect(after.slots['corporate_problem_type']).toBe(
      'I have a dispute with a business partner or co-owner',
    );
  });

  it('tolerates "2." (trailing period)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    applyNumericAnswerMapping('2.', baseState());
    expect(applyAnswerMock).toHaveBeenCalledWith(
      expect.anything(),
      'corporate_problem_type',
      'I have a dispute with a business partner or co-owner',
    );
  });

  it('tolerates " 2 " (whitespace)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    applyNumericAnswerMapping('  2  ', baseState());
    expect(applyAnswerMock).toHaveBeenCalledWith(
      expect.anything(),
      'corporate_problem_type',
      'I have a dispute with a business partner or co-owner',
    );
  });

  it('tolerates "Option 2" / "option 2"', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    applyNumericAnswerMapping('Option 2', baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'corporate_problem_type',
      'I have a dispute with a business partner or co-owner',
    );
    applyAnswerMock.mockClear();
    configureApplyAnswerMockToWriteSlot();
    applyNumericAnswerMapping('option 2', baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'corporate_problem_type',
      'I have a dispute with a business partner or co-owner',
    );
  });

  it('tolerates "#2"', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    applyNumericAnswerMapping('#2', baseState());
    expect(applyAnswerMock).toHaveBeenCalledWith(
      expect.anything(),
      'corporate_problem_type',
      'I have a dispute with a business partner or co-owner',
    );
  });

  it('returns same state when reply has trailing free-text ("2 because...")', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState();
    const after = applyNumericAnswerMapping('2 because that fits best', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('returns same state when digit exceeds option count', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState();
    const after = applyNumericAnswerMapping('99', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('returns same state when next-step slot is free_text', () => {
    const freeTextSlot: SlotDefinition = {
      ...corporateProblemTypeSlot(),
      id: 'open_question',
      input_type: 'free_text',
      options: undefined,
    } as SlotDefinition;
    getNextStepMock.mockReturnValue({ type: 'continue', slot: freeTextSlot });
    const before = baseState();
    const after = applyNumericAnswerMapping('2', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('returns same state when getNextStep returns no slot', () => {
    getNextStepMock.mockReturnValue({ type: 'stop' });
    const before = baseState();
    const after = applyNumericAnswerMapping('2', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('returns same state when reply is not a digit', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState();
    const after = applyNumericAnswerMapping('I have a dispute', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('does NOT overwrite slot when it is already filled', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState({
      slots: { corporate_problem_type: 'Something else' },
    });
    const after = applyNumericAnswerMapping('2', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('survives a getNextStep that throws (defensive — never break the turn)', () => {
    getNextStepMock.mockImplementation(() => {
      throw new Error('corrupt state');
    });
    const before = baseState();
    const after = applyNumericAnswerMapping('2', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('passes the right call shape so applyAnswer can reroute corporate_general', () => {
    // This is the architectural assertion: the digit map MUST go through
    // applyAnswer (not write state.slots directly), because applyAnswer
    // is what triggers rerouteFromCorporateGeneral / band recompute /
    // questionHistory update.
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    applyNumericAnswerMapping('2', baseState());
    expect(applyAnswerMock).toHaveBeenCalledTimes(1);
    const [stateArg, slotIdArg, valueArg] = applyAnswerMock.mock.calls[0];
    expect(slotIdArg).toBe('corporate_problem_type');
    expect(valueArg).toBe('I have a dispute with a business partner or co-owner');
    expect(stateArg.matter_type).toBe('corporate_general'); // pre-reroute
  });
});

// ── Out-of-range digit detection ────────────────────────────────────────

describe('detectOutOfRangeDigitReply', () => {
  beforeEach(() => {
    getNextStepMock.mockReset();
    applyAnswerMock.mockReset();
  });

  it('detects "11" as out-of-range for a 6-option slot (field-case 2026-05-25)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const detection = detectOutOfRangeDigitReply('11', baseState());
    expect(detection).not.toBeNull();
    expect(detection!.digit).toBe(11);
    expect(detection!.maxOption).toBe(6);
    expect(detection!.reason).toBe('out_of_range');
    expect(detection!.slot.id).toBe('corporate_problem_type');
  });

  it('detects "99" as out-of-range', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const detection = detectOutOfRangeDigitReply('99', baseState());
    expect(detection?.reason).toBe('out_of_range');
  });

  it('detects "0" as zero-or-negative (digit < 1)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const detection = detectOutOfRangeDigitReply('0', baseState());
    expect(detection?.reason).toBe('zero_or_negative');
  });

  it('returns null when digit is in valid range (normal flow handles it)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    expect(detectOutOfRangeDigitReply('3', baseState())).toBeNull();
    expect(detectOutOfRangeDigitReply('1', baseState())).toBeNull();
    expect(detectOutOfRangeDigitReply('6', baseState())).toBeNull();
  });

  it('returns null for non-digit replies', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    expect(detectOutOfRangeDigitReply('I have a dispute', baseState())).toBeNull();
  });

  it('returns null when next-step slot is not single_select', () => {
    const freeTextSlot: SlotDefinition = {
      ...corporateProblemTypeSlot(),
      input_type: 'free_text',
      options: undefined,
    } as SlotDefinition;
    getNextStepMock.mockReturnValue({ type: 'continue', slot: freeTextSlot });
    expect(detectOutOfRangeDigitReply('99', baseState())).toBeNull();
  });

  it('returns null when slot is already filled', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState({ slots: { corporate_problem_type: 'Something else' } });
    expect(detectOutOfRangeDigitReply('99', before)).toBeNull();
  });

  it('survives getNextStep throwing (defensive)', () => {
    getNextStepMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(detectOutOfRangeDigitReply('99', baseState())).toBeNull();
  });
});

describe('buildOutOfRangeDigitReply', () => {
  it('formats a friendly clarification with re-listed options', () => {
    const text = buildOutOfRangeDigitReply({
      slot: corporateProblemTypeSlot(),
      digit: 11,
      maxOption: 6,
      reason: 'out_of_range',
    });
    expect(text).toContain('"11"');
    expect(text).toContain('1 to 6');
    expect(text).toContain('What best describes the problem you are facing?');
    expect(text).toContain('1. Someone owes my company money');
    expect(text).toContain('6. Something else');
  });

  it('handles digit=0 (zero_or_negative reason) with the same friendly framing', () => {
    const text = buildOutOfRangeDigitReply({
      slot: corporateProblemTypeSlot(),
      digit: 0,
      maxOption: 6,
      reason: 'zero_or_negative',
    });
    expect(text).toContain('"0"');
    expect(text).toContain('1 to 6');
  });
});
