import type { EngineState, SlotDefinition } from './screen-engine/types';

/** A connection is shown only when the visitor confirmed the relevant fact. */
export function getQuestionContext(state: EngineState | null, slot: SlotDefinition): string {
  if (slot.id !== 'family_existing_order' || state?.slots.family_help_sought !== 'Parenting or decision-making') return '';
  if (!['explicit', 'answered'].includes(state.slot_meta.family_help_sought?.source || '')) return '';
  return state.language === 'pt'
    ? 'Vamos entender melhor a situação dos filhos.'
    : 'Let’s clarify the parenting arrangements.';
}
