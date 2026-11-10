import { describe, expect, it } from 'vitest';
import { getI18n } from '../i18n/loader';
import { getOptionDisplayLabel, getQuestionDisplayText, resolveDisplayedOption } from '../i18n/display';
import { getQuestionContext } from '../../screen-conversation-copy';
import type { EngineState } from '../types';
import { SLOT_REGISTRY } from '../slotRegistry';
import { initialiseState } from '../extractor';
import { applyAnswer, buildLeadSummary } from '../control';

describe('conversational display', () => {
  const slot = SLOT_REGISTRY.find(item => item.id === 'corporate_help_category')!;
  it.each(['en', 'pt', 'fr'] as const)('maps visible %s labels to canonical values', language => {
    const bundle = getI18n(language);
    for (const option of slot.options!) {
      const label = getOptionDisplayLabel(option, slot.id, language, bundle);
      expect(label.trim()).not.toBe('');
      expect(resolveDisplayedOption(label, slot.options!, slot.id, language, bundle)).toBe(option.value);
    }
    expect(getQuestionDisplayText(slot.id, slot.question, language, bundle).trim()).not.toBe('');
  });
  it('keeps inferred facts out of the recap and retains explicit uncertainty', () => {
    let state: EngineState = { ...initialiseState('My employer gave me a severance offer.'), practice_area: 'employment' as const, matter_type: 'severance_review' as const };
    state = applyAnswer(state, 'severance_deadline', 'Not sure');
    state.slots.salary_band = '$999,999';
    state.slot_meta.salary_band = { source: 'llm_inferred', confidence: 0.9 };
    const recap = buildLeadSummary(state, getI18n('en')).paragraphs!.join(' ');
    expect(recap).toMatch(/not sure/i);
    expect(recap).not.toContain('$999,999');
  });
  it.each([
    ['corporate', 'business_setup_advisory', 'business_location', 'Toronto'],
    ['real_estate', 'residential_purchase_sale', 'residential_closing_timeline', 'Within 30 days'],
    ['employment', 'severance_review', 'severance_deadline', 'Not sure'],
    ['estates', 'probate', 'estate_value_band', '$100,000 to $500,000'],
    ['family', 'family_general', 'family_jurisdiction', 'Ontario'],
  ] as const)('retains a supplied %s fact and readiness', (area, matter, id, answer) => {
    let state: EngineState = { ...initialiseState('Please review my fictional situation.'), practice_area: area, matter_type: matter };
    state = applyAnswer(state, id, answer);
    state = applyAnswer(state, 'hiring_timeline', 'Now (this week)');
    state = applyAnswer(state, 'other_counsel', 'No');
    state = applyAnswer(state, 'decision_authority', 'Just me');
    const recap = buildLeadSummary(state, getI18n('en')).paragraphs!.join(' ');
    expect(recap.toLocaleLowerCase()).toContain(answer.toLocaleLowerCase());
    expect(recap).toContain('this week');
    expect(recap).toContain("you'll decide whether to hire one");
  });
  it.each(['en', 'pt'] as const)('has a localized recap sentence for every %s registry slot', language => {
    const templates = getI18n(language).recap_templates!;
    for (const slot of SLOT_REGISTRY) {
      expect(templates[slot.id], slot.id).toContain('{answer}');
      expect(templates[slot.id].match(/\{answer\}/g)).toHaveLength(1);
    }
  });
  it('represents identical short replies once for each distinct fact', () => {
    let state: EngineState = { ...initialiseState('My fictional business needs help.'), practice_area: 'corporate', matter_type: 'unpaid_invoice' };
    state = applyAnswer(state, 'invoice_exists', 'Yes');
    state = applyAnswer(state, 'proof_of_performance', 'Yes');
    const bundle = getI18n('en');
    const recap = buildLeadSummary(state, bundle).paragraphs!.join(' ');
    for (const id of ['invoice_exists', 'proof_of_performance']) {
      const definition = SLOT_REGISTRY.find(slot => slot.id === id)!;
      const option = definition.options!.find(item => item.value === 'Yes')!;
      const sentence = bundle.recap_options?.[id]?.Yes || bundle.recap_templates![id].replace('{answer}', getOptionDisplayLabel(option, id, 'en', bundle));
      expect(recap.split(sentence)).toHaveLength(2);
    }
  });
  it('retains raw additional detail with translated context and never exposes a slot ID', () => {
    let state: EngineState = { ...initialiseState('Uma situação fictícia.'), practice_area: 'employment', matter_type: 'severance_review', language: 'pt' };
    state = applyAnswer(state, 'severance_deadline', 'Not sure');
    state.slot_meta.severance_deadline.evidence = 'Não sei se é sexta-feira.';
    const recap = buildLeadSummary(state, getI18n('pt')).paragraphs!.join(' ');
    expect(recap).toContain('Não sei se é sexta-feira.');
    expect(recap).not.toContain('severance_deadline');
  });
  it('does not repeat the complete opening as slot evidence', () => {
    const input = 'My fictional invoice was not paid.';
    const state: EngineState = { ...initialiseState(input), practice_area: 'corporate', matter_type: 'unpaid_invoice' };
    state.slots.invoice_exists = 'Yes';
    state.slot_meta.invoice_exists = { source: 'explicit', confidence: 1, evidence: input };
    const recap = buildLeadSummary(state, getI18n('en')).paragraphs!.join(' ');
    expect(recap.split(input)).toHaveLength(2);
  });
  it('adds parenting context only when the visitor confirmed it', () => {
    const slot = SLOT_REGISTRY.find(item => item.id === 'family_existing_order')!;
    let state = initialiseState('Fictional family inquiry');
    state = applyAnswer(state, 'family_help_sought', 'Parenting or decision-making');
    expect(getQuestionContext(state, slot)).toContain('parenting arrangements');
    state.slot_meta.family_help_sought.source = 'llm_inferred';
    expect(getQuestionContext(state, slot)).toBe('');
  });
  it('does not expose internal routing enums while preserving actual selections', () => {
    let state: EngineState = { ...initialiseState('A customer did not pay my fictional invoice.'), practice_area: 'corporate', matter_type: 'unpaid_invoice' };
    state = applyAnswer(state, 'corporate_problem_type', 'unpaid_invoice');
    let recap = buildLeadSummary(state, getI18n('en')).paragraphs!.join(' ');
    expect(recap).not.toContain('unpaid_invoice');
    const slot = SLOT_REGISTRY.find(item => item.id === 'corporate_problem_type')!;
    state = applyAnswer(state, slot.id, slot.options![0].value);
    recap = buildLeadSummary(state, getI18n('en')).paragraphs!.join(' ');
    expect(recap).toContain(getOptionDisplayLabel(slot.options![0], slot.id, 'en', getI18n('en')));
  });
  it('uses a choice-specific sentence only for an exact choice, retaining extra raw detail', () => {
    let state: EngineState = { ...initialiseState('A fictional payment issue.'), practice_area: 'corporate', matter_type: 'unpaid_invoice' };
    state = applyAnswer(state, 'invoice_exists', 'Yes');
    const bundle = { ...getI18n('en'), recap_options: { invoice_exists: { Yes: 'You have an invoice.' } } };
    let recap = buildLeadSummary(state, bundle).paragraphs!.join(' ');
    expect(recap).toContain('You have an invoice.');
    state.slot_meta.invoice_exists.evidence = 'Yes, but I only have a partial copy.';
    recap = buildLeadSummary(state, bundle).paragraphs!.join(' ');
    expect(recap).toContain('Yes, but I only have a partial copy.');
    expect(recap).not.toContain('You have an invoice.');
  });
});
