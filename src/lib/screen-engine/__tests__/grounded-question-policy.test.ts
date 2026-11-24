import { describe, expect, it } from 'vitest';
import { applyAnswer, getNextStep } from '../control';
import { initialiseState, classificationForMatterType } from '../extractor';
import { applyIntakeInterpretation, pendingIntakeQuestion, type IntakeInterpretation } from '../interpretation';
import { groundedCoverage, priorityPending, questionPermitted } from '../question-policy';
import { buildReport } from '../report';
import { getSlotById } from '../slotRegistry';
import type { EngineState, MatterType } from '../types';

const base: IntakeInterpretation = {
  matter: 'unknown',
  answers_question: false,
  superseded_quote: null,
  current_excerpts: [],
  unsupported_slots: [],
  covered_questions: [],
  next_slot: null,
  next_question: null,
};

function opening(input: string, matter: MatterType, reading: Partial<IntakeInterpretation>, enable = true): EngineState {
  const state: EngineState = {
    ...initialiseState(input),
    ...classificationForMatterType(matter),
    ...(enable ? { question_policy: 'grounded_v1' } : {}),
  };
  return applyIntakeInterpretation(state, { ...base, matter, ...reading }, input);
}

describe('shared grounded question policy', () => {
  it('rejects a nonpayment question without evidence for nonpayment and preserves the prior protocol', () => {
    const input = 'The parties disagree about whether the agreement was signed.';
    const reading: Partial<IntakeInterpretation> = {
      next_slot: 'dispute_reason',
      next_question: 'Why are they not paying?',
      question_review: {
        requests: [{ quote: 'whether the agreement was signed', matter: 'contract_dispute' }],
        priority_quote: null,
        questions: [{ slot_id: 'dispute_reason', status: 'missing', quote: 'disagree about whether the agreement was signed' }],
      },
    };
    const state = opening(input, 'contract_dispute', reading);
    expect(questionPermitted(state, getSlotById('dispute_reason')!)).toBe(false);
    expect(getNextStep(state).slot?.id).not.toBe('dispute_reason');
    expect(buildReport(state).best_next_question).not.toMatch(/paying|not paid|owe/iu);
    expect(opening(input, 'contract_dispute', reading, false).intake_reading?.questionReview).toBeUndefined();
    expect(pendingIntakeQuestion(opening(input, 'contract_dispute', reading, false))?.id).toBe('dispute_reason');
  });

  it('permits a relevant underpayment question when evidence supports it', () => {
    const input = 'A customer has not paid the outstanding balance. I need help collecting it.';
    const state = opening(input, 'unpaid_invoice', {
      next_slot: 'dispute_reason',
      question_review: {
        requests: [{ quote: 'I need help collecting it.', matter: 'unpaid_invoice' }],
        priority_quote: null,
        questions: [{ slot_id: 'dispute_reason', status: 'missing', quote: 'A customer has not paid the outstanding balance.' }],
      },
    });
    expect(getNextStep(state).slot?.id).toBe('dispute_reason');
    const skipped = applyAnswer(state, 'dispute_reason', 'Not sure');
    expect(getNextStep(skipped).slot?.id).not.toBe('dispute_reason');
    expect(buildReport(skipped).best_next_question).not.toContain('why they are not paying');
  });

  it('checks attribution omitted from a clipped premise citation', () => {
    const input = 'I heard the customer has not paid. I want to know if the service agreement covers my business.';
    const state = opening(input, 'contract_dispute', {
      next_slot: 'dispute_reason',
      question_review: {
        requests: [{ quote: 'if the service agreement covers my business', matter: 'contract_dispute' }],
        priority_quote: null,
        questions: [{ slot_id: 'dispute_reason', status: 'missing', quote: 'the customer has not paid' }],
      },
    });
    expect(questionPermitted(state, getSlotById('dispute_reason')!)).toBe(false);
    expect(pendingIntakeQuestion(state)).toBeUndefined();
  });

  it('asks which distinct request to address first and finishes without arbitrarily choosing on skip', () => {
    const input = 'We need a lease review and a contract for our new manager. I am unsure which comes first.';
    const requests = [
      { quote: 'lease review', matter: 'commercial_real_estate' },
      { quote: 'contract for our new manager', matter: 'employment_contract_review' },
    ] as const;
    const next = opening(input, 'commercial_real_estate', {
      next_slot: 'commercial_re_role',
      question_review: { requests: [...requests], priority_quote: 'I am unsure which comes first.',
        preferred_request_quote: requests[0].quote, questions: [{ slot_id: 'commercial_re_role', status: 'missing', quote: 'lease review' }] },
    });
    expect(priorityPending(next)).toBe(true);
    expect(next.intake_reading?.questionReview?.requests).toEqual(requests);
    expect(getNextStep(next).slot?.id).toBe('written_goal');
    expect(buildReport(next).matter_snapshot).toContain(input);
    expect(buildReport(next)).toMatchObject({
      routing_review_required: true, intake_only: true,
      likely_legal_services: [],
      best_next_question: 'Which request would you like the firm to address first?',
    });
    const skipped = applyAnswer(next, 'written_goal', 'Not sure');
    expect(getNextStep(skipped).type).toBe('present_insight');
    expect(priorityPending(skipped)).toBe(true);
    expect(skipped.intake_reading?.questionReview?.requests).toEqual(requests);

    const text = 'The contract comes first.';
    const typed = applyAnswer(next, 'written_goal', text);
    const selected = applyIntakeInterpretation(typed, { ...base, answers_question: true, matter: 'employment_contract_review',
      next_slot: 'contract_review_timeline', question_review: {
        requests: [...requests], priority_quote: text, preferred_request_quote: 'new manager',
        questions: [{ slot_id: 'contract_review_timeline', status: 'missing', quote: requests[1].quote }],
      },
    }, text, 'written_goal');
    expect(selected.matter_type).toBe('employment_contract_review');
    expect(priorityPending(selected)).toBe(false);
    expect(selected.intake_reading?.questionReview?.requests).toEqual(requests);
    expect(getNextStep(selected).slot?.id).toBe('contract_review_timeline');
    expect(buildReport(selected).matter_snapshot).toContain(text);
    expect(buildReport(selected).routing_review_required).toBeUndefined();
  });

  it('retains separately requested work within one matter pack even if no unique choice can be inferred', () => {
    const input = 'I need an employment contract for the manager and an employment contract for a designer.';
    const requests: [{ quote: string; matter: MatterType }, { quote: string; matter: MatterType }] = [
      { quote: 'an employment contract for the manager', matter: 'employment_contract_review' },
      { quote: 'an employment contract for a designer', matter: 'employment_contract_review' },
    ];
    const state = opening(input, 'employment_contract_review', {
      question_review: { requests, priority_quote: null, questions: [] },
    });
    const text = 'The contract first.';
    const next = applyIntakeInterpretation(applyAnswer(state, 'written_goal', text),
      { ...base, question_review: { requests, priority_quote: text, questions: [] } }, text, 'written_goal');
    expect(priorityPending(next)).toBe(true);
    expect(next.intake_reading?.questionReview?.requests).toEqual(requests);
    const resolved = applyIntakeInterpretation(applyAnswer(state, 'written_goal', 'Designer first.'),
      { ...base, question_review: { requests, priority_quote: 'Designer first.', questions: [] } }, 'Designer first.', 'written_goal');
    expect(priorityPending(resolved)).toBe(false);
    expect(resolved.intake_reading?.questionReview?.priority?.quote).toBe(requests[1].quote);
    expect(resolved.intake_reading?.questionReview?.requests).toEqual(requests);
  });

  it('recognises current facts even when a model omits them and never fills a scored enum', () => {
    const input = 'I have a will from 2017. I want to update it since my twins were born. My spouse and I both live in Ontario.';
    const state = opening(input, 'will_drafting', {
      next_slot: 'existing_will_status',
      next_question: 'Do you currently have a will?',
      question_review: {
        requests: [{ quote: 'I want to update it since my twins were born.', matter: 'will_drafting' }],
        priority_quote: null,
        questions: [
          { slot_id: 'existing_will_status', status: 'missing', quote: 'I have a will from 2017.' },
          { slot_id: 'desired_outcome_will_drafting', status: 'missing', quote: 'I want to update it since my twins were born.' },
        ],
      },
    });
    for (const id of ['existing_will_status', 'children_count', 'marital_status']) {
      expect(groundedCoverage(state, getSlotById(id)!)).toBeTruthy();
      expect(state.slots[id]).toBeFalsy();
    }
    expect(getNextStep(state).slot?.id).toBe('desired_outcome_will_drafting');
    expect(buildReport(state).matter_snapshot).toContain(input);
  });

  it('withholds unsupported review when a citation is invented or spans two replies', () => {
    const input = 'The manager says one thing. The written notice says another.';
    const state = opening(input, 'wrongful_dismissal', {
      next_slot: 'dismissal_reason_given',
      next_question: 'What reason were you given for dismissal?',
      question_review: {
        requests: [],
        priority_quote: null,
        questions: [{ slot_id: 'dismissal_reason_given', status: 'missing', quote: 'I was fired yesterday.' }],
      },
    });
    expect(pendingIntakeQuestion(state)).toBeUndefined();
    expect(getNextStep(state).slot?.id).toBe('written_goal');
    expect(state.intake_reading?.questionReview?.grades).toEqual({});
  });
});
