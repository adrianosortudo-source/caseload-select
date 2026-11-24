import { ALL_MATTER_TYPES, getSlotById, SLOT_REGISTRY } from './slotRegistry';
import type { EngineState, MatterType, SlotDefinition } from './types';

type QuestionStatus = 'missing' | 'answered' | 'disputed' | 'irrelevant';

export interface QuestionReview {
  requests: { quote: string; matter: MatterType }[];
  priority_quote: string | null;
  preferred_request_quote?: string | null;
  custom_basis_quote?: string | null;
  questions: { slot_id: string; status: QuestionStatus; quote: string }[];
}

export interface GroundedQuestionReview {
  requests: QuestionReview['requests'];
  priority?: QuestionReview['requests'][number];
  grades: Record<string, QuestionReview['questions'][number]>;
  customBasis?: string;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length >= 3 && value.trim().length <= 1200
    ? value.trim() : null;
}

function containingStatement(source: string, quote: string): string | undefined {
  return source.split(/(?<=[.!?])\s+|\n+/u).find(statement => statement.includes(quote));
}

const priorityWords = new Set(['first', 'focus', 'priority', 'start', 'with', 'would', 'like', 'want', 'need',
  'help', 'please', 'because', 'then', 'deal', 'handle', 'address', 'review', 'this', 'that', 'instead', 'before']);

