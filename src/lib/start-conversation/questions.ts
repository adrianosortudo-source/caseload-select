/**
 * The Start a Conversation flow: question set, option lists, outcome rule.
 *
 * Pure and dependency-free on purpose. Both the browser component and the
 * server route import this module, so the options a visitor can click and
 * the options the server will accept are the same list by construction.
 * A drifting copy on either side is how a "closed option list" quietly
 * becomes an open text field.
 *
 * Every visitor-facing string here is Adriano's approved copy
 * (BUILD_PLAN_start_conversation_flow_v1.md section 2, approved 2026-08-07)
 * and is reproduced verbatim. Do not paraphrase, retitle, or reorder.
 */

export type QuestionId =
  | 'practice_area'
  | 'firm_size'
  | 'prompt_reason'
  | 'decision_role'
  | 'timeline';

export interface QuestionOption {
  /** Stored value. Stable across copy edits; never shown to a visitor. */
  value: string;
  /** Visitor-facing label. Approved copy, verbatim. */
  label: string;
  /**
   * When true, choosing this option reveals a short free-text line so the
   * visitor can say what the closed list could not hold. Never a gate.
   */
  revealsText?: boolean;
}

export interface Question {
  id: QuestionId;
  /** Approved copy, verbatim. */
  prompt: string;
  options: QuestionOption[];
  /** Column that carries the free-text answer, when the question has one. */
  otherField?: 'practice_area_other' | 'prompt_reason_other';
}

export const QUESTIONS: readonly Question[] = [
  {
    id: 'practice_area',
    prompt: 'What kind of law does your firm practice?',
    otherField: 'practice_area_other',
    options: [
      { value: 'family', label: 'Family' },
      { value: 'real_estate', label: 'Real estate' },
      { value: 'corporate_commercial', label: 'Corporate and commercial' },
      { value: 'wills_estates', label: 'Wills and estates' },
      { value: 'personal_injury', label: 'Personal injury' },
      { value: 'criminal', label: 'Criminal' },
      { value: 'immigration', label: 'Immigration' },
      { value: 'employment', label: 'Employment' },
      { value: 'something_else', label: 'Something else', revealsText: true },
    ],
  },
  {
    id: 'firm_size',
    prompt: 'How many lawyers work at the firm?',
    options: [
      { value: 'just_me', label: 'Just me' },
      { value: '2_to_4', label: '2 to 4' },
      { value: '5_to_9', label: '5 to 9' },
      { value: '10_or_more', label: '10 or more' },
    ],
  },
  {
    id: 'prompt_reason',
    prompt: 'What prompted you to reach out now?',
    otherField: 'prompt_reason_other',
    options: [
      { value: 'too_few_inquiries', label: 'Too few inquiries' },
      { value: 'wrong_kind_of_inquiries', label: 'The wrong kind of inquiries' },
      { value: 'inquiries_go_quiet', label: 'Inquiries go quiet after the first contact' },
      { value: 'starting_a_firm', label: "I'm starting a firm" },
      { value: 'something_else', label: 'Something else', revealsText: true },
    ],
  },
  {
    id: 'decision_role',
    prompt: 'Who decides on marketing spend at the firm?',
    options: [
      { value: 'i_do', label: 'I do' },
      { value: 'i_share', label: 'I share the decision' },
      { value: 'someone_else', label: 'Someone else' },
    ],
  },
  {
    id: 'timeline',
    prompt: 'When would you want the work to start?',
    options: [
      { value: 'this_month', label: 'This month' },
      { value: 'this_quarter', label: 'This quarter' },
      { value: 'researching', label: "I'm just researching" },
    ],
  },
] as const;

/** Approved copy, verbatim. Section 2.3. */
export const CONTACT_HEADING = 'Where should the reply go?';

/** Approved copy, verbatim. Section 2.4. */
export const CONSENT_LABEL =
  'I agree that CaseLoad Select may contact me about this inquiry by email.';

/**
 * Version stamp frozen onto every consent record. Bump this whenever
 * CONSENT_LABEL changes so historical evidence keeps saying what the
 * visitor actually agreed to rather than what the current build says.
 */
export const CONSENT_TEXT_VERSION = 'start-conversation-v1';

/** Approved copy, verbatim. Section 2.4. */
export const SUBMIT_LABEL = 'Send it to Adriano';

export type Outcome = 'booking' | 'reply';

/**
 * The outcome rule (section 2.6, approved). Booking shows when the visitor
 * both holds or shares the spend decision AND wants to start inside the
 * quarter. Everything else gets the reply promise.
 *
 * Banding is internal. It changes which closing screen renders and nothing
 * else: both outcomes submit the same payload, both persist, both notify.
 * There is no automatic decline anywhere in this flow, because the Screen's
 * own published rule applies to its maker.
 */
export function resolveOutcome(input: {
  decision_role: string;
  timeline: string;
}): Outcome {
  const decides = input.decision_role === 'i_do' || input.decision_role === 'i_share';
  const soon = input.timeline === 'this_month' || input.timeline === 'this_quarter';
  return decides && soon ? 'booking' : 'reply';
}

/** Approved copy, verbatim. Section 2.5, the fit ending. */
export const BOOKING_HEADING = 'Pick a time.';
export const BOOKING_BODY =
  "Your answers are already on Adriano's desk. Choose a time that works, and the conversation starts from what you wrote.";

/** Approved copy, verbatim. Section 2.5, the everyone-else ending. */
export const REPLY_HEADING = 'Adriano will reply within one business day.';
export const REPLY_BODY =
  'Your answers arrived as a brief, the same way the Screen delivers an inquiry to a lawyer. The reply comes from him, and it starts from what you wrote.';

/** Lookup helpers shared by the validator and the brief builder. */
export function questionById(id: QuestionId): Question {
  const found = QUESTIONS.find((q) => q.id === id);
  if (!found) throw new Error(`unknown question id: ${id}`);
  return found;
}

export function labelForValue(id: QuestionId, value: string): string | null {
  return questionById(id).options.find((o) => o.value === value)?.label ?? null;
}

export function isValidValue(id: QuestionId, value: string): boolean {
  return questionById(id).options.some((o) => o.value === value);
}

export function optionRevealsText(id: QuestionId, value: string): boolean {
  return questionById(id).options.some((o) => o.value === value && o.revealsText === true);
}
