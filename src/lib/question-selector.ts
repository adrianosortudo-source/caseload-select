/**
 * Dynamic Question Selector  -  S10.3 + Sub-Type Routing
 *
 * Replaces hard-coded Phase 2/3 split (slice(0,6)/slice(6)) with
 * priority-based selection driven by the slot schema.
 *
 * Priority → routing:
 *   5 (critical) + 4 (high) → primary batch, served to all bands
 *   3 (moderate)            → refinement batch, Band B/C only
 *   2 (low) + 1 (minimal)  → not served in widget mode (pre-finalize admin only)
 *
 * Falls back to position-based priority (questions 0–5 = priority 4,
 * questions 6+ = priority 3) when no slot schema entry exists for a question.
 * This preserves backward compatibility for any practice areas not yet in
 * the slot schema, while immediately benefiting those that are.
 *
 * Sub-type routing: practiceAreaId may now be a sub-type key (e.g. "pi_slip_fall").
 * getSlotSchema handles this transparently via sub-type namespace lookup.
 */

import { getSlotSchema } from "@/lib/slot-schema";
import type { Question } from "@/lib/screen-prompt";

/** Inline follow-up question attached to one option of a parent question. */
export interface FollowUpQuestion {
  id: string;
  text: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
  allow_free_text?: boolean;
}

/** Shape of a question as returned to the widget. */
export interface ShapedQuestion {
  id: string;
  text: string;
  options: Array<{
    label: string;
    value: string;
    /** Inline follow-up rendered when this option is selected. */
    followUp?: FollowUpQuestion;
  }>;
  allow_free_text: boolean;
  /** One-sentence context shown as grey subtext beneath the question label. */
  description?: string;
  /** "structured" (default) = option buttons / input; "info" = contextual block, no answer required; "date" = date picker, stores ISO string; "file" = file upload, stores storage URL. */
  type?: "structured" | "info" | "date" | "file";
  /**
   * Client-side conditional: hide this question when a sibling answer matches.
   * Key: sibling question ID. Value: answer values that suppress this question.
   * The widget evaluates this reactively as the user selects answers.
   */
  excludeWhen?: Record<string, string[]>;
}

export type QuestionPhase = "primary" | "refinement" | "identity";

export interface QuestionBatch {
  /** Questions to serve in this batch. Empty when phase is "identity". */
  questions: ShapedQuestion[];
  /** Which phase this batch belongs to. "identity" means all questions are done. */
  phase: QuestionPhase;
}

/**
 * Infer which question IDs are already answered by the client's situation text.
 * Returns question IDs that should be treated as confirmed without being explicitly answered.
 * Covers Rule 18 redundancy traps: questions whose answers are present in the original message.
 */
/**
 * Normalize free-text input so downstream matching is robust to Unicode,
 * punctuation, and whitespace variants. Applied ONCE at the entry point —
 * every pattern below assumes normalized input.
 *
 *   - Curly apostrophes / primes → ASCII '        (U+2018/2019/02BC/FF07 → ')
 *   - En/em dashes                → ASCII -        (U+2013/2014 → -)
 *   - Curly quotes                → ASCII "        (U+201C/201D → ")
 *   - Collapse whitespace         (\s+ → single space)
 *   - Lowercase                    (all patterns can drop the /i flag)
 *
 * Why this matters: users type with phone keyboards (smart-quote substitution),
 * paste from Word (em-dashes, curly quotes), or use voice-to-text (extra spaces).
 * Without normalization, every regex needs to enumerate every variant — brittle.
 */
