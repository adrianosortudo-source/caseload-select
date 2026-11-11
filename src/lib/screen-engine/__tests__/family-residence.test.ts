import { describe, expect, it } from 'vitest';
import { initialiseState } from '../extractor';
import { configureFirmPracticeAreas, groundFamilyConversationFacts } from '../family';
import { mergeLlmResults } from '../llm/extractor';
import { applyAnswer, getNextStep } from '../control';

describe('explicit family group residence', () => {
  it('grounds the exact website inquiry and does not repeat the location question', () => {
    const text = 'My former spouse is refusing parenting time with our two children. We all live in Toronto, Ontario. We have a parenting order and our case conference is December 19, 2026. I need help seeing my children.';
    const initial = configureFirmPracticeAreas(initialiseState(text), ['family']);
    const proposed = mergeLlmResults(initial, { __family_area: 'family', family_help_sought: 'Parenting or decision-making', family_children: 'Yes', family_jurisdiction: 'Ontario' });
    let state = groundFamilyConversationFacts(proposed, text);
    expect(state.slot_meta.family_jurisdiction).toMatchObject({ source: 'explicit', evidence: text });
    expect(state.slots.family_jurisdiction).toBe('Ontario');
    for (let i = 0; i < 10; i++) {
      const step = getNextStep(state);
      expect(step.slot?.id).not.toBe('family_jurisdiction');
      if (!step.slot || step.type !== 'continue') break;
      state = applyAnswer(state, step.slot.id, step.slot.options?.[0]?.value ?? 'Not sure');
    }
  });
  it('accepts both people explicitly residing in Ontario', () => {
    const state = configureFirmPracticeAreas(initialiseState('I need a family lawyer for custody.'), ['family']);
    expect(groundFamilyConversationFacts(state, 'We both live in Ottawa, Ontario.').slot_meta.family_jurisdiction?.source).toBe('explicit');
  });
  it.each(['We both live in Montreal, Quebec.', 'Maybe we all live in Toronto, Ontario.'])('does not assert Ontario from %s', text => {
    const state = configureFirmPracticeAreas(initialiseState('I need a family lawyer for custody.'), ['family']);
    expect(groundFamilyConversationFacts(state, text).slot_meta.family_jurisdiction?.source).not.toBe('explicit');
  });
});
