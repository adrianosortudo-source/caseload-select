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
        questions: [
          { slot_id: 'dispute_reason', status: 'missing', quote: 'disagree about whether the agreement was signed' },
          { slot_id: 'amount_at_stake', status: 'missing', quote: 'disagree about whether the agreement was signed' },
        ],
      },
    };
    const state = opening(input, 'contract_dispute', reading);
    expect(questionPermitted(state, getSlotById('dispute_reason')!)).toBe(false);
    expect(questionPermitted(state, getSlotById('amount_at_stake')!)).toBe(false);
    expect(getNextStep(state).slot?.id).not.toBe('dispute_reason');
    expect(buildReport(state).best_next_question).not.toMatch(/paying|not paid|owe/iu);
    expect(opening(input, 'contract_dispute', reading, false).intake_reading?.questionReview).toBeUndefined();
    expect(pendingIntakeQuestion(opening(input, 'contract_dispute', reading, false))?.id).toBe('dispute_reason');
  });

  it('permits a material financial question when a financial stake is mentioned without asserting a debt', () => {
    const input = 'The deposit might be at risk. I need to discuss our contract terms.';
    const state = opening(input, 'contract_dispute', {
      next_slot: 'amount_at_stake',
      question_review: {
        requests: [{ quote: 'I need to discuss our contract terms.', matter: 'contract_dispute' }],
        priority_quote: null,
        questions: [
          { slot_id: 'dispute_reason', status: 'missing', quote: 'The deposit might be at risk.' },
          { slot_id: 'amount_at_stake', status: 'missing', quote: 'The deposit might be at risk.' },
        ],
      },
    });
    expect(questionPermitted(state, getSlotById('dispute_reason')!)).toBe(false);
    expect(questionPermitted(state, getSlotById('amount_at_stake')!)).toBe(true);
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

  it('uses a grounded outcome question when a proposed company setup question is already covered', () => {
    const input = 'I fix bikes under my own name. I want customers to hire a company instead of me personally.';
    const nextQuestion = 'What would you like the company to handle or change about how you work with customers?';
    const basis = 'I want customers to hire a company instead of me personally.';
    const state = opening(input, 'business_setup_advisory', {
      next_slot: 'setup_needs',
      next_question: nextQuestion,
      question_review: { requests: [{ quote: basis, matter: 'business_setup_advisory' }], priority_quote: null,
        custom_basis_quote: basis, questions: [{ slot_id: 'setup_needs', status: 'answered', quote: basis }] },
    });
    expect(getNextStep(state).slot?.question).toBe(nextQuestion);
  });

  it('applies the same progressive routing prerequisites to a model-selected menu as a local fallback', () => {
    const input = 'It is between me and someone I work with. Something changed.';
    const candidate: Partial<IntakeInterpretation> = {
      next_slot: 'corporate_internal_problem_type',
      next_question: 'What would you like to change about how you work with this person?',
      question_review: { requests: [], priority_quote: null, custom_basis_quote: input,
        questions: [{ slot_id: 'corporate_internal_problem_type', status: 'missing', quote: 'someone I work with' }] },
    };
    const state = opening(input, 'corporate_general', candidate);
    expect(pendingIntakeQuestion(state)).toBeUndefined();
    expect(getNextStep(state).slot?.id).toBe('written_goal');
    expect(pendingIntakeQuestion(opening(input, 'corporate_general', candidate, false))?.id).toBe('corporate_internal_problem_type');
  });

  it('does not re-ask a generic date after an accepted deadline and still asks when timing is tentative', () => {
    const request = 'I need help reviewing my severance offer.';
    const deadline = 'My response is due by Thursday.';
    const reading = (quote: string): Partial<IntakeInterpretation> => ({
      question_review: { requests: [{ quote: request, matter: 'severance_review' }], priority_quote: null,
        questions: [{ slot_id: 'severance_deadline', status: 'answered', quote }] },
    });
    const resolved = opening(`${request} ${deadline}`, 'severance_review', reading('by Thursday'));
    expect(getNextStep(resolved).slot?.id).not.toBe('written_timing');
    const unclear = opening(`${request} It might be due by Thursday.`, 'severance_review', reading('by Thursday'));
    expect(getNextStep(unclear).slot?.id).toBe('written_timing');
  });

  it('keeps identifying details in the dedicated contact screen and tolerates references to ways notices arrived', () => {
    const familyInput = 'I need some help with my brother. It is sensitive and I’m not ready to describe it yet.';
    const initial: EngineState = { ...initialiseState(familyInput), matter_type: 'family_general',
      practice_area: 'family', family_enabled: true, question_policy: 'grounded_v1' };
    const reading: IntakeInterpretation = { ...base, matter: 'family_general',
      next_question: 'Could you share your name and the best phone number or email for the firm to reach you?', question_review: {
        requests: [{ quote: 'I need some help with my brother.', matter: 'family_general' }], priority_quote: null,
        custom_basis_quote: 'It is sensitive and I’m not ready to describe it yet.', questions: [],
      } };
    const state = applyIntakeInterpretation(initial, reading, familyInput);
    expect(pendingIntakeQuestion(state)).toBeUndefined();
    expect(getNextStep(state).slot?.id).toBe('written_timing');
    for (const question of ['What is the other party’s legal name?', 'Can you provide your mailing address?', 'What is their email?']) {
      const adverse = applyIntakeInterpretation(initial, { ...reading, next_question: question }, familyInput);
      expect(pendingIntakeQuestion(adverse)).toBeUndefined();
    }
    const notice = opening('I need help with a notice about our agreement.', 'contract_dispute', {
      next_question: 'Did you receive the notice by email?', question_review: {
        requests: [{ quote: 'I need help with a notice about our agreement.', matter: 'contract_dispute' }],
        priority_quote: null, custom_basis_quote: 'a notice about our agreement', questions: [],
      },
    });
    expect(getNextStep(notice).slot?.question).toBe('Did you receive the notice by email?');
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
