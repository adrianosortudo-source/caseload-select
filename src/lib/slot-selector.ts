/**
 * CaseLoad Screen  -  Slot Selector
 *
 * Stateless functions that operate on the slot registry to:
 *   1. Select which slots to serve in a given round.
 *   2. Accumulate score deltas from answered slots into three-axis deltas.
 *   3. Detect whether Round 3 should fire based on answered options.
 *
 * These functions are deterministic  -  no GPT, no randomness. All scoring
 * judgment is encoded in the slot bank data (slot-registry.ts).
 *
 * Selection rules (mirroring the slot-registry docblock):
 *   Round 1  -  universal slots served first (up to ROUND_1_LIMIT total),
 *             then sub-type slots fill remaining capacity by priorityWeight desc.
 *   Round 2  -  same pattern; universal slots + sub-type fill up to ROUND_2_LIMIT.
 *   Round 3  -  universal + all dependency-satisfied, unanswered round-3 slots
 *             (no cap); only fires when shouldTriggerRound3() returns true.
 *
 * Integration: route.ts calls selectSlots() after classifier resolves sub_type.
 * The returned Slot[] is injected into the GPT system prompt as structured
 * qualification questions for the current round.
 */

import { SLOT_REGISTRY, SLOTS_BY_SUBTYPE, UNIVERSAL_SLOTS } from "./slot-registry";
import type { Slot } from "./slot-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ROUND_1_LIMIT = 6;
const ROUND_2_LIMIT = 5;

// ─────────────────────────────────────────────────────────────────────────────
// selectSlots
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the slots to serve in a given round for the specified sub-type.
 *
 * Filtering pipeline:
 *   1. Restrict to `round`  -  never mix rounds.
 *   2. Exclude already-answered slots (key present in answeredSlots).
 *   3. Exclude conditional slots whose dependency is not yet satisfied.
 *   4. Exclude slots whose excludeWhen gate fires against confirmedAnswers.
 *   5. Universal slots (UNIVERSAL_SLOTS) are always served first and consume
 *      cap budget; they cannot be displaced by sub-type candidates.
 *   6. Sub-type candidates sorted descending by priorityWeight fill remaining
 *      cap after universal slots are reserved.
 *   7. Cap: ROUND_1_LIMIT (6) total for round 1, ROUND_2_LIMIT (5) for round 2.
 *      Round 3 returns all qualifying slots (no cap).
 *
 * Dependency semantics:
 *   - A dependency is satisfied when answeredSlots[dep.slotId] is one of
 *     dep.values. For multi_select answers (string[]), any element match suffices.
 *   - A dependency is NOT satisfied when the required slot has not been answered.
 *
 * excludeWhen semantics:
 *   - Key: AI question ID from _confirmed (e.g. "pi_q17").
 *   - Value: answer values that cause this slot to be suppressed.
 *   - Applied before the slot is offered to GPT. Prevents contradictory questions
 *     (e.g. treatment questions when client confirmed no injuries).
 *
 * @param subType          Practice area sub-type. E.g. "pi_slip_fall".
 * @param answeredSlots    Map of slot ID → answer value(s) from prior rounds.
 * @param round            Which round to fetch (1, 2, or 3).
 * @param confirmedAnswers AI-confirmed answers from _confirmed (keyed by question ID).
 *                         Defaults to empty object (no exclusions).
 * @returns                Ordered Slot[] ready to inject into the prompt.
 *                         Universal slots precede sub-type slots in the result.
 */
