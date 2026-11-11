import { describe, expect, it } from 'vitest';
import { SLOT_REGISTRY } from '../slotRegistry';
import { getI18n } from '../i18n/loader';
import { getOptionDisplayLabel, getQuestionDisplayText, resolveDisplayedOption } from '../i18n/display';
import { buildLeadSummary, applyAnswer } from '../control';
import { initialiseState } from '../extractor';
import type { EngineState } from '../types';

describe('complete conversational presentation contract', () => {
  it.each(['en', 'pt'] as const)('covers every question and preserves every choice in %s', language => {
    const bundle = getI18n(language);
    for (const slot of SLOT_REGISTRY) {
      expect(bundle.slot_questions?.[slot.id]?.trim(), slot.id).toBeTruthy();
      expect(getQuestionDisplayText(slot.id, slot.question, language, bundle)).not.toContain('—');
      for (const option of slot.options ?? []) {
        const label = getOptionDisplayLabel(option, slot.id, language, bundle);
        expect(resolveDisplayedOption(label, slot.options!, slot.id, language, bundle), `${slot.id}: ${label}`).toBe(option.value);
      }
    }
  });
  it('retains English fallback for an unavailable locale', () => {
    const slot = SLOT_REGISTRY.find(item => item.id === 'family_existing_order')!;
    expect(getQuestionDisplayText(slot.id, slot.question, 'fr', getI18n('fr'))).toBe(getQuestionDisplayText(slot.id, slot.question, 'en', getI18n('en')));
  });
  it.each(['en', 'pt'] as const)('keeps unknown counsel distinct from no prior counsel in %s', language => {
    const base: EngineState = { ...initialiseState('A fictional employment matter.'), practice_area: 'employment', matter_type: 'severance_review', language };
    const no = buildLeadSummary(applyAnswer(base, 'other_counsel', 'No, you are the first'), getI18n(language)).paragraphs!.join(' ');
    const unknown = buildLeadSummary(applyAnswer(base, 'other_counsel', 'Not sure'), getI18n(language)).paragraphs!.join(' ');
    expect(no).not.toBe(unknown);
    expect(unknown).not.toMatch(/haven't spoken|não conversou/i);
  });
  it.each(['en', 'pt'] as const)('does not change screening facts while composing %s prose', language => {
    let state: EngineState = { ...initialiseState('A fictional purchase of a home.'), practice_area: 'real_estate', matter_type: 'residential_purchase_sale', language };
    state = applyAnswer(state, 'residential_role', 'Buying');
    state = applyAnswer(state, 'hiring_timeline', 'Within the next 30 days');
    state = applyAnswer(state, 'other_counsel', 'No, you are the first');
    state = applyAnswer(state, 'decision_authority', 'Just me');
    const before = JSON.stringify(state);
    const summary = buildLeadSummary(state, getI18n(language));
    expect(JSON.stringify(state)).toBe(before);
    expect(summary.paragraphs?.length).toBeGreaterThan(0);
    expect(summary.paragraphs?.join(' ')).not.toMatch(/residential_role|hiring_timeline|other_counsel|decision_authority/);
    expect(summary.paragraphs?.join(' ')).not.toMatch(/will win|is reviewing your|was sent to the firm/i);
  });
});
