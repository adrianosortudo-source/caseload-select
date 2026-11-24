import { applySelectedPracticeArea, classify, classificationForMatterType, extractRawSignals, isValidMatterType } from './extractor';
import { getSlotById, SLOT_REGISTRY } from './slotRegistry';
import { runEvidencePass } from './slotEvidence';
import { groundFamilyConversationFacts, groundFamilyOrderReplies } from './family';
import { namesDocumentTask } from './written-answers';
import { canRefineCoveredQuestion, customQuestionPermitted, groundQuestionReview, parseQuestionReview, priorityPending, questionPermitted, type GroundedQuestionReview, type QuestionReview } from './question-policy';
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
  question_review?: QuestionReview;
}

export interface IntakeTurn {
  text: string;
  question?: string;
  answersQuestion?: boolean;
  skipped?: boolean;
  correction: boolean;
}

export interface IntakeReadingState {
  turns: IntakeTurn[];
  currentAccount?: string;
  originalOpening?: string;
  openingCorrected?: boolean;
  /** Exact visitor passages that already addressed an intake question. Not scored facts. */
  coveredQuestions?: Record<string, string>;
  /** An attempted enum mapping exceeded what the visitor actually said. */
  quoteOnlyOptions?: Record<string, string>;
  next?: { slotId: string; question: string; after: number };
  questionReview?: GroundedQuestionReview;
}

/** A bare skip or uncertainty response carries no subject on its own.
 * Longer statements such as “I am unsure whether it was signed” stay intact. */
export function isStandaloneNonAnswer(value: string): boolean {
  return /^(?:(?:i(?: am|'m|’m) )?(?:not sure|unsure)(?: yet)?|i (?:do not|don't|don’t) know|unknown|skip|prefer not to say|no s[eé]|n[aã]o sei|je ne sais pas|不知道|不确定|لا أعرف)[.!?。\s]*$/iu.test(value.trim());
}

export function readIntakeInterpretation(value: unknown): IntakeInterpretation | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<IntakeInterpretation>;
  if (!v.matter || (v.matter !== 'family_general' && v.matter !== 'unknown' && !isValidMatterType(v.matter)) || typeof v.answers_question !== 'boolean'
    || !Array.isArray(v.current_excerpts) || !Array.isArray(v.unsupported_slots)) return;
  const strings = (values: unknown[]) => values.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 24);
  const questionReview = parseQuestionReview(v.question_review);
  return { matter: v.matter, answers_question: v.answers_question,
    superseded_quote: typeof v.superseded_quote === 'string' ? v.superseded_quote.trim() || null : null,
    replacement_goal: typeof v.replacement_goal === 'string' ? v.replacement_goal.trim() || null : null,
    current_excerpts: strings(v.current_excerpts), unsupported_slots: strings(v.unsupported_slots),
    covered_questions: Array.isArray(v.covered_questions) ? v.covered_questions.slice(0, 40).filter(item =>
      item && typeof item.slot_id === 'string' && typeof item.quote === 'string') : [],
    next_slot: typeof v.next_slot === 'string' ? v.next_slot : null,
    next_question: typeof v.next_question === 'string' ? v.next_question.trim() : null,
    ...(questionReview ? { question_review: questionReview } : {}) };
}

export function intakeFollowUp(state: EngineState): SlotDefinition | undefined {
  if (state.contactCaptureStarted || state.insightShown) return;
  return pendingIntakeQuestion(state);
}

