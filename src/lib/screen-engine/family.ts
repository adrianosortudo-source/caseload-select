import type { EngineState, PracticeArea } from './types';
import { familyNegativeIsGrounded } from './llm/extractor';

/** Enable the family pack only when the firm profile explicitly includes it. */
export function configureFirmPracticeAreas(state: EngineState, areas: readonly PracticeArea[]): EngineState {
  const enabled = areas.includes('family');
  if (!enabled) return state;
  const familyOnly = areas.every(area => area === 'family');
  // Preserve the established narrow deterministic matches; semantic classification also runs through the provider.
  const familySignal = /\b(?:other parent|former partner|ex-spouse|spouse and I are living separately|parenting|child custody|custody of (?:my|our|the) (?:child|children)|access to (?:my|our) (?:child|children|kids)|child support|spousal support|divorce|marital separation|family separation|separat(?:ed|ing) from my (?:spouse|husband|wife|partner)|family court|family lawyer|family law)\b/i.test(state.input);
  if (familySignal && (state.matter_type === 'unknown' || state.matter_type === 'out_of_scope')) return { ...state, family_enabled: true, family_only: familyOnly, practice_area: 'family', matter_type: 'family_general' };
  // This minimal profile represents a family-only firm. Preserve the identified
  // area for referral; never force an unrelated matter into the family pack.
  if (familyOnly && state.matter_type !== 'unknown' && state.matter_type !== 'family_general') return { ...state, family_enabled: true, family_only: true, matter_type: 'out_of_scope' };
  return { ...state, family_enabled: true, family_only: familyOnly };
}

