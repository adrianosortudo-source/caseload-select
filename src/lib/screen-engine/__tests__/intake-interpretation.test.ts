import { describe, expect, it } from 'vitest';
import { initialiseState } from '../extractor';
import { applyAnswer, applyWrittenAnswer, getNextStep } from '../control';
import { applyIntakeInterpretation, readIntakeInterpretation, type IntakeInterpretation } from '../interpretation';
import { runEvidencePass } from '../slotEvidence';
import { buildReport } from '../report';

const reading: IntakeInterpretation = { matter:'general_counsel_advisory', answers_question:false,
  superseded_quote:null, current_excerpts:[], unsupported_slots:[], next_slot:null, next_question:null };

describe('evidence across intake turns', () => {
  it('keeps a later statement without attributing it to an unrelated factual question', () => {
    const opening = 'My family is asking about an order.';
    const text = 'It was only a draft. There is no order or agreement.';
    const initial = initialiseState(opening);
    const withReply = applyWrittenAnswer(initial,'family_timing',text);
    const next = applyIntakeInterpretation(withReply, { ...reading, answers_question:true }, text, 'family_timing');
    expect(next.slots.family_timing).toBeUndefined();
    expect(next.intake_reading?.turns[0].question).toBeUndefined();
    const report = buildReport(next);
    expect(report.matter_snapshot).toContain(text);
    expect(Object.values(report.resolved_facts)).toContain(opening);
    expect(Object.values(report.resolved_facts)).toContain(text);
  });
  it('retains the exact opening in the brief without adding an unrequested legal objective', () => {
    const input = 'At the end of my shift the foreman took my key and told me to leave.';
    const next = applyIntakeInterpretation(initialiseState(input),{ ...reading, matter:'wrongful_dismissal' },input);
    const brief = buildReport(next);
    expect(brief.matter_snapshot).toContain(input);
    expect(brief.matter_snapshot).not.toMatch(/severance|damages|notice/i);
  });

  it('does not present a second obsolete clause as current when only the previous goal was marked superseded', () => {
    const opening = 'My customer owes me $8,000. I want to collect it.';
    const latest = 'They have paid in full. I need a release drafted.';
    const next = applyIntakeInterpretation(initialiseState(opening),{ ...reading, superseded_quote:'I want to collect it.',
      replacement_goal:'I need a release drafted.', current_excerpts:['My customer owes me $8,000.',latest] },latest,'amount_at_stake');
    const brief = buildReport(next);
    expect(brief.matter_snapshot).toContain(latest);
    expect(next.intake_reading?.currentAccount).toBe(latest);
    expect(Object.values(brief.resolved_facts)).toContain(opening);
  });

  it('replaces a contradicted balance, keeps the original wording and asks about the new objective', () => {
    const opening = 'My customer owes me $8,000 for a catering job.';
    const answer = 'They have now paid it all. I need a release drafted.';
    const state = applyAnswer(runEvidencePass(opening, initialiseState(opening)), 'payment_status', 'Nothing paid');
    const next = applyIntakeInterpretation(state,{ ...reading, superseded_quote:opening,
      current_excerpts:['They have now paid it all.', 'I need a release drafted.'],
      unsupported_slots:['payment_status'], next_question:'Who will need to sign the release?' },answer,'amount_at_stake');
    expect(next.input).toBe(opening);
    expect(next.matter_type).toBe('general_counsel_advisory');
    expect(getNextStep(next).slot?.question).toBe('Who will need to sign the release?');
    const report = buildReport(next);
    expect(Object.values(report.resolved_facts)).toContain(opening);
    expect(Object.values(report.resolved_facts)).toContain(answer);
    expect(Object.values(report.resolved_facts)).not.toContain('Nothing paid');
    expect(report.matter_snapshot).not.toMatch(/collect(ion|ing) an? (unpaid )?(invoice|debt)/i);
  });

  it('requires evidence for the specific service when the visitor replaces their goal', () => {
    const opening = 'I want to collect an unpaid invoice.';
    const latest = 'They have paid. I need a document drafted.';
    const state = initialiseState(opening);
    const next = applyIntakeInterpretation(state,{...reading,matter:'notary_services',
      superseded_quote:opening,current_excerpts:[opening,latest],replacement_goal:'I need a document drafted.'},latest,'payment_status');
    expect(next.matter_type).not.toBe('notary_services');
    expect(next.matter_type).not.toBe('unpaid_invoice');
    expect(buildReport(next).matter_snapshot).toContain(latest);
    expect(buildReport(next).matter_snapshot).not.toContain('unpaid invoice');
  });

  it('keeps unrelated written information out of the previously asked slot and preserves contact', () => {
    const input = 'I want to talk about a parenting arrangement.';
    const answer = 'There is no agreement. I have not given a date.';
    const state = applyAnswer(applyAnswer(initialiseState(input),'client_email','alex@example.com'),'written_timing',answer);
    const next = applyIntakeInterpretation(state,{ ...reading, matter:'unknown', unsupported_slots:['client_email'] },answer,'written_timing');
    expect(next.slots.written_timing).toBeUndefined();
    expect(next.slots.client_email).toBe('alex@example.com');
    expect(next.intake_reading?.turns.at(-1)).toEqual({text:answer, correction:false, question:undefined});
  });

  it('rejects unsupported quotes as a basis for replacing testimony', () => {
    const state = initialiseState('I own a bakery.');
    const next = applyIntakeInterpretation(state,{ ...reading, superseded_quote:'I sold a bakery.',
      current_excerpts:['That is incorrect.'] },'That is incorrect.','written_goal');
    expect(next.intake_reading?.currentAccount).toBeUndefined();
    expect(next.input).toBe(state.input);
  });

  it('consumes each follow-up once and keeps contact capture under the firm rules', () => {
    const opening='I need a lawyer to review a contract.';
    const next=applyIntakeInterpretation(initialiseState(opening),{...reading,next_question:'When does the current contract expire?'},opening);
    const slot=getNextStep(next).slot!;
    expect(slot.question).toBe('When does the current contract expire?');
    expect(getNextStep(applyAnswer(next,slot.id,'Not sure')).slot?.id).not.toBe(slot.id);
    expect(getNextStep({...next,contactCaptureStarted:true}).slot?.id).not.toBe(slot.id);
    expect(readIntakeInterpretation({matter:'bad'})).toBeUndefined();
  });
});
