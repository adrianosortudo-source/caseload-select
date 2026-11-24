import { describe, expect, it } from 'vitest';
import { applySelectedPracticeArea, initialiseState } from '../extractor';
import { applyIntakeInterpretation, type IntakeInterpretation } from '../interpretation';
import { applyAnswer, applyGroundedWrittenAnswer, getNextStep } from '../control';
import { mergeLlmResults } from '../llm/extractor';
import { runEvidencePass } from '../slotEvidence';
import { isUserAnswered, selectNextSlot } from '../selector';
import { buildReport } from '../report';
import { getSlotById } from '../slotRegistry';
import { interpretationContext, addInterpretationSchema } from '../../intake-interpretation-prompt';
import type { MatterType, PracticeArea } from '../types';

const base: IntakeInterpretation = { matter: 'unknown', answers_question: false,
  superseded_quote: null, current_excerpts: [], unsupported_slots: [], next_slot: null, next_question: null };

describe('the shared discovery and callback question policy', () => {
  it.each<[PracticeArea, MatterType, string, string]>([
    ['corporate','business_setup_advisory','business_stage','I already run a bike shop.'],
    ['real_estate','residential_purchase_sale','residential_closing_timeline','Our closing is December 17.'],
    ['employment','wage_recovery','wages_type','They still owe me overtime pay.'],
    ['estates','probate','will_status_probate','My father left a signed will.'],
    ['family','family_general','family_children','My two kids stay with me during the week.'],
  ])('retains the quoted %s answer without repeating or scoring it', (area, matter, id, opening) => {
    const state = applySelectedPracticeArea({...initialiseState(opening), family_enabled: true}, area);
    const canonical = getSlotById(id)!.question;
    const result = applyIntakeInterpretation(state, {...base, matter,
      covered_questions:[{slot_id:id, quote:opening}], next_slot:id, next_question:canonical }, opening);
    expect(result.intake_reading?.coveredQuestions?.[id]).toEqual(opening);
    expect(isUserAnswered(result,id)).toBe(false);
    expect(getNextStep(result).slot?.question).not.toBe(canonical);
    expect(selectNextSlot(result)?.id).not.toBe(id);
    expect(buildReport(result).best_next_question).not.toBe(canonical);
  });

  it('does not repackage a rejected broad menu when the proposed route became more specific', () => {
    const opening = 'I fix bikes under my own name. I want customers to hire a company instead of me personally.';
    const initial = applySelectedPracticeArea(initialiseState(opening), 'corporate');
    const previous = getSlotById('corporate_help_category')!;
    const result = applyIntakeInterpretation(initial,{ ...base, matter:'business_setup_advisory',
      next_slot:previous.id, next_question:previous.question }, opening);
    expect(result.matter_type).toBe('business_setup_advisory');
    expect(getNextStep(result).slot?.question).not.toBe(previous.question);
  });

  it('invalidates obsolete, unsupported, invented, or protected coverage', () => {
    const opening = 'My employer owes me overtime.';
    const initial = applySelectedPracticeArea(initialiseState(opening), 'employment');
    const first = applyIntakeInterpretation(initial,{ ...base, matter:'wage_recovery',
      covered_questions:[{slot_id:'wages_type',quote:opening},{slot_id:'wages_owed_band',quote:'It was $7,000.'},
        {slot_id:'other_counsel',quote:opening},{slot_id:'client_name',quote:opening}] }, opening);
    expect(first.intake_reading?.coveredQuestions).toEqual({wages_type: opening});
    const latest = 'My overtime was paid. I need my new employment contract reviewed.';
    const result = applyIntakeInterpretation(first,{ ...base, matter:'employment_contract_review',
      superseded_quote:opening, replacement_goal:'I need my new employment contract reviewed.',
      current_excerpts:[latest], unsupported_slots:['wages_type'],
      covered_questions:[{slot_id:'wages_type',quote:opening},{slot_id:'contract_review_timeline',quote:opening}]
    },latest,'wages_owed_band');
    expect(result.intake_reading?.coveredQuestions?.wages_type).toBeUndefined();
    expect(result.intake_reading?.coveredQuestions?.contract_review_timeline).toBeUndefined();
  });

  it('keeps a more specific corrected objective when its field and the request independently support it', () => {
    const opening = 'I thought I needed help selling my duplex.';
    const goal = 'It is my tenant’s commercial lease renewal that I want checked.';
    const state = applySelectedPracticeArea(initialiseState(opening),'real_estate');
    const next = applyIntakeInterpretation(state, {...base,matter:'commercial_real_estate',superseded_quote:opening,
      replacement_goal:goal,current_excerpts:[goal],next_slot:'commercial_re_concerns'},goal,'residential_property_type');
    expect(next.matter_type).toBe('commercial_real_estate');
    expect(getNextStep(next).slot?.id).toBe('commercial_re_concerns');
  });

  it('suppresses a known specific option on a corrected goal even if the proposed fallback rephrases it', () => {
    const opening = 'My employer offered me a severance package.';
    const goal = 'I need my unpaid overtime, not advice about leaving.';
    const state = applySelectedPracticeArea(initialiseState(opening),'employment');
    const next = applyIntakeInterpretation(state, {...base,matter:'wage_recovery',superseded_quote:opening,
      replacement_goal:goal,current_excerpts:[goal],next_slot:'wages_type',next_question:'What sort of wages are outstanding?'},goal,'signed_release');
    expect(next.intake_reading?.coveredQuestions?.wages_type).toBe('I need my unpaid overtime');
    expect(getNextStep(next).slot?.id).toBe('wages_owed_band');
    expect(next.slots.wages_type).toBeUndefined();
  });

  it.each([
    ['probate' as const, 'will_status_probate', 'We found his signed will this morning.', 'Yes, and it is valid'],
    ['family_general' as const, 'family_existing_order', 'There is no court order.', 'Neither'],
    ['will_drafting' as const, 'existing_will_status', 'I signed a will years ago.', 'Yes, but it is outdated'],
  ])('does not convert a partial answer in %s into a stronger menu label', (matter,id,source,proposed) => {
    const state = {...initialiseState('I need advice.'),matter_type:matter,family_enabled:true};
    const merged = mergeLlmResults(state,{[id]:proposed});
    const recorded = applyGroundedWrittenAnswer(merged,id,source,proposed);
    const interpreted = applyIntakeInterpretation(recorded,{...base,matter,answers_question:true,
      covered_questions:[{slot_id:id,quote:source}]},source,id);
    const resumed = runEvidencePass(source,mergeLlmResults(interpreted,{[id]:proposed}));
    expect(resumed.slots[id]).toBeUndefined();
    expect(resumed.slot_meta[id]).toBeUndefined();
    expect(buildReport(resumed).resolved_facts_v2.some(fact => fact.value === proposed)).toBe(false);
    expect(buildReport(resumed).resolved_facts_v2.some(fact => fact.value === source)).toBe(true);
    expect(applyAnswer(resumed,id,proposed).slots[id]).toBe(proposed);
    expect(applyGroundedWrittenAnswer(resumed,id,proposed,proposed).slots[id]).toBe(proposed);
  });

  it('accepts a complete independent denial for a combined agreement and order question', () => {
    const state = {...initialiseState('I want to ask about parenting.'),matter_type:'family_general' as const,family_enabled:true};
    const answer = 'There is no order and no written agreement.';
    expect(applyGroundedWrittenAnswer(state,'family_existing_order',answer,'Neither').slots.family_existing_order).toBe('Neither');
  });

  it('re-grounds the corrected value after discarding an unsupported earlier hypothesis', () => {
    const opening = "She won't let me see my son. I was told there is a court order.";
    const latest = 'I checked. It was a draft that nobody signed. There is no order and no written agreement.';
    const initial = applySelectedPracticeArea({...initialiseState(opening),family_enabled:true},'family');
    const next = applyIntakeInterpretation(initial,{...base,matter:'family_general',
      superseded_quote:'I was told there is a court order.', current_excerpts:["She won't let me see my son.",latest],
      unsupported_slots:['family_existing_order']},latest,'family_timing');
    expect(next.slots.family_existing_order).toBe('Neither');
    expect(next.slot_meta.family_existing_order.source).toBe('explicit');
    const schema = addInterpretationSchema({properties:{},required:[]});
    expect(schema.properties.interpretation.properties.matter.enum).toContain('family_general');
  });

  it('does not send existing structured contact details to the model', () => {
    const state = { ...initialiseState('I need a will'), slots:{client_name:'Jamie Example',client_email:'demo@example.com',
      client_phone:'5550100',client_postal_code:'A1A1A1',unrecognised:'extra',marital_status:'Married'} };
    const context = JSON.parse(interpretationContext(state, {}));
    expect(context.existing_fields).toEqual({marital_status:'Married'});
    expect(JSON.stringify(context)).not.toContain('demo@example.com');
    expect(context.questions_by_matter.probate).toContain('will_status_probate');
  });
});