function normalize(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Infer which question IDs are already answered by the client's situation text.
 *
 * Architectural note: regex heuristics are a SAFETY NET. The authoritative
 * inference should come from the LLM in /api/screen — it's already parsing the
 * message and can return `implied_question_ids` alongside extracted facts.
 * When that's wired, this function becomes a belt-and-suspenders backstop for
 * obvious cases the LLM might miss.
 *
 * All patterns below operate on normalized (lowercased, ASCII-punctuation) text.
 */
export function inferImpliedAnswers(messageText: string, questions: Question[]): Set<string> {
  const implied = new Set<string>();
  const msg = normalize(messageText);

  // Timing: client stated when the event happened.
  const timingIds = questions.filter(q => /when did|when (did|was|were|have)|how long ago/i.test(q.text)).map(q => q.id);
  if (timingIds.length > 0) {
    const timingPresent = /\b(yesterday|today|last (week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d+ (days?|weeks?|months?|years?) ago|in (january|february|march|april|may|june|july|august|september|october|november|december)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}\/\d{1,2}(\/\d{2,4})?|january|february|march|april|june|july|august|september|october|november|december)\b/;
    if (timingPresent.test(msg)) {
      for (const id of timingIds) implied.add(id);
    }
  }

  // Witnesses: client describes the incident from first-person observation.
  // If the client states what the other party did (ran a red light, hit me, etc.),
  // they were present, making "Were there any witnesses?" a redundancy trap.
  const witnessIds = questions.filter(q => /witness/i.test(q.text)).map(q => q.id);
  if (witnessIds.length > 0) {
    const firstPersonFault = /\b(ran (a|the) red light|ran (a|the) stop sign|didn'?t stop|failed to yield|was speeding|hit (me|my|us)|rear.ended (me|us|my)|cut (me|us) off|swerved into|came out of nowhere|struck (me|us)|t-bone[d]?|sideswiped)\b/;
    if (firstPersonFault.test(msg)) {
      for (const id of witnessIds) implied.add(id);
    }
  }

  // Medical TREATMENT: client explicitly stated whether they sought treatment.
  // Covers both "didn't go to hospital" and "went to ER / got treatment" patterns.
  // IMPORTANT: scoped to treatment-seeking questions only. Questions about
  // injury EXISTENCE (e.g. "Are you experiencing any injuries now?") are NOT
  // implied by "didn't go to hospital"  -  people can be injured without
  // seeking treatment, so the two states are independent.
  const medicalIds = questions
    .filter(q => /medical treatment|hospital|treatment for|see (a )?doctor|seen (a )?doctor|hospitaliz/i.test(q.text))
    .map(q => q.id);
  if (medicalIds.length > 0) {
    const noTreatment = /\b(didn'?t\s+(go to|visit|attend|see)\s+(the\s+)?(hospital|er|emergency|doctor|clinic)|haven'?t\s+(been\s+to\s+(the\s+)?hospital|seen\s+(a\s+)?doctor|received\s+(any\s+)?treatment|gotten\s+(any\s+)?treatment)|no\s+(medical\s+)?treatment|not\s+treated|didn'?t\s+seek\s+(medical\s+)?treatment|skipped\s+(the\s+)?(hospital|er|doctor))\b/;
    const hadTreatment = /\b(went to (the )?(hospital|er|emergency room|clinic|doctor)|got treatment|received treatment|treated (at|by)|had surgery|ambulance|hospitalized|taken to (the )?(hospital|er))\b/;
    if (noTreatment.test(msg) || hadTreatment.test(msg)) {
      for (const id of medicalIds) implied.add(id);
    }
  }

  return implied;
}

/**
 * Select the next batch of questions to serve to the client.
 *
 * @param allQuestions   Full ordered question list from the question set.
 * @param practiceAreaId Short PA ID (e.g. "pi", "emp", "fam").
 * @param confirmed      Current confirmed answers: question IDs already filled.
 * @param band           Current CPI band ("A" | "B" | "C" | "D" | "E").
 * @param messageText    Original situation message, used to skip redundant questions.
 * @returns              QuestionBatch  -  questions to serve, or phase="identity" if done.
 */
export function selectNextQuestions(
  allQuestions: Question[],
  practiceAreaId: string,
  confirmed: Record<string, unknown>,
  band: string,
  messageText?: string,
): QuestionBatch {
  const slotSchema = getSlotSchema(practiceAreaId);

  // Merge implied answers (inferred from original message) with confirmed answers
  const implied = messageText ? inferImpliedAnswers(messageText, allQuestions) : new Set<string>();
  const effectiveConfirmed = implied.size > 0
    ? { ...confirmed, ...Object.fromEntries([...implied].map(id => [id, "__implied__"])) }
    : confirmed;

  // Enrich each question with its slot schema priority.
  // Fall back to position-based priority for questions not in the schema:
  //   positions 0–5 → priority 4 (was "Phase 2")
  //   positions 6+  → priority 3 (was "Phase 3")
  const enriched = allQuestions.map((q, index) => {
    const meta = slotSchema[q.id];
    const priority = meta?.priority ?? (index < 6 ? 4 : 3);
    // Merge requires from slot schema, falling back to what's on the question itself
    const requires =
      meta?.requires ??
      (q as Question & { requires?: string[] }).requires ??
      [];
    const excludeWhen = (q as Question & { excludeWhen?: Record<string, string[]> }).excludeWhen ?? null;
    return { ...q, _priority: priority, _requires: requires, _excludeWhen: excludeWhen };
  });

  // 1. Remove already-confirmed questions (including implied ones)
  const unanswered = enriched.filter(q => !(q.id in effectiveConfirmed));

  // 2. Apply `requires` gate  -  question is only eligible when all prerequisites are filled
  // 3. Apply `excludeWhen` gate  -  question is suppressed when a prior answer matches a value
  const eligible = unanswered.filter(q => {
    if (q._requires.length > 0 && !q._requires.every(reqId => reqId in effectiveConfirmed)) return false;
    if (q._excludeWhen) {
      for (const [depId, blockedValues] of Object.entries(q._excludeWhen)) {
        const answered = effectiveConfirmed[depId];
        if (typeof answered === "string" && blockedValues.includes(answered)) return false;
      }
    }
    return true;
  });

  // Helper: shape question for widget response
  const shape = (q: typeof enriched[number]): ShapedQuestion => ({
    id: q.id,
    text: q.text,
    options: q.options.map(o => {
      const base: ShapedQuestion["options"][number] = { label: o.label, value: o.value };
      if (o.followUp) {
        base.followUp = {
          id: o.followUp.id,
          text: o.followUp.text,
          ...(o.followUp.description ? { description: o.followUp.description } : {}),
          ...(o.followUp.options
            ? { options: o.followUp.options.map(fo => ({ label: fo.label, value: fo.value })) }
            : {}),
          ...(o.followUp.allow_free_text !== undefined ? { allow_free_text: o.followUp.allow_free_text } : {}),
        };
      }
      return base;
    }),
    allow_free_text: q.allow_free_text ?? false,
    ...(q.description ? { description: q.description } : {}),
    ...(q.type ? { type: q.type as "structured" | "info" | "date" | "file" } : {}),
    ...(q._excludeWhen ? { excludeWhen: q._excludeWhen } : {}),
  });

  // ── Primary batch: priority 4–5 ──────────────────────────────────────────────
  // Always served regardless of band. Highest-priority questions come first.
  const primaryQuestions = eligible
    .filter(q => q._priority >= 4)
    .sort((a, b) => b._priority - a._priority);

  if (primaryQuestions.length > 0) {
    return { questions: primaryQuestions.map(shape), phase: "primary" };
  }

  // ── Refinement batch: priority 3 ─────────────────────────────────────────────
  // Only served for Band B and C leads. Band A is already high-value  -  no refinement
  // needed. Band D/E leads won't improve from more questions.
  if (!["A", "D", "E"].includes(band)) {
    const refinementQuestions = eligible.filter(q => q._priority === 3);
    if (refinementQuestions.length > 0) {
      return { questions: refinementQuestions.map(shape), phase: "refinement" };
    }
  }

  // ── Identity phase ────────────────────────────────────────────────────────────
  // All eligible questions answered (or Band A/D/E skipping refinement).
  // Caller should set collect_identity = true.
  return { questions: [], phase: "identity" };
}
