import { classify, extractRawSignals } from './extractor';
import { getSlotById } from './slotRegistry';
import type { EngineState, SlotDefinition } from './types';

const unspecifiedDocument = /\b(?:sign|review)\s+(?:(?:some|the|these|those|a|my|their|some kind of)\s+)*(?:something|it|paperwork|papers?|documents?|forms?)\b/i;
const documentName = /\b(?:agreements?|contracts?|offers?|releases?|leases?|wills|(?:a|my|our|the|his|her|their|last) will|court orders?|notices?|deeds?|applications?|letters?|settlements?|parenting plans?)\b/i;
const reviewAction = /\b(?:sign(?:ing|ature)?|review(?:ed|ing)?|submit(?:ting)?|fil(?:e|ing)|draft(?:ed|ing)?|respond(?:ing)?|reply|due|deadline)\b/i;
const negativeAction = /\b(?:nothing to (?:sign|review)|(?:do not|don't|don’t|did not|didn't|didn’t|no longer) (?:need|want|have|plan|intend|expect|require)|(?:not|never) (?:signing|asked to sign|going to sign)|no (?:review|reply|response|signature) (?:is )?(?:needed|required))\b/i;
const deadlineReference = /\b(?:by|before|due|deadline|respond|reply|submit|sign|file|meeting|hearing|appointment|court date)\b/i;
const negativeTiming = /\b(?:no (?:fixed |specific )?(?:date|deadline)|not time[- ]sensitive|no rush|no time limit)\b/i;
const timing = /\b(?:today|tomorrow|yesterday|tonight|(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:next|last|this) (?:week|month|year)|(?:in|within) (?:\d+|one|two|three|four|five|a few) (?:days?|weeks?|months?)|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may \d|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,4}[-/]\d{1,2}[-/]\d{1,4})\b/i;
const uncertain = /^(?:(?:i(?:'m| am)? )?(?:do(?:n't| not) know|unsure|not (?:sure|certain))|unknown|prefer not to (?:say|answer)|skip)[\s.!?]*$/i;
const unclearGoal = /\b(?:sort (?:it|this|things|everything) out|formaliz[es]?|formalise|make (?:this|it|things) official|figure (?:it|this) out|not sure (?:where|how) to start)\b/i;
const askingToChoosePriority = /\b(?:both|more than one|several (?:things|issues)|two (?:different )?(?:things|issues))\b/i;

/** Select a single missing detail using the current turn, previously supplied facts and the original enquiry. */
export function selectWrittenFollowUp(state: EngineState): SlotDefinition | undefined {
  if (state.matter_type === 'out_of_scope') return;
  const lastId = state.questionHistory[state.questionHistory.length - 1];
  // Ordinary chip answers already resolve their prompt via the matter pack.
  const previous = lastId && getSlotById(lastId);
  const freeText = previous && previous.input_type === 'free_text' && previous.tier !== 'contact';
  const turn = lastId ? state.written_answers?.[lastId] ?? (freeText ? state.slots[lastId] : undefined) : state.input;
  if (!turn || uncertain.test(turn)) return;
  const statements = [state.input, ...Object.values(state.written_answers ?? {}), ...Object.values(state.slots)]
    .filter((value): value is string => !!value);
  const clauses = statements.flatMap(value => value.split(/[.!?;\n]|\bbut\b/i));
  const hasTime = !!state.slots.written_timing || clauses.some(clause =>
    negativeTiming.test(clause) || (timing.test(clause) && deadlineReference.test(clause)));
  const relevant = turn.split(/[.!?;\n]|\bbut\b/i).filter(clause => !negativeAction.test(clause)).join(' ');
  // An established practice pack can ask its own first question when the
  // visitor wants counsel to review papers, rather than facing a request to act.
  const receivingRequest = /\b(?:asked|asking|told|want|need|expect) (?:me|us) to (?:sign|review)|\b(?:i|we) (?:must|will|have to|need to) sign\b/i.test(relevant);
  const clarifyDocument = !!lastId || state.matter_type === 'unknown' || state.matter_type.endsWith('_general') || receivingRequest;
  const documentAlreadyNamed = state.slots.written_document || clauses.some(clause =>
    !negativeAction.test(clause) && documentName.test(clause) && reviewAction.test(clause));
  let id: string | undefined;
  if (lastId === 'family_existing_order' && /\b(?:no|without) (?:existing |written )?(?:court )?order\b/i.test(turn) && !/\bagreement\b/i.test(turn)) {
    id = 'written_agreement';
  } else if (lastId === 'family_existing_order' && /\b(?:no|without) (?:existing |written )?agreement\b/i.test(turn) && !/\border\b/i.test(turn)) {
    id = 'written_order';
  } else if (clarifyDocument && unspecifiedDocument.test(relevant) && !documentName.test(relevant) && !documentAlreadyNamed) {
    id = 'written_document';
  } else if (reviewAction.test(relevant) && !hasTime &&
      (documentName.test(relevant) || /\b(?:deadline|due|sign)\b/i.test(relevant))) {
    if (lastId || /\b(?:deadline|due)\b/i.test(relevant)) id = 'written_timing';
  } else if (askingToChoosePriority.test(relevant) ||
      (unclearGoal.test(relevant) && (lastId || state.matter_type.endsWith('_general') || state.matter_type === 'unknown')) ||
      (state.written_answers?.[lastId] && state.matter_type.endsWith('_general') && previous &&
        (previous.question_group === 'routing' || previous.question_group === 'routing_category'))) {
    id = 'written_goal';
  }
  if (!id || state.slots[id] || state.questionHistory.includes(id)) return;
  return getSlotById(id);
}

