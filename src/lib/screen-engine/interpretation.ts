import { applySelectedPracticeArea, classify, classificationForMatterType, extractRawSignals, isValidMatterType } from './extractor';
import { getSlotById, SLOT_REGISTRY } from './slotRegistry';
import { runEvidencePass } from './slotEvidence';
import { groundFamilyConversationFacts, groundFamilyOrderReplies } from './family';
import { namesDocumentTask } from './written-answers';
import type { EngineState, MatterType, SlotDefinition } from './types';

export interface IntakeInterpretation {
  matter: MatterType;
  answers_question: boolean;
  superseded_quote: string | null;
  replacement_goal?: string | null;
  current_excerpts: string[];
  unsupported_slots: string[];
  covered_questions?: { slot_id: string; quote: string }[];
  next_slot: string | null;
  next_question: string | null;
}

export interface IntakeTurn {
  text: string;
  question?: string;
  correction: boolean;
}

export interface IntakeReadingState {
  turns: IntakeTurn[];
  currentAccount?: string;
  originalOpening?: string;
  /** Exact visitor passages that already addressed an intake question. Not scored facts. */
  coveredQuestions?: Record<string, string>;
  next?: { slotId: string; question: string; after: number };
}

export function readIntakeInterpretation(value: unknown): IntakeInterpretation | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<IntakeInterpretation>;
  if (!v.matter || (v.matter !== 'family_general' && v.matter !== 'unknown' && !isValidMatterType(v.matter)) || typeof v.answers_question !== 'boolean'
    || !Array.isArray(v.current_excerpts) || !Array.isArray(v.unsupported_slots)) return;
  const strings = (values: unknown[]) => values.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 24);
  return { matter: v.matter, answers_question: v.answers_question,
    superseded_quote: typeof v.superseded_quote === 'string' ? v.superseded_quote.trim() || null : null,
    replacement_goal: typeof v.replacement_goal === 'string' ? v.replacement_goal.trim() || null : null,
    current_excerpts: strings(v.current_excerpts), unsupported_slots: strings(v.unsupported_slots),
    covered_questions: Array.isArray(v.covered_questions) ? v.covered_questions.slice(0, 40).filter(item =>
      item && typeof item.slot_id === 'string' && typeof item.quote === 'string') : [],
    next_slot: typeof v.next_slot === 'string' ? v.next_slot : null,
    next_question: typeof v.next_question === 'string' ? v.next_question.trim() : null };
}

export function intakeFollowUp(state: EngineState): SlotDefinition | undefined {
  if (state.contactCaptureStarted || state.insightShown) return;
  return pendingIntakeQuestion(state);
}

export function pendingIntakeQuestion(state: EngineState): SlotDefinition | undefined {
  const next = state.intake_reading?.next;
  if (!next || next.after !== state.questionHistory.length || state.questionHistory.includes(next.slotId)) return;
  const slot = getSlotById(next.slotId);
  return slot ? { ...slot, question: next.question } : undefined;
}

const protect = (id: string) => getSlotById(id)?.tier === 'contact' ||
  ['hiring_timeline','decision_authority','other_counsel'].includes(id);

function permittedMatter(state: EngineState, proposed: MatterType): boolean {
  if (proposed === 'unknown' || proposed === 'out_of_scope' || state.matter_type === 'out_of_scope') return false;
  if (state.family_only) return proposed === 'family_general';
  return proposed !== 'family_general' || state.family_enabled === true;
}

