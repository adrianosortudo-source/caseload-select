import { describe, expect, it } from 'vitest';
import { initialiseState } from '../extractor';
import { configureFirmPracticeAreas, groundFamilyConversationFacts } from '../family';
import { mergeLlmResults } from '../llm/extractor';
import { applyAnswer, getNextStep } from '../control';
import { isUserAnswered } from '../selector';
import type { EngineState } from '../types';

function proposed(text: string, values: Record<string, string>): EngineState {
  const base = configureFirmPracticeAreas(initialiseState(text), ['family']);
  return mergeLlmResults({ ...base, matter_type: 'family_general', practice_area: 'family' }, values);
}
function checkNoRepeat(state: EngineState, excluded: string[]): void {
  let current = state;
  for (let i = 0; i < 8; i++) {
    const step = getNextStep(current);
    if (!step.slot) break;
    expect(excluded).not.toContain(step.slot.id);
    current = applyAnswer(current, step.slot.id, step.slot.options?.[0]?.value ?? 'No upcoming court date');
  }
}

describe('literal family evidence', () => {
  it('grounds the observed English parenting court order and group location', () => {
    const text = 'I need help with parenting. We have a parenting court order. We and the children live in Toronto, Ontario.';
    const s = groundFamilyConversationFacts(proposed(text, { family_help_sought: 'Parenting or decision-making', family_existing_order: 'Court order', family_jurisdiction: 'Ontario' }), text);
    for (const id of ['family_help_sought', 'family_existing_order', 'family_jurisdiction']) {
      expect(s.slot_meta[id]).toMatchObject({ source: 'explicit', confidence: 1, evidence: text });
      expect(isUserAnswered(s, id)).toBe(true);
    }
    checkNoRepeat(s, ['family_help_sought', 'family_existing_order', 'family_jurisdiction']);
  });
  it('grounds an order stated after the observed residence phrase', () => {
    const text = 'Fictional example: My former spouse refuses parenting time with our two children. We live in Toronto, Ontario, have a parenting court order and a case conference on December 19, 2026. I need a lawyer this week, have not spoken with another lawyer and decide whether to hire one myself.';
    const s = groundFamilyConversationFacts(proposed(text, { family_help_sought: 'Parenting or decision-making', family_children: 'Yes', family_existing_order: 'Court order', family_jurisdiction: 'Ontario' }), text);
    expect(s.slot_meta.family_existing_order).toMatchObject({ source: 'explicit', confidence: 1, evidence: text });
    expect(isUserAnswered(s, 'family_existing_order')).toBe(true);
    checkNoRepeat(s, ['family_existing_order']);
  });
  it('grounds the observed Portuguese opening without mistaking denied access for no children', () => {
    const text = 'Meu ex-marido não me deixa ver nossos dois filhos. Moramos em Toronto, Ontario. Gostaria de ajuda para organizar a convivência com eles.';
    const s = groundFamilyConversationFacts(proposed(text, { family_help_sought: 'Parenting or decision-making', family_children: 'Yes', family_jurisdiction: 'Ontario' }), text);
    for (const [id, value] of Object.entries({ family_help_sought: 'Parenting or decision-making', family_children: 'Yes', family_jurisdiction: 'Ontario' })) {
      expect(s.slots[id]).toBe(value);
      expect(s.slot_meta[id]).toMatchObject({ source: 'explicit', confidence: 1, evidence: text });
      expect(isUserAnswered(s, id)).toBe(true);
    }
    checkNoRepeat(s, ['family_help_sought', 'family_children', 'family_jurisdiction']);
  });
  it.each([
    ['Maybe we have a parenting court order.', 'family_existing_order', 'Court order'],
    ['Maybe we live in Toronto, Ontario, have a parenting court order and a case conference.', 'family_existing_order', 'Court order'],
    ["I don't know whether we have a parenting court order.", 'family_existing_order', 'Court order'],
    ['We do not have a parenting court order.', 'family_existing_order', 'Court order'],
    ['Maybe we and the children live in Toronto, Ontario.', 'family_jurisdiction', 'Ontario'],
    ['Perhaps we and the children live in Toronto, Ontario.', 'family_jurisdiction', 'Ontario'],
    ['We and the children do not live in Toronto, Ontario.', 'family_jurisdiction', 'Ontario'],
    ['Não sei se moramos em Toronto, Ontario.', 'family_jurisdiction', 'Ontario'],
    ['Não moramos em Toronto, Ontario.', 'family_jurisdiction', 'Ontario'],
    ['Moramos em uma cidade fora de Ontario.', 'family_jurisdiction', 'Ontario'],
    ['Talvez nossos dois filhos estejam envolvidos.', 'family_children', 'Yes'],
    ['Não temos nossos dois filhos.', 'family_children', 'Yes'],
    ['Não gostaria de ajuda para organizar a convivência.', 'family_help_sought', 'Parenting or decision-making'],
    ['Talvez gostaria de ajuda para organizar a convivência.', 'family_help_sought', 'Parenting or decision-making'],
  ])('does not ground uncertain or negative wording: %s', (text, id, value) => {
    const initial = proposed(text, { [id]: value });
    const s = groundFamilyConversationFacts(initial, text);
    expect(isUserAnswered(s, id)).toBe(false);
  });
  it('does not overwrite a previous conflicting answer with a compound order statement', () => {
    const text = 'We have a parenting court order.';
    const initial = applyAnswer(proposed(text, {}), 'family_existing_order', 'Neither');
    const s = groundFamilyConversationFacts(initial, text);
    expect(s.slots.family_existing_order).toBe('Neither');
    expect(s.slot_meta.family_existing_order.source).toBe('answered');
  });
  it('does not reduce a proposed Both answer to just a court order', () => {
    const text = 'We have a parenting court order and a written agreement.';
    const initial = proposed(text, { family_existing_order: 'Both' });
    const s = groundFamilyConversationFacts(initial, text);
    expect(s.slots.family_existing_order).toBe('Both');
    expect(isUserAnswered(s, 'family_existing_order')).toBe(false);
  });
});
