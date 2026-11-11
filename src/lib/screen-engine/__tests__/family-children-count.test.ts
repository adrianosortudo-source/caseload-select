import { describe, expect, it } from 'vitest';
import { initialiseState } from '../extractor';
import { configureFirmPracticeAreas, groundFamilyConversationFacts } from '../family';
import { mergeLlmResults } from '../llm/extractor';
import { applyAnswer, getNextStep } from '../control';

describe('explicit family children counts', () => {
  it('grounds the exact description and does not ask again about children', () => {
    const text = 'My former wife is not letting me see my two children. We have a parenting order and a case conference on December 19, 2026. We live in Ontario. I need help arranging parenting time.';
    const initial = configureFirmPracticeAreas(initialiseState(text), ['family']);
    const proposed = mergeLlmResults(initial, { __family_area: 'family', family_help_sought: 'Parenting or decision-making', family_children: 'Yes' });
    const grounded = groundFamilyConversationFacts(proposed, text);
    expect(grounded.slots.family_children).toBe('Yes');
    expect(grounded.slot_meta.family_children).toMatchObject({ source: 'explicit', evidence: text });
    expect(getNextStep(applyAnswer(grounded, 'family_help_sought', 'Parenting or decision-making')).slot?.id).not.toBe('family_children');
  });
  it('grounds a numeric count in a possessive phrase', () => {
    const text = 'I need a family lawyer about access to our 2 kids.';
    const state = configureFirmPracticeAreas(initialiseState('I need a family lawyer for custody.'), ['family']);
    expect(groundFamilyConversationFacts(state, text).slot_meta.family_children).toMatchObject({ source: 'explicit', evidence: text });
    expect(groundFamilyConversationFacts(state, text).slots.family_children).toBe('Yes');
  });
  it('keeps an explicit no-children answer negative', () => {
    const text = 'We have no children.';
    const state = configureFirmPracticeAreas(initialiseState('I need a family lawyer for divorce.'), ['family']);
    const grounded = groundFamilyConversationFacts(state, text);
    expect(grounded.slots.family_children).toBe('No');
    expect(grounded.slot_meta.family_children).toMatchObject({ source: 'explicit', evidence: text });
  });
});
