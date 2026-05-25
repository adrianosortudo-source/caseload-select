/**
 * Tests for free-text-fuzzy-match.ts.
 *
 * Pins the natural-language fuzzy-match path that closes the Phase C
 * loop where a single_select slot was asked, the lead replied "dont
 * know" / "yes" / "no" in plain English, and the engine had no
 * extraction path (LLM ignores non-answer literals per DR-025; regex
 * patterns are exact-option-string only).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyFreeTextFuzzyMatch } from '../free-text-fuzzy-match';
import type { EngineState, SlotDefinition } from '../screen-engine/types';

vi.mock('../screen-engine/control', () => ({
  getNextStep: vi.fn(),
  applyAnswer: vi.fn(),
}));

import { getNextStep, applyAnswer } from '../screen-engine/control';
const getNextStepMock = vi.mocked(getNextStep);
const applyAnswerMock = vi.mocked(applyAnswer);

function baseState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    lead_id: 'L-TEST-FUZZY',
    input: '',
    matter_type: 'shareholder_dispute',
    practice_area: 'corporate',
    intent_family: 'business_dispute',
    language: 'en',
    channel: 'facebook',
    slots: {},
    slot_meta: {},
    slot_evidence: {},
    submitted_at: new Date('2026-05-25T00:00:00Z').toISOString(),
    contactCaptureStarted: true,
    discoveryFollowUpCount: 2,
    ...overrides,
  } as EngineState;
}

function ownershipPercentageSlot(): SlotDefinition {
  // Reproduces the slot from slotRegistry.ts that caused the
  // 2026-05-24 loop bug. Last option is "Not sure".
  return {
    id: 'ownership_percentage',
    question: 'What percentage of the company do you own, if you know?',
    input_type: 'single_select',
    options: [
      { value: '100%', label: '100%' },
      { value: '51-99%', label: '51-99%' },
      { value: '26-50%', label: '26-50%' },
      { value: '1-25%', label: '1-25%' },
      { value: 'Not sure', label: 'Not sure' },
    ],
    applies_to: ['shareholder_dispute'],
    tier: 'core',
    question_group: 'matter',
    abstraction_level: 'concrete',
    required: true,
    priority: 5,
    resolves: 'none',
    decision_value: 0,
  } as unknown as SlotDefinition;
}

function yesNoSlot(slotId: string): SlotDefinition {
  return {
    id: slotId,
    question: 'Is the company profitable?',
    input_type: 'single_select',
    options: [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
      { value: 'Not sure', label: 'Not sure' },
    ],
    applies_to: ['shareholder_dispute'],
    tier: 'core',
    question_group: 'matter',
    abstraction_level: 'concrete',
    required: true,
    priority: 5,
    resolves: 'none',
    decision_value: 0,
  } as unknown as SlotDefinition;
}

function configureApplyAnswerMock(): void {
  applyAnswerMock.mockImplementation((state, slotId, value) => ({
    ...state,
    slots: { ...state.slots, [slotId]: value },
    slot_meta: {
      ...state.slot_meta,
      [slotId]: { source: 'answered', confidence: 1.0 },
    },
  }));
}

describe('applyFreeTextFuzzyMatch — non-answer replies', () => {
  beforeEach(() => {
    getNextStepMock.mockReset();
    applyAnswerMock.mockReset();
    configureApplyAnswerMock();
  });

  it('maps "dont know" to "Not sure" option on ownership_percentage', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: ownershipPercentageSlot() });
    const after = applyFreeTextFuzzyMatch('dont know', baseState());
    expect(applyAnswerMock).toHaveBeenCalledWith(
      expect.anything(),
      'ownership_percentage',
      'Not sure',
    );
    expect(after.slots['ownership_percentage']).toBe('Not sure');
  });

  it('maps "I don\'t know" (with apostrophe)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: ownershipPercentageSlot() });
    applyFreeTextFuzzyMatch("I don't know", baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'ownership_percentage',
      'Not sure',
    );
  });

  it('maps "not sure"', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: ownershipPercentageSlot() });
    applyFreeTextFuzzyMatch('not sure', baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'ownership_percentage',
      'Not sure',
    );
  });

  it('maps "idk"', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: ownershipPercentageSlot() });
    applyFreeTextFuzzyMatch('idk', baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'ownership_percentage',
      'Not sure',
    );
  });

  it('maps "no idea"', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: ownershipPercentageSlot() });
    applyFreeTextFuzzyMatch('no idea', baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'ownership_percentage',
      'Not sure',
    );
  });

  it('returns state unchanged when slot has no "Not sure"-like option', () => {
    const slotWithoutNotSure: SlotDefinition = {
      ...ownershipPercentageSlot(),
      options: [
        { value: '100%', label: '100%' },
        { value: '1-25%', label: '1-25%' },
      ],
    } as SlotDefinition;
    getNextStepMock.mockReturnValue({ type: 'continue', slot: slotWithoutNotSure });
    const before = baseState();
    const after = applyFreeTextFuzzyMatch('dont know', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });
});

describe('applyFreeTextFuzzyMatch — affirmative replies', () => {
  beforeEach(() => {
    getNextStepMock.mockReset();
    applyAnswerMock.mockReset();
    configureApplyAnswerMock();
  });

  it('maps "yes" to "Yes" option', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: yesNoSlot('company_profitable') });
    applyFreeTextFuzzyMatch('yes', baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'company_profitable',
      'Yes',
    );
  });

  it.each(['yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'correct', 'absolutely'])(
    'maps "%s" to "Yes" option',
    (reply) => {
      getNextStepMock.mockReturnValue({ type: 'continue', slot: yesNoSlot('company_profitable') });
      applyFreeTextFuzzyMatch(reply, baseState());
      expect(applyAnswerMock).toHaveBeenLastCalledWith(
        expect.anything(),
        'company_profitable',
        'Yes',
      );
    },
  );
});

describe('applyFreeTextFuzzyMatch — negative replies', () => {
  beforeEach(() => {
    getNextStepMock.mockReset();
    applyAnswerMock.mockReset();
    configureApplyAnswerMock();
  });

  it('maps "no" to "No" option', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: yesNoSlot('company_profitable') });
    applyFreeTextFuzzyMatch('no', baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'company_profitable',
      'No',
    );
  });

  it.each(['nope', 'nah', 'not really'])('maps "%s" to "No" option', (reply) => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: yesNoSlot('company_profitable') });
    applyFreeTextFuzzyMatch(reply, baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'company_profitable',
      'No',
    );
  });

  it('"i don\'t know" is NOT classified as "no" (non-answer takes priority)', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: yesNoSlot('company_profitable') });
    applyFreeTextFuzzyMatch("i don't know", baseState());
    expect(applyAnswerMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'company_profitable',
      'Not sure',
    );
  });
});

describe('applyFreeTextFuzzyMatch — guards', () => {
  beforeEach(() => {
    getNextStepMock.mockReset();
    applyAnswerMock.mockReset();
    configureApplyAnswerMock();
  });

  it('no-op on free-form replies', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: ownershipPercentageSlot() });
    const before = baseState();
    const after = applyFreeTextFuzzyMatch(
      'I own most of the company but my partner has a small stake',
      before,
    );
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op when slot is free_text', () => {
    const freeText: SlotDefinition = {
      ...ownershipPercentageSlot(),
      input_type: 'free_text',
      options: undefined,
    } as SlotDefinition;
    getNextStepMock.mockReturnValue({ type: 'continue', slot: freeText });
    const before = baseState();
    const after = applyFreeTextFuzzyMatch('dont know', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op when slot is already filled', () => {
    getNextStepMock.mockReturnValue({ type: 'continue', slot: ownershipPercentageSlot() });
    const before = baseState({ slots: { ownership_percentage: '100%' } });
    const after = applyFreeTextFuzzyMatch('dont know', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('survives getNextStep throwing (defensive)', () => {
    getNextStepMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const before = baseState();
    const after = applyFreeTextFuzzyMatch('dont know', before);
    expect(after).toBe(before);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('handles the exact field-detected case (DRG ownership, "dont know")', () => {
    // The reply that triggered the loop bug 2026-05-24: bot asked
    // ownership_percentage with options 1-5, lead replied "dont
    // know", engine re-asked. After this fix, the reply maps to
    // "Not sure" via applyAnswer and the engine advances.
    getNextStepMock.mockReturnValue({ type: 'continue', slot: ownershipPercentageSlot() });
    const before = baseState({
      slots: {
        client_name: 'Sarah Patel',
        client_email: 'sarah.patel.test@example.com',
        client_phone: '+16475559999',
      },
    });
    const after = applyFreeTextFuzzyMatch('dont know', before);
    expect(after.slots['ownership_percentage']).toBe('Not sure');
    // Existing contact slots preserved.
    expect(after.slots['client_name']).toBe('Sarah Patel');
  });
});
