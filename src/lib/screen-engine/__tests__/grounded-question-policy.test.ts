import { describe, expect, it } from 'vitest';
import { applyAnswer, getNextStep } from '../control';
import { initialiseState, classificationForMatterType, applySelectedPracticeAreaForReview } from '../extractor';
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
  it.each(['contract_dispute', 'wrongful_dismissal', 'residential_purchase_sale', 'will_drafting'] as const)(
    'leaves inferred services, fees and risk analysis for lawyer review in %s', matter => {
      const input = 'I need advice about a document I received.';
      const reading: Partial<IntakeInterpretation> = { question_review: {
        requests: [{ quote: input, matter }], priority_quote: null, questions: [],
      } };
      const report = buildReport(opening(input, matter, reading));
      expect(report.likely_legal_services).toEqual([]);
      expect(report.fee_estimate).toBe('Not assessed');
      expect(report.risk_flags).toEqual([]);
      expect(report.strategic_considerations).toEqual([]);
      expect(report.cross_sell_opportunities).toEqual([]);
      expect(report.call_openers).toEqual([]);
      expect(buildReport(opening(input, matter, reading, false)).likely_legal_services.length).toBeGreaterThan(0);
    },
  );
  it('records Skip separately from a chosen uncertainty and retains the question context', () => {
    const input = 'I need advice on my agreement. I said it was signed.';
    const request = 'I need advice on my agreement.';
    const state = opening(input, 'contract_dispute', { question_review: {
      requests: [{ quote: request, matter: 'contract_dispute' }], priority_quote: null, questions: [],
    } });
    const reply = 'Not sure';
    const reading: IntakeInterpretation = { ...base, superseded_quote: 'I said it was signed.',
      current_excerpts: [request, reply], question_review: {
        requests: [{ quote: request, matter: 'contract_dispute' }], priority_quote: null, questions: [],
      },
    };
    const skipped = applyIntakeInterpretation(state, reading, reply, 'written_goal', 'Was it signed?', true);
    const uncertain = applyIntakeInterpretation(state, reading, reply, 'written_goal', 'Was it signed?', false);
    expect(skipped.intake_reading?.turns[0].skipped).toBe(true);
    expect(skipped.intake_reading?.turns[0].correction).toBe(false);
    expect(buildReport(skipped).matter_snapshot).not.toContain('Not sure');
    expect(uncertain.intake_reading?.turns[0].skipped).toBe(false);
    expect(uncertain.intake_reading?.turns[0].correction).toBe(true);
    expect(buildReport(uncertain).matter_snapshot).toContain('Was it signed?');
    expect(buildReport(uncertain).matter_snapshot).toContain('Not sure');
  });

  it('does not erase prior answers or report Skip as a visitor statement', () => {
    const input = 'Please review my agreement.';
    const request = { quote: input, matter: 'contract_dispute' as const };
    const state = opening(input, 'contract_dispute', { question_review: { requests: [request], priority_quote: null, questions: [] } });
    const prior = { ...state, slots: { ...state.slots, written_timing: 'Not sure' },
      slot_meta: { ...state.slot_meta, written_timing: { source: 'answered' as const, confidence: 1 } },
      written_answers: { written_timing: 'Not sure' } };
    const next = applyIntakeInterpretation(prior, { ...base, unsupported_slots: ['written_timing'],
      question_review: { requests: [request], priority_quote: null, questions: [] },
    }, 'Not sure', 'written_timing', 'When is the deadline?', true);
    expect(next.slots.written_timing).toBe('Not sure');
    expect(next.written_answers?.written_timing).toBe('Not sure');
    const values = Object.values(buildReport(next).resolved_facts);
    expect(values.filter(value => value === 'Not sure')).toHaveLength(1);
  });
  it('refreshes a grounded current account without an explicit superseded field', () => {
    const input = 'I need advice about my lease. I am unsure whether it is signed.';
    const request = 'I need advice about my lease.';
    const state = opening(input, 'landlord_tenant', { question_review: {
      requests: [{ quote: request, matter: 'landlord_tenant' }], priority_quote: null, questions: [],
    } });
    const reply = 'I checked and I signed it last week.';
    const next = applyIntakeInterpretation(state, { ...base, matter: 'landlord_tenant',
      current_excerpts: [request, reply], question_review: {
        requests: [{ quote: request, matter: 'landlord_tenant' }], priority_quote: null, questions: [],
      },
    }, reply, 'written_goal', 'Can you clarify?');
    expect(buildReport(next).matter_snapshot).toContain(reply);
    expect(buildReport(next).matter_snapshot).not.toContain('unsure whether');
    expect(JSON.stringify(buildReport(next).resolved_facts)).toContain(input);
  });

  it('keeps the prior account when the model omits an unresolved request', () => {
    const input = 'I need advice about my lease. I am unsure whether it is signed.';
    const request = 'I need advice about my lease.';
    const state = opening(input, 'landlord_tenant', { question_review: {
      requests: [{ quote: request, matter: 'landlord_tenant' }], priority_quote: null, questions: [],
    } });
    const reply = 'I checked and I signed it last week.';
    const next = applyIntakeInterpretation(state, { ...base, current_excerpts: [reply],
      question_review: { requests: [], priority_quote: null, questions: [] },
    }, reply, 'written_goal');
    expect(buildReport(next).matter_snapshot).toContain(input);
    expect(buildReport(next).matter_snapshot).toContain(reply);
    expect(next.intake_reading?.questionReview?.requests).toHaveLength(1);
  });

  it('keeps a withdrawn request inactive across turns until the visitor explicitly restores it', () => {
    const input = 'Please review the purchase contract and advise on my will.';
    const contract = 'review the purchase contract';
    const will = 'advise on my will';
    const requests = [{ quote: contract, matter: 'contract_dispute' as const }, { quote: will, matter: 'will_drafting' as const }];
    const state = opening(input, 'contract_dispute', { question_review: { requests, priority_quote: null, questions: [] } });
    const resolution = 'The contract review is finished.';
    const closed = applyIntakeInterpretation(state, { ...base, question_review: { requests: [requests[1]], priority_quote: null, questions: [],
      withdrawn_requests: [{ request_quote: contract, request_matter: 'contract_dispute', withdrawal_quote: resolution }] } }, resolution, 'written_goal');
    const detail = 'The appointment is Tuesday.';
    const later = applyIntakeInterpretation(closed, { ...base, question_review: { requests, priority_quote: null, questions: [] } }, detail, 'written_timing');
    expect(later.intake_reading?.questionReview?.requests.map(item => item.quote)).toEqual([will]);
    const returnToContract = 'I need the contract reviewed again.';
    const restored = applyIntakeInterpretation(later, { ...base, question_review: { requests, priority_quote: null, questions: [],
      reactivated_requests: [{ request_quote: contract, request_matter: 'contract_dispute', reactivation_quote: returnToContract }] } }, returnToContract, 'written_goal');
    expect(restored.intake_reading?.questionReview?.requests.map(item => item.quote)).toContain(contract);
  });
  it('withdraws only the explicitly resolved request and keeps the other work and history', () => {
    const input = 'Please review the purchase contract and advise on my will.';
    const contract = 'review the purchase contract';
    const will = 'advise on my will';
    const requests = [{ quote: contract, matter: 'contract_dispute' as const }, { quote: will, matter: 'will_drafting' as const }];
    const state = opening(input, 'contract_dispute', { question_review: { requests, priority_quote: null, questions: [] } });
    const reply = 'The contract review is finished. I still need advice on my will.';
    const next = applyIntakeInterpretation(state, { ...base, matter: 'will_drafting', question_review: {
      requests: [requests[1]], priority_quote: null, questions: [],
      withdrawn_requests: [{ request_quote: contract, request_matter: 'contract_dispute', withdrawal_quote: 'The contract review is finished.' }],
    } }, reply, 'written_goal', 'Which request comes first?');
    expect(next.intake_reading?.questionReview?.requests.map(request => request.quote)).toEqual([will]);
    const facts = JSON.stringify(buildReport(next).resolved_facts);
    expect(facts).toContain(input);
    expect(facts).toContain(reply);
  });

  it('does not withdraw background or requests based on an uncited or unrelated correction', () => {
    const input = 'Please review the purchase contract and advise on my will. The appointment is Monday.';
    const requests = [{ quote: 'review the purchase contract', matter: 'contract_dispute' as const },
      { quote: 'advise on my will', matter: 'will_drafting' as const }];
    const state = opening(input, 'contract_dispute', { question_review: { requests, priority_quote: null, questions: [] } });
    const reply = 'The appointment is Tuesday.';
    const next = applyIntakeInterpretation(state, { ...base, superseded_quote: 'The appointment is Monday.',
      current_excerpts: ['Please review the purchase contract and advise on my will.', reply], question_review: {
        requests, priority_quote: null, questions: [],
        withdrawn_requests: [{ request_quote: requests[0].quote, request_matter: 'contract_dispute', withdrawal_quote: 'The contract is finished.' }],
      },
    }, reply, 'written_timing', 'When is the appointment?');
    expect(next.intake_reading?.questionReview?.requests).toHaveLength(2);
    expect(buildReport(next).matter_snapshot).toContain(reply);
  });

  it('keeps the other matter when separate requests share the same citation', () => {
    const input = 'I need help with both the will and the apartment lease.';
    const requests = [{ quote: input, matter: 'will_drafting' as const }, { quote: input, matter: 'landlord_tenant' as const }];
    const state = opening(input, 'will_drafting', { question_review: { requests, priority_quote: null, questions: [] } });
    const reply = 'The will issue is settled, but I still need help with the lease.';
    const next = applyIntakeInterpretation(state, { ...base, matter: 'landlord_tenant', question_review: {
      requests: [requests[1]], priority_quote: null, questions: [],
      withdrawn_requests: [{ request_quote: input, request_matter: 'will_drafting', withdrawal_quote: 'The will issue is settled' }],
    } }, reply, 'written_goal');
    expect(next.intake_reading?.questionReview?.requests).toEqual([requests[1]]);
    expect(JSON.stringify(buildReport(next).resolved_facts)).toContain(input);
  });
  it('keeps prior corrections and omits a bare skip from the headline', () => {
    const input = 'I need a contract reviewed. The appointment is Monday.';
    const state = opening(input, 'contract_dispute', { question_review: {
      requests: [{ quote: 'I need a contract reviewed.', matter: 'contract_dispute' }], priority_quote: null, questions: [],
    } });
    const first = applyIntakeInterpretation(state, { ...base, superseded_quote: 'The appointment is Monday.',
      current_excerpts: ['I need a contract reviewed.', 'The appointment is Thursday.'],
      question_review: { requests: [{ quote: 'I need a contract reviewed.', matter: 'contract_dispute' }], priority_quote: null, questions: [] },
    }, 'The appointment is Thursday.', 'written_timing');
    const skipped = applyIntakeInterpretation(first, { ...base, superseded_quote: 'The appointment is Thursday.',
      current_excerpts: ['I need a contract reviewed.', 'Not sure'],
      question_review: { requests: [{ quote: 'I need a contract reviewed.', matter: 'contract_dispute' }], priority_quote: null, questions: [] },
    }, 'Not sure', 'written_goal', 'What outcome do you want?');
    expect(skipped.intake_reading?.currentAccount).toContain('The appointment is Thursday.');
    expect(buildReport(skipped).matter_snapshot).toContain('The appointment is Thursday.');
    expect(buildReport(skipped).matter_snapshot).not.toContain('Not sure');
    const older = { ...skipped, intake_reading: { ...skipped.intake_reading!, currentAccount: 'I need a contract reviewed.\nI am not sure whether it was signed.\nNot sure' } };
    expect(buildReport(older).matter_snapshot).toContain('I am not sure whether it was signed.');
    expect(buildReport(older).matter_snapshot).not.toContain('\nNot sure');
  });
  it('suppresses an equivalent question after an uncertain reply without inventing an answer', () => {
    const input = 'I want help reviewing a proposed agreement.';
    const initial = opening(input, 'contract_dispute', { question_review: {
      requests: [{ quote: input, matter: 'contract_dispute' }], priority_quote: null, questions: [],
    } });
    const skipped = applyAnswer(initial, 'written_timing', 'Not sure');
    const next = applyIntakeInterpretation(skipped, { ...base, matter: 'contract_dispute',
      next_slot: 'contract_review_timeline', next_question: 'When would you like this reviewed?',
      question_review: { requests: [{ quote: input, matter: 'contract_dispute' }], priority_quote: null,
        next_is_repeat: true, questions: [{ slot_id: 'contract_review_timeline', status: 'already_asked', quote: 'Not sure' }] },
    }, 'Not sure', 'written_timing', 'When do you need an answer?');
    expect(questionPermitted(next, getSlotById('contract_review_timeline')!)).toBe(false);
    expect(pendingIntakeQuestion(next)).toBeUndefined();
    expect(next.slots.contract_review_timeline).toBeUndefined();
  });

  it('does not fall back to a proposed repeat when its catalogue grade conflicts', () => {
    const input = 'I want help reviewing an agreement.';
    const state = opening(input, 'contract_dispute', { question_review: {
      requests: [{ quote: input, matter: 'contract_dispute' }], priority_quote: null, questions: [],
    } });
    const skipped = applyAnswer(state, 'written_timing', 'Not sure');
    const next = applyIntakeInterpretation(skipped, { ...base, matter: 'contract_dispute',
      next_slot: 'contract_review_timeline', next_question: 'When would you like this reviewed?',
      question_review: { requests: [{ quote: input, matter: 'contract_dispute' }], priority_quote: null,
        next_is_repeat: true, questions: [{ slot_id: 'contract_review_timeline', status: 'missing', quote: input }] },
    }, 'Not sure', 'written_timing', 'When do you need an answer?');
    expect(questionPermitted(next, getSlotById('contract_review_timeline')!)).toBe(false);
    expect(getNextStep(next).slot?.id).not.toBe('contract_review_timeline');
  });

  it('merges an explicitly linked duplicate while retaining an unlinked second request', () => {
    const input = 'Please review the agreement and also advise on the building lease.';
    const first = 'review the agreement';
    const overlap = 'Please review the agreement';
    const second = 'advise on the building lease';
    const state = opening(input, 'corporate_general', { question_review: {
      requests: [{ quote: first, matter: 'corporate_general' },
        { quote: overlap, matter: 'contract_dispute', same_as_quote: first },
        { quote: second, matter: 'commercial_real_estate' }], priority_quote: null, questions: [],
    } });
    expect(state.intake_reading?.questionReview?.requests.map(request => request.quote)).toEqual([first, second]);
    expect(priorityPending(state)).toBe(true);
  });
  it('keeps the current account as the brief headline when a visitor skips a follow-up', () => {
    const input = 'I need advice about a supplier contract that ends next month.';
    const state = opening(input, 'contract_dispute', { question_review: {
      requests: [{ quote: 'advice about a supplier contract', matter: 'contract_dispute' }], priority_quote: null, questions: [],
    } });
    const answered = applyAnswer(state, 'written_timing', 'Not sure');
    const next = applyIntakeInterpretation(answered, { ...base, question_review: {
      requests: [{ quote: 'advice about a supplier contract', matter: 'contract_dispute' }], priority_quote: null, questions: [],
    } }, 'Not sure', 'written_timing', 'When do you need advice?');
    expect(buildReport(next).matter_snapshot).toContain(input);
    expect(buildReport(next).matter_snapshot).not.toContain('Not sure');
  });

  it('avoids repeating identical request citations already present in the account', () => {
    const input = 'Please help me with the employment offer and the property agreement.';
    const requests = [{ quote: input, matter: 'employment_general' as const }, { quote: input, matter: 'real_estate_general' as const }];
    const state = opening(input, 'employment_general', { question_review: { requests, priority_quote: null, questions: [] } });
    const next = applyIntakeInterpretation(applyAnswer(state, 'written_goal', 'Not sure'), {
      ...base, question_review: { requests, priority_quote: null, questions: [] },
    }, 'Not sure', 'written_goal', 'Which should be addressed first?');
    expect(next.intake_reading?.questionReview?.requests).toHaveLength(2);
    const facts = buildReport(next).resolved_facts;
    expect(Object.values(facts).filter(value => value === input)).toHaveLength(1);
  });
  it('uses the selected practice area when the opening classifier follows an unrelated word', () => {
    const state = initialiseState('The company ended my role after seven years. They want a response to the offer next Friday.');
    const selected = applySelectedPracticeAreaForReview(state, 'employment');
    expect(selected.practice_area).toBe('employment');
    expect(selected.matter_type).toBe('employment_general');
  });

  it('retains separately identified matters in one citation after a factual correction and an uncertain priority', () => {
    const input = 'I need help with both my parenting arrangements and my business buyout. The deadline is Monday.';
    const citation = 'I need help with both my parenting arrangements and my business buyout.';
    const requests = [{ quote: citation, matter: 'family_general' as const }, { quote: citation, matter: 'corporate_general' as const }];
    const state = opening(input, 'family_general', { question_review: { requests, priority_quote: null, questions: [] } });
    expect(state.intake_reading?.questionReview?.requests).toHaveLength(2);
    const reply = 'The deadline is Tuesday, not Monday.';
    const corrected = applyIntakeInterpretation(state, { ...base, answers_question: true,
      superseded_quote: 'The deadline is Monday.', current_excerpts: [citation, reply],
      question_review: { requests: [], priority_quote: null, questions: [] },
    }, reply, 'written_timing', 'When is the deadline?');
    expect(corrected.intake_reading?.questionReview?.requests).toHaveLength(2);
    expect(priorityPending(corrected)).toBe(true);
    expect(JSON.stringify(buildReport(corrected))).toContain(citation);
    expect(JSON.stringify(buildReport(corrected))).toContain(reply);
  });
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