function resolveRequest(
  requests: QuestionReview['requests'],
  preferred: string | null | undefined,
  selection: string,
): QuestionReview['requests'][number] | undefined {
  if (preferred) {
    const exact = requests.filter(item => item.quote === preferred);
    if (exact.length === 1) return exact[0];
    const contained = requests.filter(item => item.quote.includes(preferred) || preferred.includes(item.quote));
    if (contained.length === 1) return contained[0];
  }
  const referenced = new Set((selection.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
    .filter(word => !priorityWords.has(word)));
  const matches = requests.filter(item =>
    item.quote.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.some(word => referenced.has(word)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function parseQuestionReview(value: unknown): QuestionReview | undefined {
  if (!value || typeof value !== 'object') return;
  const review = value as Partial<QuestionReview>;
  if (!Array.isArray(review.requests) || !Array.isArray(review.questions)) return;
  const requests = review.requests.slice(0, 8).flatMap(item => {
    const quote = text(item?.quote);
    return quote && ALL_MATTER_TYPES.includes(item.matter) ? [{ quote, matter: item.matter }] : [];
  });
  const statuses: readonly QuestionStatus[] = ['missing', 'answered', 'disputed', 'irrelevant'];
  const questions = review.questions.slice(0, 120).flatMap(item => {
    const quote = text(item?.quote);
    return quote && typeof item.slot_id === 'string' && statuses.includes(item.status)
      ? [{ slot_id: item.slot_id, status: item.status, quote }] : [];
  });
  return {
    requests,
    priority_quote: text(review.priority_quote),
    preferred_request_quote: text(review.preferred_request_quote),
    custom_basis_quote: text(review.custom_basis_quote),
    questions,
  };
}

/** A verbatim citation must come from one current statement, not across turns. */
export function groundQuestionReview(
  review: QuestionReview | undefined,
  sources: readonly string[],
  previous?: GroundedQuestionReview,
  replyingAboutPriority = false,
): GroundedQuestionReview | undefined {
  if (!review) return previous;
  const grounded = (quote: string | null | undefined): quote is string =>
    !!quote && sources.some(source => source.includes(quote));
  const requests: QuestionReview['requests'] = [];
  const offered = review.requests.filter(request => grounded(request.quote));
  for (const candidate of [ ...offered, ...previous?.requests ?? [] ]) {
    if (!grounded(candidate.quote)) continue;
    if (requests.some(item => item.quote.includes(candidate.quote) || candidate.quote.includes(item.quote))) continue;
    requests.push(candidate);
  }
  const selection = review.priority_quote;
  const explicitlyRanks = /\b(?:first|priority|focus on|start with|rather deal with|only need|only want|primeiro|primero|prioridad|prioridade|d’abord|en premier)\b/iu;
  const uncertain = /\b(?:unsure|not sure|don['’]t know|undecided|cannot decide|can['’]t decide|n[aã]o sei|no s[eé]|pas s[uû]r)\b/iu;
  const selected = grounded(selection) &&
    sources.some(source => {
      const statement = containingStatement(source, selection);
      return statement && !uncertain.test(statement) && (replyingAboutPriority || explicitlyRanks.test(statement));
    })
    ? resolveRequest(requests, review.preferred_request_quote, selection)
    : undefined;
  const priority = selected ?? requests.find(item => item.quote === previous?.priority?.quote);
  const grades: GroundedQuestionReview['grades'] = {};
  for (const grade of [ ...Object.values(previous?.grades ?? {}), ...review.questions ]) {
    if (!grounded(grade.quote)) continue;
    const slot = getSlotById(grade.slot_id);
    if (!slot || slot.tier === 'contact') continue;
    if (grades[grade.slot_id]?.status === 'answered' && grade.status === 'missing') continue;
    grades[grade.slot_id] = grade;
  }
  return {
    requests, priority, grades,
    customBasis: grounded(review.custom_basis_quote) ? review.custom_basis_quote : undefined,
  };
}

/** Reuse the old protocol's optional identifiers for questions about the
 * objective and for safe contextual free text. */
export function priorityPending(state: EngineState): boolean {
  const review = state.intake_reading?.questionReview;
  return state.question_policy === 'grounded_v1' && (review?.requests.length ?? 0) > 1 && !review?.priority;
}

const firmQuestions = new Set(['hiring_timeline', 'decision_authority', 'other_counsel']);

/** A small catalogue of words that can support a consequential premise.
 * Classification alone and a quote from unrelated parts of the enquiry
 * cannot support one of these questions. This never populates a slot. */
const premiseClues = {
  payment: /\b(?:unpaid|nonpayment|past due|outstanding balance|owe[sd]?|not (?:been )?paid|haven['’]t paid|hasn['’]t paid|part(?:ially)? paid|refus\w+ to pay|marked it as unpaid)\b/iu,
  dismissal: /\b(?:dismiss\w+|terminated|fired|laid off|let go|ending my employment|never come back|\w+ job ended)\b/iu,
  severance: /\b(?:severance|termination package|separation package|termination offer|termination pay|pay in lieu)\b/iu,
  closing: /\b(?:closing|close on|settlement date|accepted offer|purchase and sale)\b/iu,
  ownership: /\b(?:shareholder|co[- ]?owner|partner|ownership|my shares|our shares)\b/iu,
  irregularity: /\b(?:unexplained|without authori[sz]ation|irregular\w+|embezzl\w+|missing (?:funds|money)|suspicious)\b/iu,
  construction: /\b(?:supplied|deliver\w+|provided|contractor|subcontractor|install\w+)\b/iu,
  dispute: /\b(?:disput\w+|deni\w+|refus\w+|court|suing|sued|claim\w+|contested|disagreement|won['’]t)\b/iu,
};
export type QuestionPremise = keyof typeof premiseClues;

/** Recognise direct statements the model can overlook. A suppression may
 * acknowledge meaning that spans categories without asserting an enum. */
const directCoverage = {
  existing_will: /\b(?:(?:my|our) (?:existing|current) will|(?:updat\w+|chang\w+|revis\w+) (?:my|our) will|(?:have|found|made|left|signed|prepared|drafted) (?:a|an|his|her|my|our|their) (?:signed |valid |written |current )?will|(?:no|without a) will)\b/iu,
  spouse: /\b(?:my (?:spouse|husband|wife) and i|(?:we are|i am|i['’]m) (?:married|single|separated|divorced|widowed|common[- ]law))\b/iu,
  dependants: /\b(?:(?:my|our) (?:\w+ )?(?:children|kids|twins|triplets|child|son|daughter|dependants?)|(?:have|has) (?:no|[1-9]\d*|one|two|three|four|a) (?:children|kids|child|son|daughter|dependants?)|care (?:for|of) (?:my|the|our) children)\b/iu,
  relationship: /\bmy (?:(?:late|deceased) (?:dad|father|mom|mother|parent|spouse|wife|husband|aunt|uncle|brother|sister|child)|(?:dad|father|mom|mother|parent|spouse|wife|husband|aunt|uncle|brother|sister|grandmother|grandfather|child|daughter|son) (?:died|passed away|left a will))\b/iu,
  closing_date: /\b(?:closing|close|settlement)\b[^.!?\n]{0,48}\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+[1-3]?\d\b/iu,
  financing: /\b(?:mortgage|financing|loan)\b[^.!?\n]{0,45}\b(?:pre[- ]?approved|approved|financed|declined|denied)\b/iu,
};
export type QuestionCoverage = keyof typeof directCoverage;

const indirect = /\b(?:presumably|i assume|i thought|i was told|i (?:heard|believe|guess)|maybe|apparently|supposedly|someone (?:says|said|told me)|i (?:am|'m) not sure|(?:if|whether) (?:i|we|they|he|she))\b/iu;
const deniedPremise = /\b(?:not about|no longer|does not owe|doesn['’]t owe|never owed|paid (?:in full|it all|everything)|no (?:debt|dismissal|severance|dispute)|still employed)\b/iu;

function currentSources(state: EngineState): string[] {
  const account = state.intake_reading?.currentAccount ?? state.input;
  const turns = state.intake_reading?.turns ?? [];
  const lastCorrection = turns.map(turn => turn.correction).lastIndexOf(true);
  return [account, ...turns.slice(lastCorrection + 1).map(turn => turn.text)];
}

function hasLiteralPremise(state: EngineState, topic: QuestionPremise, citation: string): boolean {
  if (!premiseClues[topic].test(citation)) return false;
  return currentSources(state).some(source => {
    const statement = containingStatement(source, citation);
    return statement && !indirect.test(statement) && !deniedPremise.test(statement);
  });
}

function directQuote(state: EngineState, topic: QuestionCoverage): string | undefined {
  for (const source of currentSources(state)) {
    const statements = source.split(/(?<=[.!?])\s+|\n+/u);
    const quote = statements.find(statement => !indirect.test(statement) && directCoverage[topic].test(statement));
    if (quote) return quote.trim();
  }
}

export function groundedCoverage(state: EngineState, slot: SlotDefinition): string | undefined {
  if (state.question_policy !== 'grounded_v1') return;
  const review = state.intake_reading?.questionReview;
  const grade = review?.grades[slot.id];
  if (grade?.status === 'answered') return grade.quote;
  if (grade?.status === 'disputed' || grade?.status === 'irrelevant') return;
  return slot.question_coverage && directQuote(state, slot.question_coverage);
}

export function questionPermitted(state: EngineState, slot: SlotDefinition): boolean {
  if (state.question_policy !== 'grounded_v1' || slot.tier === 'contact') return true;
  if (state.questionHistory.includes(slot.id) || priorityPending(state)) return false;
  if (groundedCoverage(state, slot) || state.intake_reading?.coveredQuestions?.[slot.id]) return false;
  const reading = state.intake_reading;
  const grade = reading?.questionReview?.grades[slot.id];
  if (grade && grade.status !== 'missing') return false;
  if (firmQuestions.has(slot.id)) return true;
  if (!grade) return false;
  if (!slot.question_premise) return true;
  return hasLiteralPremise(state, slot.question_premise, grade.quote);
}

const goalQuestion = getSlotById('written_goal');

export function priorityQuestion(state: EngineState): SlotDefinition | undefined {
  return priorityPending(state) && !state.questionHistory.includes('written_goal') ? goalQuestion : undefined;
}

function authoredTextAllowed(state: EngineState, question: string, basis: string): boolean {
  // Semantic review chooses the purpose and source. These checks prevent a
  // generated question from asserting one of the catalogue's material
  // premises without independently recognizable evidence in that passage.
  const passage = currentSources(state).map(source => containingStatement(source, basis)).find(Boolean);
  if (!passage) return false;
  if (indirect.test(passage) || deniedPremise.test(passage)) {
    if (/\b(?:why (?:did|are|has)|when did|how much (?:is|are) owed)\b/iu.test(question)) return false;
  }
  for (const topic of Object.keys(premiseClues) as QuestionPremise[]) {
    if (premiseClues[topic].test(question) && !hasLiteralPremise(state, topic, basis)) return false;
  }
  return true;
}

export function customQuestionPermitted(state: EngineState, question: string): boolean {
  if (state.question_policy !== 'grounded_v1') return true;
  const review = state.intake_reading?.questionReview;
  if (!review?.customBasis || priorityPending(state) || !authoredTextAllowed(state, question, review.customBasis)) return false;
  const directTopic = [
    ['existing_will', /\b(?:do|did) (?:you|they|he|she) (?:currently )?have (?:an? |any )?will\b|\bis there (?:an? |any )?will\b/iu],
    ['spouse', /\b(?:what is your marital status|are you married|do you have a spouse)\b/iu],
    ['dependants', /\b(?:do you have|how many) (?:any )?(?:children|kids|dependants?)\b/iu],
    ['relationship', /\bwhat (?:is|was) your relationship (?:to|with)\b/iu],
    ['closing_date', /\bwhen (?:is|will) (?:the |your )?(?:closing|you close)\b/iu],
  ] as const;
  return !directTopic.some(([topic, wording]) => wording.test(question) && directQuote(state, topic));
}

export function neutralQuestion(state: EngineState): SlotDefinition | undefined {
  if (state.question_policy !== 'grounded_v1' || priorityPending(state)) return;
  const review = state.intake_reading?.questionReview;
  const used = state.questionHistory;
  if (!review?.requests.length && !used.includes('written_goal')) return goalQuestion;
  const remaining = SLOT_REGISTRY.some(slot => {
    const status = review?.grades[slot.id]?.status;
    return status === 'missing' && slot.applies_to.includes(state.matter_type)
      && !state.slots[slot.id] && questionPermitted(state, slot);
  });
  if (remaining || used.some(id => id.startsWith('intake_detail_') || id === 'written_timing')) return;
  const account = state.intake_reading?.currentAccount ?? state.input;
  const timingDiscussed = /\b(?:deadline|due|respond by|before|sign by|court date|closing|hearing date|no (?:date|deadline)|(?:\d{1,2}[\/-]){2}\d{2,4})\b/iu.test(account)
    || used.some(id => /(?:deadline|timing|timeline|when|urgency)/i.test(id));
  return timingDiscussed ? getSlotById('intake_detail_1') : getSlotById('written_timing');
}