export function interpretWrittenAnswer(
  state: EngineState, slotId: string, answer: string, slot: SlotDefinition | undefined, mappedOptionValue?: string,
): { state: EngineState; value?: string } {
  const options = slot?.options ?? [];
  const normalized = answer.toLocaleLowerCase();
  const matched = options.find(option =>
    option.value === mappedOptionValue || (!mappedOptionValue &&
      (option.value.toLocaleLowerCase() === normalized || option.label.toLocaleLowerCase() === normalized)));
  // An 'other' sentinel only opens the editor. It never becomes a fact.
  const value = matched && !/^(other|something else)(:.*)?$/i.test(matched.value) ? matched.value : undefined;
  const updated: EngineState = {
    ...state, slots: { ...state.slots }, slot_meta: { ...state.slot_meta }, slot_evidence: { ...state.slot_evidence },
    written_answers: { ...state.written_answers, [slotId]: answer },
  };
  // A direct correction of an earlier answer replaces that slot. Departure
  // from the fixed options is represented as text, even if it maps to none.
  delete updated.slots[slotId];
  delete updated.slot_meta[slotId];
  delete updated.slot_evidence[slotId];

  const classified = value === undefined ? refineWrittenRoute(updated, answer) : updated;
  const narrative = [state.input, ...Object.values(updated.written_answers ?? {})].join('\n');
  return { state: { ...classified, raw: extractRawSignals(narrative) }, value };
}

/** A follow-up can identify the matter without changing the original enquiry. */
export function refineWrittenRoute(state: EngineState, answer: string): EngineState {
  const updated = { ...state };
  const isGeneral = state.matter_type.endsWith('_general') || state.matter_type === 'unknown';
  const relevant = answer.split(/[.!?;\n]|\bbut\b/i).filter(clause => !negativeAction.test(clause)).join(' ').trim();
  if (isGeneral && relevant && !uncertain.test(answer)) {
    let route = classify(relevant, state.practice_area);
    if (route.matter_type === 'unknown' && state.input !== answer) {
      route = classify(state.input + '\n' + relevant, state.practice_area);
    }
    const sameArea = state.practice_area === 'unknown' || state.practice_area === route.practice_area;
    if (state.matter_type === 'unknown' && state.family_only && route.practice_area !== 'family' && route.practice_area !== 'unknown') {
      Object.assign(updated, route, { matter_type: 'out_of_scope', matter_type_provenance: 'deterministic' });
    } else if (sameArea && state.family_enabled && route.practice_area === 'family') {
      Object.assign(updated, route, { matter_type: 'family_general', matter_type_provenance: 'deterministic' });
    } else if (sameArea && route.matter_type !== 'unknown' &&
        (state.matter_type === 'unknown' || (route.matter_type !== 'out_of_scope' && !route.matter_type.endsWith('_general')))) {
      Object.assign(updated, route, { matter_type_provenance: 'deterministic' });
    }
  }
  return updated;
}