export function selectSlots(
  subType: string,
  answeredSlots: Record<string, string | string[]>,
  round: 1 | 2 | 3,
  confirmedAnswers: Record<string, unknown> = {},
): Slot[] {
  // Shared dependency predicate  -  reused for both universal and sub-type slots.
  function depSatisfied(slot: Slot): boolean {
    if (!slot.dependsOn) return true;
    const depAnswer = answeredSlots[slot.dependsOn.slotId];
    if (depAnswer === undefined) return false;
    if (Array.isArray(depAnswer)) {
      return depAnswer.some(v => slot.dependsOn!.values.includes(v));
    }
    return slot.dependsOn.values.includes(depAnswer);
  }

  // excludeWhen gate: suppress slot when a confirmed AI answer matches a blocked value.
  // Wildcard "*" suppresses when ANY non-empty answer exists for the dependency.
  function notExcluded(slot: Slot): boolean {
    if (!slot.excludeWhen) return true;
    for (const [questionId, blockedValues] of Object.entries(slot.excludeWhen)) {
      const answered = confirmedAnswers[questionId];
      if (blockedValues.includes("*") && answered !== undefined && answered !== null && answered !== "") return false;
      if (typeof answered === "string" && blockedValues.includes(answered)) return false;
      if (Array.isArray(answered) && (answered as string[]).some(v => blockedValues.includes(v))) return false;
    }
    return true;
  }

  // Universal candidates: filter but do NOT sort or cap (order is authoring order).
  const universalCandidates = UNIVERSAL_SLOTS
    .filter(slot => slot.round === round)
    .filter(slot => !(slot.id in answeredSlots))
    .filter(depSatisfied)
    .filter(notExcluded);

  // Sub-type candidates: filter, sort by priorityWeight desc, then cap.
  const allSlots = SLOTS_BY_SUBTYPE.get(subType) ?? [];
  const subTypeCandidates = allSlots
    .filter(slot => slot.round === round)
    .filter(slot => !(slot.id in answeredSlots))
    .filter(depSatisfied)
    .filter(notExcluded)
    .sort((a, b) => b.priorityWeight - a.priorityWeight);

  if (round === 3) {
    // Round 3: no cap. Universal slots followed by all sub-type candidates.
    return [...universalCandidates, ...subTypeCandidates];
  }

  const totalLimit = round === 1 ? ROUND_1_LIMIT : ROUND_2_LIMIT;
  const subTypeLimit = Math.max(0, totalLimit - universalCandidates.length);

  return [...universalCandidates, ...subTypeCandidates.slice(0, subTypeLimit)];
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreFromSlotAnswers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accumulate CPI axis deltas from all answered slots.
 *
 * Returned deltas are ADDITIVE adjustments to the three CPI axes
 * (cpi_fit, cpi_urgency, cpi_friction). Route.ts adds them on top of the
 * GPT-produced raw CPI scores before calling validateAndFixScoring().
 *
 * Multi-select answers score all selected options independently.
 * Unknown slot IDs and unknown option values are silently skipped.
 *
 * @param answers  Map of slot ID → answer value (string) or values (string[]).
 * @returns        Cumulative { fit, urgency, friction } deltas.
 */
export function scoreFromSlotAnswers(
  answers: Record<string, string | string[]>,
): { fit: number; urgency: number; friction: number } {
  let fit = 0;
  let urgency = 0;
  let friction = 0;

  for (const [slotId, answer] of Object.entries(answers)) {
    const slot = SLOT_REGISTRY.get(slotId);
    if (!slot?.options) continue;

    const values = Array.isArray(answer) ? answer : [answer];
    for (const value of values) {
      const option = slot.options.find(o => o.value === value);
      if (option) {
        fit      += option.fitDelta;
        urgency  += option.urgencyDelta;
        friction += option.frictionDelta;
      }
    }
  }

  return { fit, urgency, friction };
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldTriggerRound3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return true when any answered option carries `triggersRound3: true`.
 *
 * Round 3 serves high-value depth questions (damages quantification, future
 * treatment, prior injuries) only for leads that already show strong signals.
 * These signals are marked on options in the slot bank by lawyer judgment.
 *
 * Called by route.ts before entering round 2 → round 3 transitions.
 *
 * @param answers  Map of slot ID → answer value(s).
 * @returns        True when at least one answered option triggers Round 3.
 */
export function shouldTriggerRound3(
  answers: Record<string, string | string[]>,
): boolean {
  for (const [slotId, answer] of Object.entries(answers)) {
    const slot = SLOT_REGISTRY.get(slotId);
    if (!slot?.options) continue;

    const values = Array.isArray(answer) ? answer : [answer];
    for (const value of values) {
      const option = slot.options.find(o => o.value === value);
      if (option?.triggersRound3) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeJordanUrgency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute an additional urgency delta from the R v Jordan delay clock.
 *
 * Jordan [2016] SCC 27 establishes presumptive ceilings for unreasonable delay:
 *   - Ontario Court of Justice (summary / hybrid):  18 months from charge to trial end.
 *   - Superior Court of Justice (indictable):        30 months from charge to trial end.
 *
 * This function estimates NET elapsed delay by subtracting estimated
 * defence-caused months (derived from the adjournment count bucket) from
 * estimated elapsed months (derived from the charge-date bucket). Defence-caused
 * delay does not count against the Crown under Jordan.
 *
 * The returned value is ADDITIVE to the urgency already produced by
 * scoreFromSlotAnswers()  -  it captures the interaction signal between elapsed
 * time and adjournment volume that per-slot scoring cannot express alone.
 *
 * Callers: route.ts, after both charge_date and adjournment_count are answered.
 * Unknown input values return 0 (graceful degradation  -  never throws).
 *
 * Urgency tiers (additive delta):
 *   net ≥ 30 months → +25  (past Superior Court ceiling  -  s.11(b) application viable)
 *   net ≥ 18 months → +15  (at OCJ ceiling / approaching Superior ceiling)
 *   net ≥ 12 months → +5   (approaching OCJ ceiling  -  flag for monitoring)
 *   net <  12 months → 0   (no Jordan concern yet)
 *
 * @param chargeDate       Value from crim_indictable_sc__charge_date slot.
 *                         Expected: "under_6_months" | "6_12_months" | "12_18_months" |
 *                                   "18_30_months" | "over_30_months"
 * @param adjournmentCount Value from crim_indictable_sc__adjournment_count slot.
 *                         Expected: "none" | "1_3" | "4_8" | "over_8"
 * @returns                Urgency delta (0 | 5 | 15 | 25). 0 for unrecognised inputs.
 */
export function computeJordanUrgency(
  chargeDate: string,
  adjournmentCount: string,
): number {
  // Elapsed months  -  conservative midpoint of each charge-date bucket.
  const ELAPSED_MONTHS: Record<string, number> = {
    under_6_months:  3,
    "6_12_months":   9,
    "12_18_months":  15,
    "18_30_months":  24,
    over_30_months:  36,
  };

  // Estimated defence-caused delay per adjournment tier.
  // Each adjournment is roughly 3-4 weeks; attribution is conservative
  // (not all adjournments are defence-caused, but intake cannot distinguish).
  const DEFENCE_MONTHS: Record<string, number> = {
    none:   0,
    "1_3":  1.5,
    "4_8":  3.5,
    over_8: 6,
  };

  const elapsed  = ELAPSED_MONTHS[chargeDate];
  const defence  = DEFENCE_MONTHS[adjournmentCount];

  if (elapsed === undefined || defence === undefined) return 0;

  const netDelay = Math.max(0, elapsed - defence);

  if (netDelay >= 30) return 25; // past Superior Court ceiling
  if (netDelay >= 18) return 15; // at/past OCJ ceiling, approaching Superior
  if (netDelay >= 12) return 5;  // approaching OCJ ceiling
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// getSlotById
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a single slot by its stable ID.
 *
 * @param id  Slot ID. E.g. "pi_slip_fall__incident_date".
 * @returns   Slot definition, or undefined if not found.
 */
export function getSlotById(id: string): Slot | undefined {
  return SLOT_REGISTRY.get(id);
}
