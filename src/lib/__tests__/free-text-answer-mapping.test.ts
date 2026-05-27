/**
 * Tests for free-text-answer-mapping.ts.
 *
 * Pins the Phase C / discovery loop fix where a free_text slot was
 * asked (e.g. business_location "Which city or region?"), the lead
 * replied with a short non-sentinel ("toronto"), and the engine had
 * no extraction path because the LLM's strict NULL rule returned
 * null on the bare reply.
 *
 * Field-detected 2026-05-27, DRG Messenger lead L-2026-05-27-R2X.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyFreeTextAnswerMapping } from '../free-text-answer-mapping';
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
    lead_id: 'L-TEST-FREE-TEXT',
    input: '',
    matter_type: 'business_setup_advisory',
    practice_area: 'corporate',
    intent_family: 'business_advisory',
    language: 'en',
    channel: 'facebook',
    slots: {},
    slot_meta: {},
    slot_evidence: {},
    submitted_at: new Date('2026-05-27T00:00:00Z').toISOString(),
    contactCaptureStarted: true,
    discoveryFollowUpCount: 10,
    ...overrides,
  } as EngineState;
}

function freeTextSlot(id: string, question: string): SlotDefinition {
  return {
    id,
    question,
    input_type: 'free_text',
    applies_to: ['business_setup_advisory'],
    tier: 'core',
    question_group: 'matter',
    abstraction_level: 'concrete',
    required: true,
    priority: 5,
    resolves: 'none',
    decision_value: 0,
  } as unknown as SlotDefinition;
}

function singleSelectSlot(id: string): SlotDefinition {
  return {
    id,
    question: 'pick one',
    input_type: 'single_select',
    options: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }],
    applies_to: ['business_setup_advisory'],
    tier: 'core',
    question_group: 'matter',
    abstraction_level: 'concrete',
    required: true,
    priority: 5,
    resolves: 'none',
    decision_value: 0,
  } as unknown as SlotDefinition;
}

beforeEach(() => {
  getNextStepMock.mockReset();
  applyAnswerMock.mockReset();
  // Default applyAnswer behaviour: return state with slot written.
  applyAnswerMock.mockImplementation((state, slotId, value) => ({
    ...state,
    slots: { ...state.slots, [slotId]: value },
  } as EngineState));
});

describe('applyFreeTextAnswerMapping — happy path', () => {
  it('fills the open free_text slot with the trimmed reply', () => {
    const slot = freeTextSlot('business_location', 'Which city or region will the business be based in?');
    getNextStepMock.mockReturnValue({ type: 'continue', slot } as ReturnType<typeof getNextStep>);

    const state = baseState();
    const result = applyFreeTextAnswerMapping('toronto', state);

    expect(applyAnswerMock).toHaveBeenCalledWith(state, 'business_location', 'toronto');
    expect(result.slots['business_location']).toBe('toronto');
  });

  it('trims whitespace from the reply', () => {
    const slot = freeTextSlot('business_location', 'q');
    getNextStepMock.mockReturnValue({ type: 'continue', slot } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('   toronto   \n', baseState());
    expect(applyAnswerMock).toHaveBeenCalledWith(expect.anything(), 'business_location', 'toronto');
  });

  it('works on deepen and recover next-step shapes too', () => {
    const slot = freeTextSlot('business_location', 'q');
    for (const type of ['deepen', 'recover'] as const) {
      applyAnswerMock.mockClear();
      getNextStepMock.mockReturnValue({ type, slot } as ReturnType<typeof getNextStep>);
      applyFreeTextAnswerMapping('toronto', baseState());
      expect(applyAnswerMock).toHaveBeenCalled();
    }
  });

  it('multi-word replies (city + province) fill the slot', () => {
    const slot = freeTextSlot('business_location', 'q');
    getNextStepMock.mockReturnValue({ type: 'continue', slot } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('Toronto, Ontario', baseState());
    expect(applyAnswerMock).toHaveBeenCalledWith(expect.anything(), 'business_location', 'Toronto, Ontario');
  });
});

describe('applyFreeTextAnswerMapping — no-op cases', () => {
  it('no-op when next-step slot is a contact slot (applyContactExtractionToState owns those)', () => {
    // Regression: with contactCaptureStarted=true, getNextStep returns
    // type='capture_contact' for the first missing contact slot. Without
    // this guard, an arbitrary user reply ("About $75k. Closing date is
    // next month.") would fill client_email with garbage. Field-detected
    // by the channel-intake-processor-closing tests on the first push.
    const contactSlot = {
      ...freeTextSlot('client_email', 'What email should the firm use?'),
      tier: 'contact',
    } as unknown as SlotDefinition;
    getNextStepMock.mockReturnValue({
      type: 'capture_contact',
      slot: contactSlot,
    } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('About $75k. Closing date is next month.', baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op when next-step slot is single_select (let numeric / fuzzy match handle)', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: singleSelectSlot('some_choice'),
    } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('toronto', baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op when next-step has no slot (stop / present_insight / capture_contact-without-slot)', () => {
    getNextStepMock.mockReturnValue({ type: 'stop' } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('toronto', baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op when slot is already filled (preserves prior answer)', () => {
    const slot = freeTextSlot('business_location', 'q');
    getNextStepMock.mockReturnValue({ type: 'continue', slot } as ReturnType<typeof getNextStep>);

    const state = baseState({ slots: { business_location: 'mississauga' } });
    applyFreeTextAnswerMapping('toronto', state);
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op on empty / whitespace-only reply', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: freeTextSlot('business_location', 'q'),
    } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('', baseState());
    applyFreeTextAnswerMapping('   \n  ', baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op on digit-only reply (let numeric mapping handle)', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: freeTextSlot('business_location', 'q'),
    } as ReturnType<typeof getNextStep>);

    for (const digit of ['1', '2', '5', '10', ' 3 ']) {
      applyAnswerMock.mockClear();
      applyFreeTextAnswerMapping(digit, baseState());
      expect(applyAnswerMock, `failed on '${digit}'`).not.toHaveBeenCalled();
    }
  });

  it('no-op on yes/no/dont-know sentinels (let fuzzy match handle)', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: freeTextSlot('business_location', 'q'),
    } as ReturnType<typeof getNextStep>);

    const sentinels = [
      'yes', 'yeah', 'yep', 'no', 'nope', 'nah',
      "i don't know", 'dont know', 'idk', 'not sure', 'unsure',
      'n/a', 'unknown', 'ok', 'sure',
    ];
    for (const s of sentinels) {
      applyAnswerMock.mockClear();
      applyFreeTextAnswerMapping(s, baseState());
      expect(applyAnswerMock, `failed on sentinel '${s}'`).not.toHaveBeenCalled();
    }
  });

  it('no-op on email-like reply (let contact extraction handle)', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: freeTextSlot('business_location', 'q'),
    } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('adriano@example.com', baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op on phone-like reply (let contact extraction handle)', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: freeTextSlot('business_location', 'q'),
    } as ReturnType<typeof getNextStep>);

    const phones = ['+16475559999', '647-555-9999', '(647) 555-9999', '647 555 9999', '+1 555 555 5555'];
    for (const p of phones) {
      applyAnswerMock.mockClear();
      applyFreeTextAnswerMapping(p, baseState());
      expect(applyAnswerMock, `failed on phone '${p}'`).not.toHaveBeenCalled();
    }
  });

  it('no-op on very long replies (paragraphs are matter descriptions, not slot answers)', () => {
    getNextStepMock.mockReturnValue({
      type: 'continue',
      slot: freeTextSlot('business_location', 'q'),
    } as ReturnType<typeof getNextStep>);

    const longReply = 'I want to start a business in toronto and we are planning to offer marketing services to small Canadian companies, focusing on legal and professional services.';
    applyFreeTextAnswerMapping(longReply, baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('no-op when getNextStep throws (engine error — graceful fallback)', () => {
    getNextStepMock.mockImplementation(() => { throw new Error('boom'); });

    const result = applyFreeTextAnswerMapping('toronto', baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
    // State is returned unchanged.
    expect(result.slots['business_location']).toBeUndefined();
  });

  it('handles non-string input gracefully', () => {
    const result = applyFreeTextAnswerMapping(null as unknown as string, baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});

describe('applyFreeTextAnswerMapping — order with other adapters', () => {
  it('a digit reply is not consumed here even when slot is free_text — numeric mapping owns digits', () => {
    // Defensive: if some future caller wires this BEFORE numeric mapping
    // by accident, we still bail on digits so the more-specific mapper
    // wins.
    const slot = freeTextSlot('business_location', 'q');
    getNextStepMock.mockReturnValue({ type: 'continue', slot } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('5', baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });

  it('a sentinel reply is not consumed here even when slot is free_text — fuzzy match owns sentinels', () => {
    const slot = freeTextSlot('business_location', 'q');
    getNextStepMock.mockReturnValue({ type: 'continue', slot } as ReturnType<typeof getNextStep>);

    applyFreeTextAnswerMapping('yes', baseState());
    expect(applyAnswerMock).not.toHaveBeenCalled();
  });
});