export function pendingIntakeQuestion(state: EngineState): SlotDefinition | undefined {
  const next = state.intake_reading?.next;
  if (!next || next.after !== state.questionHistory.length || state.questionHistory.includes(next.slotId)) return;
  const slot = getSlotById(next.slotId);
  if (!slot) return;
  const accepted = slot.id.startsWith('intake_detail_')
    ? customQuestionPermitted(state, next.question)
    : questionPermitted(state, slot);
  return accepted ? { ...slot, question: next.question } : undefined;
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
  state: EngineState, reading: IntakeInterpretation | undefined, latest: string, slotId?: string, actualQuestion?: string, skipped?: boolean,
): EngineState {
  if (!reading || !latest.trim()) return state;
  const old = state.intake_reading;
  const isSkip = skipped === true || (skipped === undefined && isStandaloneNonAnswer(latest));
  const priorTurns = state.question_policy === 'grounded_v1'
    ? (old?.turns ?? []).filter(turn => !turn.skipped) : old?.turns ?? [];
  const prior = [state.input, ...priorTurns.map(turn => turn.text)].join('\n');
  const conversation = state.question_policy === 'grounded_v1' && isSkip ? prior : prior + '\n' + latest;
  const superseded = reading.superseded_quote && prior.includes(reading.superseded_quote) ? reading.superseded_quote : null;
  const quotes = [...new Set(reading.current_excerpts.map(q => q.trim()))].filter(q =>
    q && conversation.includes(q) && (!superseded || !q.includes(superseded)));
  const correction = !!(slotId && superseded && prior.includes(superseded) && quotes.some(q => latest.includes(q))
    && (state.question_policy !== 'grounded_v1' || !isSkip));
  const goal = correction && reading.replacement_goal && latest.includes(reading.replacement_goal)
    ? reading.replacement_goal : undefined;
  // The new interpreter returns a current account on each substantive turn.
  // Accept only exact source excerpts that include this reply. If the reading
  // is missing or ungrounded, retain the earlier account and full history.
  const accountRefresh = state.question_policy === 'grounded_v1' && !!slotId && !isSkip
    && quotes.some(quote => latest.includes(quote))
    && (old?.questionReview?.requests ?? []).every(request =>
      quotes.some(quote => quote.includes(request.quote)) ||
      reading.question_review?.withdrawn_requests?.some(item => item.request_quote === request.quote
        && item.request_matter === request.matter && latest.includes(item.withdrawal_quote)) ||
      !!(goal && superseded?.includes(request.quote)));
  const acceptAccount = state.question_policy === 'grounded_v1' ? accountRefresh : correction;
  const active = acceptAccount
    ? (goal && state.question_policy !== 'grounded_v1' ? latest : [...new Set([...quotes, latest])].join('\n'))
    : old?.currentAccount;
  const previousPrompt = (state.question_policy === 'grounded_v1' ? actualQuestion : undefined)
    ?? (old?.next && old.next.slotId === slotId ? old.next.question : (slotId ? getSlotById(slotId)?.question : undefined));
  const turns = [...old?.turns ?? []];
  const lastCorrection = turns.map(turn => turn.correction).lastIndexOf(true);
  // A corrected fact does not withdraw unrelated work the visitor requested.
  const retainedRequests = correction ? (old?.questionReview?.requests ?? [])
    .filter(request => (!goal || !superseded!.includes(request.quote)) && prior.includes(request.quote)) : [];
  const priorAccount = old?.currentAccount ?? state.input;
  const safePriorAccount = state.question_policy === 'grounded_v1' ? priorAccount.split('\n').filter(line => {
    const wasSkipped = turns.some(turn => turn.skipped && turn.text === line);
    const wasSaid = priorTurns.some(turn => turn.text === line) || state.input.includes(line);
    return !wasSkipped || wasSaid;
  }).join('\n') : priorAccount;
  const sources = correction ? [...quotes, latest, ...retainedRequests.map(request => request.quote)] : [
    safePriorAccount, ...turns.slice(lastCorrection + 1)
      .filter(turn => state.question_policy !== 'grounded_v1' || !turn.skipped).map(turn => turn.text),
    ...(state.question_policy === 'grounded_v1' && isSkip ? [] : [latest]),
  ];
  const questionReview = state.question_policy === 'grounded_v1'
    ? groundQuestionReview(reading.question_review, sources,
      correction ? old?.questionReview && { ...old.questionReview, requests: retainedRequests, priority: undefined, grades: {} } : old?.questionReview,
      slotId === 'written_goal', slotId && !isStandaloneNonAnswer(latest) ? latest : undefined)
    : undefined;
  if (questionReview?.nextIsRepeat && reading.next_slot) questionReview.nextRepeatSlot = reading.next_slot;
  if (questionReview && state.question_policy === 'grounded_v1' && isSkip) {
    questionReview.grades = { ...questionReview.grades };
    for (const [id, grade] of Object.entries(questionReview.grades)) {
      if (grade.status !== 'answered') continue;
      if (old?.questionReview?.grades[id]) questionReview.grades[id] = old.questionReview.grades[id];
      else delete questionReview.grades[id];
    }
  }
  let next: EngineState = { ...state, slots: { ...state.slots }, slot_meta: { ...state.slot_meta },
    slot_evidence: { ...state.slot_evidence }, written_answers: { ...state.written_answers },
    intake_reading: { turns, quoteOnlyOptions: old?.quoteOnlyOptions, currentAccount: active, originalOpening: old?.originalOpening ?? (acceptAccount ? state.input : undefined),
      ...(state.question_policy === 'grounded_v1' ? { openingCorrected: (old?.openingCorrected ?? !!old?.turns.some(turn => turn.correction)) || !!(correction && superseded && state.input.includes(superseded)) } : {}),
      ...(questionReview ? { questionReview } : {}) } };
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
  if (questionReview?.priority) target = questionReview.priority.matter;
  const canReclassify = !(state.question_policy === 'grounded_v1' && isSkip)
    && (!slotId || correction || !!questionReview?.priority || state.matter_type === 'unknown' || state.matter_type.endsWith('_general'));
  const routeChanged = canReclassify && permittedMatter(state, target) && state.matter_type !== target;
  if (routeChanged) {
    const route = target === 'family_general'
      ? { practice_area: 'family' as const, matter_type: target }
      : classificationForMatterType(target);
    next = { ...next, ...route, matter_type_provenance: 'llm_inferred' };
  }
  const pendingPriority = priorityPending(next);
  if (pendingPriority && next.matter_type !== 'out_of_scope') {
    // Avoid presenting the inferred branch as a settled priority. Keep
    // saved answers intact while the visitor chooses which issue to focus on.
    next = applySelectedPracticeArea({ ...next, matter_type: 'unknown' }, state.practice_area);
    next.matter_type_provenance = 'llm_inferred';
  }
  if (correction || routeChanged) {
    for (const id of Object.keys(next.slots)) {
      const slot = getSlotById(id);
      if (!slot || protect(id)) continue;
      const obsolete = slot.applies_to.length > 0 && !slot.applies_to.includes(next.matter_type);
      const inferred = next.slot_meta[id]?.source;
      if ((!pendingPriority && obsolete) || (correction && inferred !== 'answered' && inferred !== 'system_metadata' && inferred !== 'profile_metadata')) remove(id);
    }
  }
  for (const id of reading.unsupported_slots) {
    if (state.question_policy === 'grounded_v1' && isSkip) continue;
    if (correction || next.slot_meta[id]?.source !== 'answered') remove(id);
  }
  if (slotId && !reading.answers_question && !(state.question_policy === 'grounded_v1' && isSkip)) remove(slotId);
  // Remove the prior field hypothesis before re-reading the current evidence.
  // The same ID can now have a different, explicitly supported answer.
  if (active && (correction || routeChanged)) {
    next = runEvidencePass(active, { ...next, raw: extractRawSignals(active) });
    if (next.family_enabled) next = groundFamilyOrderReplies(groundFamilyConversationFacts(next, active), [active]);
  }
  // These statements have the actual question or are recorded as corrections.
  // Do not also publish them under the old slot's possibly unrelated label.
  if (slotId && !(state.question_policy === 'grounded_v1' && isSkip)) for (const [id, value] of Object.entries(next.written_answers ?? {})) {
    if (value === latest) delete next.written_answers![id];
  }
  // A question may already have a useful explicit answer in the person's own
  // words even when its menu cannot safely represent that answer. Retain the
  // passage for the lawyer without setting an enum, earning points, or
  // treating somebody else's claim as the visitor's verified fact.
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
    if (state.question_policy === 'grounded_v1' && isSkip) continue;
    const quote = item.quote.trim();
    if (applicable(item.slot_id) && quote.length >= 3 && quote.length <= 1200
        && sources.some(source => source.includes(quote))
        && (item.slot_id !== slotId || reading.answers_question || sources.some(source => source !== latest && source.includes(quote)))) {
      covered[item.slot_id] = quote;
    }
  }
  for (const grade of Object.values(questionReview?.grades ?? {})) {
    if (grade.status === 'answered' && applicable(grade.slot_id)) covered[grade.slot_id] = grade.quote;
    else if (grade.status === 'disputed') delete covered[grade.slot_id];
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
    if (!answersPrompt && !contextual && !(state.question_policy === 'grounded_v1' && isSkip) && slot?.input_type === 'free_text' && next.slots[slotId] === latest) remove(slotId);
    turns.push(state.question_policy === 'grounded_v1'
      ? { text: latest, question: previousPrompt, answersQuestion: answersPrompt, skipped: isSkip, correction }
      : { text: latest, question: answersPrompt ? previousPrompt : undefined, correction });
  }
  const used = state.questionHistory;
  const authored = reading.next_slot ? getSlotById(reading.next_slot) : undefined;
  if (authored && !questionReview?.nextIsRepeat && authored.applies_to.includes(next.matter_type) && !protect(authored.id)
      && !used.includes(authored.id) && !covered[authored.id] && !next.slots[authored.id] && questionPermitted(next, authored)) {
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
    const rejectedRegistered = state.question_policy === 'grounded_v1' && authored && question
      && !canRefineCoveredQuestion(next, authored, question);
    if (id && question && !rejectedRegistered && !rejectedSubject && !repeatsAuthored && customQuestionPermitted(next, question)
      && question.length <= 260 && /^[^<>\n]+[?？]$/.test(question)
      && !/https?:\/\//i.test(question) && !turns.some(turn => turn.question === question)) {
      next.intake_reading!.next = { slotId: id, question, after: used.length };
    }
  }
  return next;
}
