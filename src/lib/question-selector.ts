/**
 * Dynamic Question Selector — S10.3 + Sub-Type Routing
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

/** Shape of a question as returned to the widget. */
export interface ShapedQuestion {
  id: string;
  text: string;
  options: Array<{ label: string; value: string }>;
  allow_free_text: boolean;
}

export type QuestionPhase = "primary" | "refinement" | "identity";

export interface QuestionBatch {
  /** Questions to serve in this batch. Empty when phase is "identity". */
  questions: ShapedQuestion[];
  /** Which phase this batch belongs to. "identity" means all questions are done. */
  phase: QuestionPhase;
}

/**
 * Select the next batch of questions to serve to the client.
 *
 * @param allQuestions   Full ordered question list from the question set.
 * @param practiceAreaId Short PA ID (e.g. "pi", "emp", "fam").
 * @param confirmed      Current confirmed answers: question IDs already filled.
 * @param band           Current CPI band ("A" | "B" | "C" | "D" | "E").
 * @returns              QuestionBatch — questions to serve, or phase="identity" if done.
 */
export function selectNextQuestions(
  allQuestions: Question[],
  practiceAreaId: string,
  confirmed: Record<string, unknown>,
  band: string,
): QuestionBatch {
  const slotSchema = getSlotSchema(practiceAreaId);

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
    return { ...q, _priority: priority, _requires: requires };
  });

  // 1. Remove already-confirmed questions
  const unanswered = enriched.filter(q => !(q.id in confirmed));

  // 2. Apply `requires` gate — question is only eligible when all prerequisites are filled
  const eligible = unanswered.filter(q => {
    if (q._requires.length === 0) return true;
    return q._requires.every(reqId => reqId in confirmed);
  });

  // Helper: shape question for widget response
  const shape = (q: typeof enriched[number]): ShapedQuestion => ({
    id: q.id,
    text: q.text,
    options: q.options.map(o => ({ label: o.label, value: o.value })),
    allow_free_text: q.allow_free_text ?? false,
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
  // Only served for Band B and C leads. Band A is already high-value — no refinement
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
