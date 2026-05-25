/**
 * Tests for numeric-option-mapping.ts.
 *
 * Pin the digit-reply mapping path that closes the Phase C loop hole
 * field-detected on 2026-05-24 (DRG Messenger: bot asks numbered
 * single_select, lead replies with bare digit, LLM can't extract
 * context-free digit, bot loops asking same question).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyNumericAnswerMapping } from '../numeric-option-mapping';
import type { EngineState, SlotDefinition } from '../screen-engine/types';

// Mock getNextStep so the tests can pin exactly what slot is "currently
// being asked" without spinning up the full slot registry resolver.
vi.mock('../screen-engine/control', () => ({
  getNextStep: vi.fn(),
}));

import { getNextStep } from '../screen-engine/control';
const getNextStepMock = vi.mocked(getNextStep);

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

describe('applyNumericAnswerMapping', () => {
  beforeEach(() => {
    getNextStepMock.mockReset();
  });

  it('maps "2" to options[1].value when next slot is single_select', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: corporateProblemTypeSlot(),
    });
    const before = baseState();
    const after = applyNumericAnswerMapping('2', before);
    expect(after.slots['corporate_problem_type']).toBe(
      'I have a dispute with a business partner or co-owner',
    );
    expect(after.slot_meta['corporate_problem_type']?.source).toBe('explicit');
    expect(after.slot_meta['corporate_problem_type']?.evidence).toContain('numeric option reply: 2');
  });

  it('tolerates "2." (trailing period)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const after = applyNumericAnswerMapping('2.', baseState());
    expect(after.slots['corporate_problem_type']).toBe(
      'I have a dispute with a business partner or co-owner',
    );
  });

  it('tolerates " 2 " (whitespace)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const after = applyNumericAnswerMapping('  2  ', baseState());
    expect(after.slots['corporate_problem_type']).toBe(
      'I have a dispute with a business partner or co-owner',
    );
  });

  it('tolerates "Option 2" / "option 2"', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    expect(applyNumericAnswerMapping('Option 2', baseState()).slots['corporate_problem_type'])
      .toBe('I have a dispute with a business partner or co-owner');
    expect(applyNumericAnswerMapping('option 2', baseState()).slots['corporate_problem_type'])
      .toBe('I have a dispute with a business partner or co-owner');
  });

  it('tolerates "#2"', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const after = applyNumericAnswerMapping('#2', baseState());
    expect(after.slots['corporate_problem_type']).toBe(
      'I have a dispute with a business partner or co-owner',
    );
  });

  it('returns same state when reply has trailing free-text ("2 because...")', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState();
    const after = applyNumericAnswerMapping('2 because that fits best', before);
    // Free-text after the digit must NOT trigger mapping — let LLM handle it.
    expect(after).toBe(before);
  });

  it('returns same state when digit exceeds option count', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState();
    const after = applyNumericAnswerMapping('99', before);
    expect(after).toBe(before);
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
  });

  it('returns same state when getNextStep returns no slot', () => {
    getNextStepMock.mockReturnValue({ type: 'stop' });
    const before = baseState();
    const after = applyNumericAnswerMapping('2', before);
    expect(after).toBe(before);
  });

  it('returns same state when reply is not a digit', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState();
    const after = applyNumericAnswerMapping('I have a dispute', before);
    expect(after).toBe(before);
  });

  it('does NOT overwrite slot when it is already filled', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState({
      slots: { corporate_problem_type: 'Something else' },
    });
    const after = applyNumericAnswerMapping('2', before);
    expect(after).toBe(before);
    expect(after.slots['corporate_problem_type']).toBe('Something else');
  });

  it('handles the exact field-detected case (Sarah Patel, "2" reply)', () => {
    // Reproduces the loop trigger from 2026-05-24:
    //   bot: "What best describes the problem you are facing? 1. … / 2. I
    //         have a dispute with a business partner or co-owner / …"
    //   lead: "2"
    //   (before fix: engine looped; after fix: slot fills, engine advances)
    getNextStepMock.mockReturnValue({ type: 'continue', slot: corporateProblemTypeSlot() });
    const before = baseState({
      slots: {
        client_name: 'Sarah Patel',
        client_email: 'sarah.patel.test@example.com',
        client_phone: '+16475559999',
      },
      discoveryFollowUpCount: 1,
    });
    const after = applyNumericAnswerMapping('2', before);
    expect(after.slots['corporate_problem_type']).toBe(
      'I have a dispute with a business partner or co-owner',
    );
    // Existing contact slots unchanged.
    expect(after.slots['client_name']).toBe('Sarah Patel');
    expect(after.slots['client_email']).toBe('sarah.patel.test@example.com');
    expect(after.slots['client_phone']).toBe('+16475559999');
  });

  it('survives a getNextStep that throws (defensive — never break the turn)', () => {
    getNextStepMock.mockImplementation(() => {
      throw new Error('corrupt state');
    });
    const before = baseState();
    const after = applyNumericAnswerMapping('2', before);
    // No mapping applied, but no exception bubbles.
    expect(after).toBe(before);
  });
});