// Only a quoted change of objective reaches these checks. A menu value
// mentioned outside an affirmative clause cannot establish what was requested.
function affirmativeClauses(text: string): string[] {
  return text.split(/[.!?;,:\n]+|\s+but\s+/i).map(part => part.trim()).filter(part => part &&
    !/\b(?:not|no|never|without|denies?|might|maybe|if|whether|unsure|assume[d]?|told|apparently|claims?|says?|said)\b|n['’]t\b/i.test(part));
}

function goalSupportsRoute(goal: string, target: MatterType, reading: IntakeInterpretation, latest: string): boolean {
  const candidates = SLOT_REGISTRY.filter(slot => slot.applies_to.includes(target) && !protect(slot.id));
  // A cited, pack-specific question is independent evidence of the route.
  const cited = reading.covered_questions?.some(item => item.quote.trim().length >= 3 && latest.includes(item.quote)
    && candidates.some(slot => slot.id === item.slot_id && slot.applies_to.length === 1));
  if (cited) return true;
  const suggested = candidates.find(slot => slot.id === reading.next_slot && slot.applies_to.length === 1);
  if (!suggested) return false;
  // A specific route word and a different term from that pack must both occur
  // in the request. Generic actions such as reviewing papers do not qualify.
  const generic = new Set(['general','real','estate','review','recovery','advisory','dispute','litigation','services','setup','drafting']);
  const routeWords = target.split('_').filter(word => word.length >= 4 && !generic.has(word));
  const catalogueWords = new Set(candidates.filter(slot => slot.applies_to.length === 1)
    .flatMap(slot => (slot.options ?? []).flatMap(option => option.label.toLowerCase().match(/[a-z]{4,}/g) ?? [])));
  return affirmativeClauses(goal).some(clause => {
    const words: string[] = clause.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    return routeWords.some(word => words.includes(word)) &&
      words.some(word => !generic.has(word) && !routeWords.includes(word) && catalogueWords.has(word)
        && !['what','that','with','have','want','need','about','some','first','help','other','more','than','this','only','kind'].includes(word));
  });
}

/** A precise option or goal already supplied by the visitor can suppress a
 * repeat question. It never sets an enum value or awards score. */
function coverChangedGoal(matter: MatterType, goal: string, covered: Record<string,string>) {
  const clauses = affirmativeClauses(goal);
  const slots = SLOT_REGISTRY.filter(slot => slot.applies_to.includes(matter) && !protect(slot.id));
  for (const slot of slots) {
    if (covered[slot.id]) continue;
    if (/^what (?:kind|type) of (?:contract|document|paperwork)/i.test(slot.question)) {
      const document = clauses.find(namesDocumentTask);
      if (document) { covered[slot.id] = document; continue; }
    }
    if (/^what (?:kind of (?:legal |business )?help do you need|are you hoping to (?:achieve|resolve)|best describes (?:what you need help with|the situation))\b/i.test(slot.question)) {
      covered[slot.id] = goal;
      continue;
    }
    for (const option of slot.options ?? []) {
      const label = option.label.toLowerCase();
      if (label.length < 5 || !/^[a-z ]+$/.test(label) ||
          /^(?:not sure|unknown|other|none|all|both|yes|no|prefer|a mix)/.test(label)) continue;
      // Common administrative labels recur across independent questions.
      if (slots.some(other => other.id !== slot.id && other.options?.some(item => item.label.toLowerCase() === label))) continue;
      const quote = clauses.find(clause => (' '+clause.toLowerCase().replace(/[^a-z ]/g,' ')+' ').includes(' '+label+' '));
      if (quote) { covered[slot.id] = quote; break; }
    }
  }
}

/** Apply a reading to the same state used for question selection, scoring, and the lawyer's brief. */
export function applyIntakeInterpretation(
  state: EngineState, reading: IntakeInterpretation | undefined, latest: string, slotId?: string,
): EngineState {
  if (!reading || !latest.trim()) return state;
  const old = state.intake_reading;
  const prior = [state.input, ...(old?.turns ?? []).map(turn => turn.text)].join('\n');
  const conversation = prior + '\n' + latest;
  const superseded = reading.superseded_quote;
  const quotes = [...new Set(reading.current_excerpts.map(q => q.trim()))].filter(q =>
    q && conversation.includes(q) && (!superseded || !q.includes(superseded)));
  const correction = !!(slotId && superseded && prior.includes(superseded) && quotes.some(q => latest.includes(q)));
  const goal = correction && reading.replacement_goal && latest.includes(reading.replacement_goal)
    ? reading.replacement_goal : undefined;
  const active = correction ? (goal ? latest : [...new Set([...quotes, latest])].join('\n')) : old?.currentAccount;
  const previousPrompt = old?.next && old.next.slotId === slotId ? old.next.question : (slotId ? getSlotById(slotId)?.question : undefined);
  const turns = [...old?.turns ?? []];
  let next: EngineState = { ...state, slots: { ...state.slots }, slot_meta: { ...state.slot_meta },
    slot_evidence: { ...state.slot_evidence }, written_answers: { ...state.written_answers },
    intake_reading: { turns, currentAccount: active, originalOpening: old?.originalOpening ?? (correction ? state.input : undefined) } };
  const remove = (id: string) => {
    if (protect(id)) return;
    delete next.slots[id]; delete next.slot_meta[id]; delete next.slot_evidence[id]; delete next.written_answers![id];
  };
  let target = reading.matter;
  if (goal) {
    // A category may imply a legal service or a dispute the visitor never
    // described. A changed engagement needs corroboration before we switch
    // to a specific pack. A broad intake can still ask about the new objective.
    const fromGoal = classify(goal, state.practice_area).matter_type;
    const supportedSpecific = permittedMatter(state, fromGoal) && !fromGoal.endsWith('_general');
    const broadProposal = permittedMatter(state, target) && (target.endsWith('_general') || target === 'general_counsel_advisory');
    if (supportedSpecific && (target === fromGoal || target === state.matter_type)) target = fromGoal;
    else if (!broadProposal && !(permittedMatter(state,target) && goalSupportsRoute(goal,target,reading,latest))) {
      target = applySelectedPracticeArea({ ...state, matter_type: 'unknown' }, state.practice_area).matter_type;
    }
  }
  const canReclassify = !slotId || correction || state.matter_type === 'unknown' || state.matter_type.endsWith('_general');
  const routeChanged = canReclassify && permittedMatter(state, target) && state.matter_type !== target;
  if (routeChanged) {
    const route = target === 'family_general'
      ? { practice_area: 'family' as const, matter_type: target }
      : classificationForMatterType(target);
    next = { ...next, ...route, matter_type_provenance: 'llm_inferred' };
  }
  if (correction || routeChanged) {
    for (const id of Object.keys(next.slots)) {
      const slot = getSlotById(id);
      if (!slot || protect(id)) continue;
      const obsolete = slot.applies_to.length > 0 && !slot.applies_to.includes(next.matter_type);
      const inferred = next.slot_meta[id]?.source;
      if (obsolete || (correction && inferred !== 'answered' && inferred !== 'system_metadata' && inferred !== 'profile_metadata')) remove(id);
    }
  }
  for (const id of reading.unsupported_slots) {
    if (correction || next.slot_meta[id]?.source !== 'answered') remove(id);
  }
  if (slotId && !reading.answers_question) remove(slotId);
  // Remove the prior field hypothesis before re-reading the current evidence.
  // The same ID can now have a different, explicitly supported answer.
  if (active && (correction || routeChanged)) {
    next = runEvidencePass(active, { ...next, raw: extractRawSignals(active) });
    if (next.family_enabled) next = groundFamilyOrderReplies(groundFamilyConversationFacts(next, active), [active]);
  }
  // These statements have the actual question or are recorded as corrections.
  // Do not also publish them under the old slot's possibly unrelated label.
  if (slotId) for (const [id, value] of Object.entries(next.written_answers ?? {})) {
    if (value === latest) delete next.written_answers![id];
  }
  // A question may already have a useful explicit answer in the person's own
  // words even when its menu cannot safely represent that answer. Retain the
  // passage for the lawyer without setting an enum, earning points, or
  // treating somebody else's claim as the visitor's verified fact.
  const priorTurns = old?.turns ?? [];
  const lastCorrection = priorTurns.map(turn => turn.correction).lastIndexOf(true);
  const sources = correction ? [...quotes, latest] : [
    old?.currentAccount ?? state.input, ...priorTurns.slice(lastCorrection + 1).map(turn => turn.text), latest,
  ];
  const covered: Record<string, string> = {};
  const applicable = (id: string) => {
    const slot = getSlotById(id);
    return !!slot && !protect(id) && slot.applies_to.includes(next.matter_type)
      && (!reading.unsupported_slots.includes(id) || next.slot_meta[id]?.source === 'explicit');
  };
  if (!correction) {
    for (const [id,quote] of Object.entries(old?.coveredQuestions ?? {})) {
      if (applicable(id)) covered[id] = quote;
    }
  }
  for (const item of reading.covered_questions ?? []) {
    const quote = item.quote.trim();
    if (applicable(item.slot_id) && quote.length >= 3 && quote.length <= 1200
        && sources.some(source => source.includes(quote))
        && (item.slot_id !== slotId || reading.answers_question || sources.some(source => source !== latest && source.includes(quote)))) {
      covered[item.slot_id] = quote;
    }
  }
  if (goal) coverChangedGoal(next.matter_type, goal, covered);
  if (Object.keys(covered).length) next.intake_reading!.coveredQuestions = covered;
  if (slotId) {
    const slot = getSlotById(slotId);
    const directChoice = slot?.options?.some(option => option.value === next.slots[slotId])
      && next.slot_meta[slotId]?.source === 'answered';
    const citedReply = !!covered[slotId] && latest.includes(covered[slotId]);
    const contextual = slotId.startsWith('intake_detail_');
    const answersPrompt = reading.answers_question && (directChoice || citedReply || contextual);
    if (!answersPrompt && !contextual && slot?.input_type === 'free_text' && next.slots[slotId] === latest) remove(slotId);
    turns.push({ text: latest, question: answersPrompt ? previousPrompt : undefined, correction });
  }
  const used = state.questionHistory;
  const authored = reading.next_slot ? getSlotById(reading.next_slot) : undefined;
  if (authored && authored.applies_to.includes(next.matter_type) && !protect(authored.id)
      && !used.includes(authored.id) && !covered[authored.id] && !next.slots[authored.id]) {
    next.intake_reading!.next = { slotId: authored.id, question: authored.question, after: used.length };
  } else {
    const question = reading.next_question;
    const id = ['intake_detail_1','intake_detail_2'].find(item => !used.includes(item));
    // Never disguise a rejected old-pack or answered catalogue question as
    // a brand-new free-text question. This can happen after a reclassification.
    const repeatsAuthored = !!question && SLOT_REGISTRY.some(slot =>
      slot.question.trim().toLowerCase() === question.trim().toLowerCase()
      && (!slot.applies_to.includes(next.matter_type) || protect(slot.id) || !!covered[slot.id]
        || used.includes(slot.id) || !!next.slots[slot.id]));
    const rejectedSubject = !!(goal && authored && (!authored.applies_to.includes(next.matter_type) || covered[authored.id]));
    if (id && question && !rejectedSubject && !repeatsAuthored && question.length <= 260 && /^[^<>\n]+[?？]$/.test(question)
      && !/https?:\/\//i.test(question) && !turns.some(turn => turn.question === question)) {
      next.intake_reading!.next = { slotId: id, question, after: used.length };
    }
  }
  return next;
}