/** Promote only facts with literal evidence in the person's latest message. */
export function groundFamilyConversationFacts(state: EngineState, input: string): EngineState {
  if (state.matter_type !== 'family_general' || !input.trim()) return state;
  const text = input.trim();
  const candidates: Record<string, string> = {};
  if (state.matter_type === "family_general") {
    const hasChildClause = text.split(/[.!?;\n]+/).find((part) =>
      !/\b(?:no|not|never|without|don't|do not|doesn't|does not)\b/i.test(part) &&
      /\b(?:i|we)\s+(?:have|share)\s+[^.!?;\n]{0,45}\b(?:son|daughter|child|children|kids)\b/i.test(part));
    if (/\b(?:my|our)\s+(?:(?:[1-9]\d*|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:son|daughter|child|children|kids)\b/i.test(text) || hasChildClause) candidates.family_children = "Yes";
    else if (/\b(?:no (?:children|kids)|(?:do not|don't|dont) have (?:any )?(?:children|kids))\b/i.test(text)) candidates.family_children = "No";
    const parentingClause = text.split(/[.!?;\n]+/).find((part) => /\b(?:parenting|custody|access to (?:my|our) (?:son|daughter|child|children|kids))\b/i.test(part) && !/\b(?:not seeking|do not want|don't want|no need for|not about)\b/i.test(part));
    if (state.slots.family_help_sought === "Parenting or decision-making" && (parentingClause ||
        /\b(?:not|won't|wont|refus(?:es|ing)|prevent(?:s|ing)?|stopp?ed)\b[^.!?\n]{0,80}\bsee\b[^.!?\n]{0,40}\b(?:my|our)\s+(?:son|daughter|child|children|kids)\b/i.test(text) ||
        /\bkeep(?:s|ing)?\s+me\s+away\s+from\s+(?:my|our)\s+(?:son|daughter|child|children|kids)\b/i.test(text))) {
      candidates.family_help_sought = "Parenting or decision-making";
    }
    // Confirm a proposed help category only when this clause explicitly asks
    // for that help. Unpaid support is not a negation of the request itself.
    const helpValue = state.slots.family_help_sought;
    const explicitRequest = text.split(/[.!?;\n]+/).some((part) => {
      if (/\b(?:not sure|unsure|uncertain|maybe|might|perhaps|whether|if|considering|don't know|do not know|not seeking|not looking for|do not (?:want|need)|don't (?:want|need)|no need|not interested)\b/i.test(part)) return false;
      if (!/\b(?:i|we)\s+(?:need|want|seek|am seeking|are seeking|would like|am looking for|are looking for)\b/i.test(part)) return false;
      if (helpValue === "Child or spousal support") return /\b(?:child|spousal)\s+support\b/i.test(part);
      if (helpValue === "Separation or divorce") return /\b(?:divorce|separat(?:ion|e|ing))\b/i.test(part) && !/\bseparation\s+agreement\b/i.test(part) && !/\b(?:after|since|following)\s+(?:(?:our|my|the)\s+)?(?:separation|divorce)\b/i.test(part);
      if (helpValue === "Agreement or court order") return /\b(?:(?:separation|parenting|written|settlement)\s+agreement|court\s+order)\b/i.test(part);
      return false;
    });
    if (explicitRequest && helpValue) candidates.family_help_sought = helpValue;
    if (/\b(?:i|we)\s+(?:live|reside|are based)\s+in\s+(?:[a-z][a-z .'-]{0,40},\s*)?ontario\b/i.test(text)) candidates.family_jurisdiction = "Ontario";
    const orderValue = state.slots.family_existing_order;
    if (familyNegativeIsGrounded("family_existing_order", "Neither", text)) candidates.family_existing_order = "Neither";
    const orderSentence = text.split(/[.!?;\n]+/).find((part) =>
      !/\b(?:no|not|never|without|unsure|maybe|if)\b/i.test(part) &&
      /\b(?:(?:i|we) have (?:an? |the |existing )?(?:(?:court|parenting) )?order|there is (?:an? |the |existing )?(?:(?:court|parenting) )?order|(?:a |the )?(?:judge|court) (?:made|issued) (?:an? |the )?order|(?:court|parenting) order (?:is |was )?(?:in place|issued|dated))\b/i.test(part));
    if (orderSentence && orderValue !== "Both") candidates.family_existing_order = "Court order";
    const noDateSentence = text.split(/[.!?;\n]+/).map((part) => part.trim()).find((part) =>
      /\bno\s+(?:upcoming\s+)?(?:court\s+)?(?:date|hearing|deadline)\b/i.test(part) &&
      !/\b(?:not sure|unsure|maybe|if|whether|don't know|do not know)\b/i.test(part));
    if (noDateSentence) candidates.family_timing = noDateSentence;
    const datePattern = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;
    const scheduledClauses = text.split(/[.!?;\n]+/).map((part) => part.trim()).filter((part) =>
      /\b(?:case conference|court date|hearing|trial|deadline|respond by|response due)\b/i.test(part) &&
      [...part.matchAll(datePattern)].length === 1 &&
      /\b(?:is|was|scheduled|set|on|by)\b/i.test(part) &&
      !/\b(?:no|not|never|without|unsure|maybe|might|could|if|whether|between|or)\b/i.test(part));
    const scheduledDate = scheduledClauses.length === 1 ? scheduledClauses[0] : undefined;
    if (!noDateSentence && scheduledDate) candidates.family_timing = scheduledDate;
    const date = state.slots.family_timing;
    const dateSentence = date && text.split(/[.!?;\n]+/).find((part) => part.toLowerCase().includes(date.toLowerCase()) && /\b(?:court|hearing|conference|deadline|respond|date)\b/i.test(part) && [...part.matchAll(datePattern)].length <= 1 && !/\b(?:no|not|never|without|unsure|maybe|if|between|or)\b/i.test(part));
    if (!noDateSentence && scheduledClauses.length === 0 && !scheduledDate && date && dateSentence) candidates.family_timing = date;
  }
  const slots = { ...state.slots }; const slot_meta = { ...state.slot_meta };
  for (const [id, value] of Object.entries(candidates)) { slots[id] = value; slot_meta[id] = { source: 'explicit', confidence: 1, evidence: text }; }
  return { ...state, slots, slot_meta };
}

/** Ground a composite negative from two consecutive replies to the same order question. */
export function groundFamilyOrderReplies(state: EngineState, replies: readonly string[]): EngineState {
  if (state.matter_type !== 'family_general' || replies.length < 2) return state;
  const recent = replies.slice(-2);
  if (!/\b(?:no|without|neither)\b/i.test(recent[1])) return state;
  // Do not let an earlier negative override a stated existing order/agreement.
  const positive = /\b(?:(?:there is|we have|i have)\s+(?:an?|the)\s+(?:(?:court|parenting|written|separation)\s+)?(?:order|agreement)|(?:order|agreement)\s+(?:is|remains)\s+(?:in place|active))\b/i;
  if (recent.some(reply => positive.test(reply))) return state;
  const evidence = recent.join('\n');
  if (!familyNegativeIsGrounded('family_existing_order', 'Neither', evidence)) return state;
  return { ...state, slots: { ...state.slots, family_existing_order: 'Neither' },
    slot_meta: { ...state.slot_meta, family_existing_order: { source: 'explicit', confidence: 1, evidence } } };
}
