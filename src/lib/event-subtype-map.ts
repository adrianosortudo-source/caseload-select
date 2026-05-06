/**
 * Event Sub-Type Map
 *
 * Maps a detected event type from the extractor to the canonical sub-type
 * bank key used by getSlotSchema() and the question bank router.
 *
 * Gaps (event type has no dedicated bank) return null. The router must handle
 * null by falling back to the parent practice-area bank or triggering the GPT
 * classifier fallback (Stage 7).
 *
 * This map is the Walmart fix in one function:
 *   extractEvents("slipped at walmart") → slip_fall
 *   mapEventToSubType("slip_fall")      → "pi_slip_fall"
 *   getSlotSchema("pi_slip_fall")       → slip-fall question bank, not MVA
 */

/** All known sub-type bank keys in default-question-modules.ts. */
export type SubTypeKey =
  | "pi_slip_fall"
  | "pi_mva"
  | "pi_dog_bite"
  | "pi_workplace"
  | "pi_med_mal"
  | "pi_product"
  | "pi_assault_ci"
  | "pi_other"
  | "emp_dismissal"
  | "emp_wage"
  | "emp_constructive"
  | "emp_harassment"
  | "emp_disc"
  | "emp_other"
  | "imm_spousal"
  | "imm_ee"
  | "imm_pnp"
  | "imm_work_permit"
  | "imm_study"
  | "imm_refugee"
  | "imm_other"
  | "fam_divorce"
  | "fam_custody"
  | "fam_support"
  | "fam_property"
  | "fam_protection"
  | "fam_abduction"
  | "fam_other"
  | "civ_debt"
  | "civ_contract"
  | "civ_tort"
  | "civ_negligence"
  | "civ_other"
  | "crim_dui"
  | "crim_assault"
  | "crim_drug"
  | "crim_theft"
  | "crim_domestic"
  | "crim_other"
  | "corp_incorporation";

/**
 * Map from extractor event type to the best-fit sub-type bank key.
 * null = no dedicated bank exists yet (documented gap, routes to fallback).
 */
const EVENT_TO_SUBTYPE: Record<string, SubTypeKey | null> = {
  slip_fall: "pi_slip_fall",
  mva: "pi_mva",
  termination: "emp_dismissal",
  unpaid_overtime: "emp_wage",
  marriage_to_citizen: "imm_spousal",
  deportation: "imm_other",       // gap: no imm_removal / imm_deportation bank
  real_estate_defect: null,        // gap: no real_estate namespace at all
  debt_owed: "civ_debt",
  corp_formation: "corp_incorporation",
};

/**
 * Returns the sub-type bank key for a detected event type, or null when no
 * dedicated bank exists.
 *
 * Callers must handle null:
 *   - Route to parent PA bank as fallback, OR
 *   - Trigger GPT classifier fallback if parent PA is also unknown.
 */
export function mapEventToSubType(eventType: string): SubTypeKey | null {
  if (eventType in EVENT_TO_SUBTYPE) {
    return EVENT_TO_SUBTYPE[eventType];
  }
  return null;
}

/**
 * Returns true when a sub-type bank exists for the given event type.
 * Convenience wrapper for guard checks in route.ts.
 */
export function hasSubTypeBank(eventType: string): boolean {
  return EVENT_TO_SUBTYPE[eventType] !== null && eventType in EVENT_TO_SUBTYPE;
}
