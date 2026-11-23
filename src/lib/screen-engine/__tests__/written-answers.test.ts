import { describe, expect, it } from 'vitest';
import { applyAnswer, applyWrittenAnswer, getNextStep } from '../control';
import { classificationForMatterType, initialiseState } from '../extractor';
import { buildReport } from '../report';
import type { MatterType } from '../types';
import { selectNextSlot } from '../selector';

const areas = [
  ['corporate_general', 'corporate_help_category'],
  ['real_estate_general', 'real_estate_problem_type'],
  ['employment_general', 'employment_problem_type'],
  ['estates_general', 'estates_problem_type'],
  ['family_general', 'family_help_sought'],
] as const;

function start(matter: MatterType) {
  return { ...initialiseState('I would like to speak to the firm.'), ...classificationForMatterType(matter) };
}

describe.each(areas)('Written answers in %s', (matter, question) => {
  it.each([
    ['I have drafted an agreement for the lawyer to review.', 'written_timing'],
    ['They want me to sign something by Friday.', 'written_document'],
  ])('chooses the next question from the answer and quotes it in the brief: %s', (answer, next) => {
    const initial = start(matter);
    const state = applyWrittenAnswer(initial, question, answer);
    expect(getNextStep(state).slot?.id).toBe(next);
    const completed = applyAnswer(state, next, next === 'written_document' ? 'A release.' : 'Next Tuesday.');
    expect(getNextStep(completed).slot?.id).not.toBe(next);
    expect(completed.input).toBe(initial.input);
    const report = buildReport(completed);
    expect(report.resolved_facts_v2.filter(f => f.value === answer)).toEqual([
      expect.objectContaining({ source: 'explicit_from_caller', label: expect.not.stringContaining('_') }),
    ]);
    expect(Object.values(report.resolved_facts)).toContain(answer);
    expect(report.resolved_facts_v2.some(f => f.value === completed.slots[next])).toBe(true);
  });
  it('does not credit an uncertain response as a qualification, or repeat the same menu', () => {
    const state = applyWrittenAnswer(start(matter), question, 'I am not sure.');
    expect(state.slots[question]).toBeUndefined();
    expect(getNextStep(state).slot?.id).not.toBe(question);
    expect(buildReport(state).resolved_facts_v2).toContainEqual(expect.objectContaining({value:'I am not sure.'}));
  });
});

it('uses the opening and later reply together', () => {
  let state = initialiseState('I was let go yesterday. They want me to sign something by Friday.');
  expect(getNextStep(state).slot?.id).toBe('written_document');
  state = applyWrittenAnswer(state, 'written_document', 'A release agreement.');
  expect(getNextStep(state).slot?.id).not.toBe('written_timing');
  expect(buildReport(state).resolved_facts).toMatchObject({ 'Document to sign or review': 'A release agreement.' });
});
it('clarifies a stated goal across the initial enquiry and the next turn', () => {
  let state = initialiseState('I started my small business and I need to formalize it to hire my first employee.');
  expect(getNextStep(state).slot?.id).toBe('written_goal');
  state = applyAnswer(state, 'written_goal', 'My company is registered. I drafted an offer and want it reviewed.');
  expect(getNextStep(state).slot?.id).toBe('written_timing');
  state = applyAnswer(state, 'written_timing', 'Friday.');
  expect(getNextStep(state).slot?.id).not.toBe('corporate_help_category');
});
it('refines an initial or general matter through an existing practice-area pack', () => {
  let state = applyWrittenAnswer(start('employment_general'), 'employment_problem_type', 'My employer owes me unpaid overtime and wages.');
  expect(state.matter_type).toBe('wage_recovery');
  expect(getNextStep(state).slot?.id).toBe('wages_type');
  state = applyWrittenAnswer(initialiseState('Can we talk?'), '__clarify__', 'I need to make a will.');
  expect(state.matter_type).toBe('will_drafting');
  expect(buildReport(state).resolved_facts).toMatchObject({ 'Enquiry clarification': 'I need to make a will.' });
});
it('retains the person’s wording independently of the validated menu value', () => {
  const state = applyWrittenAnswer(start('family_general'), 'family_children', 'Our twins are part of it.', 'Yes');
  expect(state.slots.family_children).toBe('Yes');
  const changed = applyWrittenAnswer(state, 'family_children', 'Actually, the children are not involved.', 'No');
  expect(changed.slots.family_children).toBe('No');
  const reported = Object.values(buildReport(changed).resolved_facts);
  expect(reported).toContain('Actually, the children are not involved.');
  expect(reported).not.toContain('Our twins are part of it.');
  const corrected = applyAnswer(changed, 'family_children', 'Yes');
  expect(corrected.written_answers?.family_children).toBeUndefined();
});
it('respects scope, budget, invalid input and older state', () => {
  const unknown = { ...initialiseState('Can we talk?'), family_enabled: true, family_only: true };
  const corrected = applyWrittenAnswer(unknown, '__clarify__', 'My employer owes me unpaid wages.');
  expect(corrected.matter_type).toBe('out_of_scope');
  expect(getNextStep(corrected).slot?.id).not.toBe('wages_type');
  const state = start('estates_general');
  expect(applyWrittenAnswer(state, 'estates_problem_type', '   ')).toBe(state);
  const filled = applyWrittenAnswer(state, 'estates_problem_type', 'I have a draft agreement to review.', 'not an option');
  expect(filled.slots.estates_problem_type).toBeUndefined();
  expect(getNextStep({ ...filled, channel: 'sms', questionHistory: ['a','b','estates_problem_type'] }).type).toBe('present_insight');
  expect(selectNextSlot(state)).toBeDefined();
});

