/**
 * round3-category-suppression.ts
 *
 * Layer 2 dedupe safety net: when an explicit excludeWhen rule misses (because
 * the AI emits a custom or unanticipated question ID), this layer falls back
 * to category-level matching.
 *
 * How it works:
 *  1. Build a question-id-to-category index from the seeded R1 question library
 *     (default-question-modules.ts). This runs once at module load.
 *  2. R3_CATEGORY_TO_R1_CATEGORIES maps R3 category names to the R1 category
 *     names that "cover" them. If any confirmed R1 answer is in a covering
 *     category, the R3 question is suppressed.
 *  3. Conservative by design: only categories with strong overlap are mapped.
 *     fact_pattern_depth, conflict_and_parties, and expectations_alignment are
 *     NOT mapped — those R3 questions go deeper than R1 or have no R1 equivalent.
 *
 * Trade-off vs ID-based excludeWhen:
 *  - Catches AI-invented IDs (emp_tenure, r2_police_report, etc.) that no
 *    explicit rule could anticipate.
 *  - Slightly less precise: may rarely over-suppress when R1 covered the
 *    category but at a shallower depth than R3 intended.
 */

import { DEFAULT_QUESTION_MODULES } from "./default-question-modules";

/**
 * Map of R3 category → list of R1 categories whose presence in _confirmed
 * indicates the R3 question's intent has already been covered.
 *
 * Conservative — only mapped where R1 and R3 intent overlap strongly.
 */
const R3_CATEGORY_TO_R1_CATEGORIES: Record<string, string[]> = {
  jurisdiction_limitations: ["Timeline and Urgency"],
  fact_pattern:             ["Substance and Merit"],
  evidence_inventory:       ["Documentation and Evidence"],
  // NOT mapped (R3 goes deeper or has no R1 equivalent):
  //   fact_pattern_depth     — R3 probes deeper than R1 substance
  //   conflict_and_parties   — R1 has no party/conflict question
  //   expectations_alignment — R1 has no expectations question
};

// Build the id → category index once at module load
const ID_TO_CATEGORY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const bank of Object.values(DEFAULT_QUESTION_MODULES)) {
    for (const q of bank.questions) {
      if (q.category) m.set(q.id, q.category);
    }
  }
  return m;
})();

/**
 * Returns true if an R3 question should be suppressed based on category match
 * against the session's confirmed R1/R2 answers.
 *
 * @param r3Category  The category field of the R3 question (e.g. "jurisdiction_limitations").
 * @param confirmed   The session's scoring._confirmed map (id → answer).
 */
export function isCategorySuppressed(
  r3Category: string,
  confirmed: Record<string, unknown>,
): boolean {
  const blockers = R3_CATEGORY_TO_R1_CATEGORIES[r3Category];
  if (!blockers || blockers.length === 0) return false;

  for (const confirmedId of Object.keys(confirmed)) {
    // Skip empty values — same gate as the wildcard rule.
    const v = confirmed[confirmedId];
    if (v === undefined || v === null || v === "") continue;

    // Try exact lookup first (matches seeded ids like pi_mva_q16, emp_q47).
    let category = ID_TO_CATEGORY.get(confirmedId);

    // If not found, try suffix match — handles long-form variants the AI emits
    // (pi_dog_bite_q16 not in seed, but maps to same intent as pi_db_q16).
    if (!category) {
      // Strip everything before the last underscore-q segment and look for a
      // matching seeded id with the same trailing q-number across any prefix.
      const tail = confirmedId.match(/_q\d+$/)?.[0];
      if (tail) {
        for (const [seedId, cat] of ID_TO_CATEGORY.entries()) {
          if (seedId.endsWith(tail)) { category = cat; break; }
        }
      }
    }

    if (category && blockers.includes(category)) return true;
  }
  return false;
}