it('ties a date to the action it describes', () => {
  const state = applyWrittenAnswer(start('employment_general'),'employment_problem_type',
    'I was dismissed yesterday. They have given me a deadline to respond.');
  expect(getNextStep(state).slot?.id).toBe('written_timing');
  expect(getNextStep(initialiseState('I will sign something by Friday.')).slot?.id).toBe('written_document');
});
it.each([
  'I have nothing to sign.',
  'I don’t need a document review.',
  'I do not need a lawyer to review the lease.',
])('does not invent a review or deadline when the person rules it out: %s', text => {
  const state = applyWrittenAnswer(start('family_general'), 'family_help_sought', text);
  expect(['written_document','written_timing']).not.toContain(getNextStep(state).slot?.id);
});
it('checks prior answers for the document instead of repeating the question', () => {
  let state = { ...initialiseState('I need a lawyer to review my severance offer.'), ...classificationForMatterType('employment_general') };
  state = applyWrittenAnswer(state, 'employment_problem_type', 'They want me to sign something by Friday.');
  expect(getNextStep(state).slot?.id).not.toBe('written_document');
});
it('selects the unanswered half of a question about two kinds of documents', () => {
  const state = applyWrittenAnswer(start('family_general'), 'family_existing_order', 'There is no court order that I know of.');
  expect(state.slots.family_existing_order).toBeUndefined();
  expect(getNextStep(state).slot?.id).toBe('written_agreement');
});
it('keeps an unclassified courtesy reply within the existing clarification flow', () => {
  const state = applyWrittenAnswer(initialiseState('Can we talk?'), '__clarify__', 'Please call me.');
  expect(state.matter_type).toBe('unknown');
  expect(getNextStep(state).type).toBe('clarify');
});
it('keeps the approved buy-in question when counsel is reviewing papers for the visitor', () => {
  const state = initialiseState("I'm buying into an existing company and need someone to review the documents this week.");
  expect(getNextStep(state).slot?.id).not.toBe('written_document');
});
it('distinguishes the employer responding to a claim from the worker seeking wages', () => {
  const employer = applyWrittenAnswer(start('employment_general'), 'employment_problem_type', 'My employee says we owe unpaid overtime.');
  expect(employer.matter_type).toBe('employment_general');
});
it('does not turn a negative written answer into a positive document fact', () => {
  const state = applyWrittenAnswer(start('business_setup_advisory'), 'signed_anything', 'I have not signed an agreement.');
  expect(state.slots.signed_anything).toBe('No');
});
it('keeps both rounds of clarification and ignores an immediate retry', () => {
  let state = applyWrittenAnswer(initialiseState('Can we talk?'), '__clarify__', 'I am trying to understand what happened.');
  state = applyWrittenAnswer(state, '__clarify__', 'The letter arrived in an unmarked envelope.');
  expect(applyWrittenAnswer(state, '__clarify__', 'The letter arrived in an unmarked envelope.')).toBe(state);
  expect(buildReport(state).resolved_facts).toMatchObject({
    'Enquiry clarification': 'I am trying to understand what happened.',
    'Enquiry clarification 2': 'The letter arrived in an unmarked envelope.',
  });
});
