/**
 * Sub-Type Taxonomy  -  Contextual Routing Layer
 *
 * Every umbrella practice area has sub-types. Routing a client to the
 * correct question set requires knowing not just "pi" but "pi_slip_fall"
 * or "pi_mva". This file is the single source of truth for the taxonomy.
 *
 * Rules:
 *   - Every umbrella PA must have an `_other` fallback.
 *   - Sub-type IDs are stable  -  never rename after production deployment.
 *   - Question set keys in default-question-modules.ts must match these IDs.
 *   - `_other` routes to a short 5-question qualifier set that determines the
 *     real sub-type before loading the main question set.
 */

/** Map of umbrella practice area ID → ordered list of sub-type IDs */
export const SUB_TYPES: Record<string, string[]> = {
  pi:   ["pi_mva", "pi_slip_fall", "pi_dog_bite", "pi_med_mal", "pi_product", "pi_workplace", "pi_assault_ci", "pi_other"],
  emp:  ["emp_dismissal", "emp_harassment", "emp_wage", "emp_disc", "emp_constructive", "emp_other"],
  fam:  ["fam_abduction", "fam_divorce", "fam_custody", "fam_support", "fam_property", "fam_protection", "fam_other"],
  crim: ["crim_dui", "crim_assault", "crim_drug", "crim_theft", "crim_domestic", "crim_other"],
  imm:  ["imm_ee", "imm_spousal", "imm_study", "imm_work_permit", "imm_refugee", "imm_pnp", "imm_other"],
  civ:  ["civ_contract", "civ_debt", "civ_tort", "civ_negligence", "civ_other"],
  ins:  ["ins_sabs", "ins_denial", "ins_bad_faith", "ins_other"],
};

/** Umbrella PAs that do NOT have sub-types (single question set) */
export const SINGLE_SET_PAS = new Set([
  "real", "corp", "est", "llt", "ip", "tax", "admin",
  "bank", "priv", "fran", "env", "prov", "condo", "hr", "edu",
  "health", "debt", "nfp", "defam", "socben", "gig", "sec",
  "elder", "str", "crypto", "ecom", "animal", "const",
]);

/**
 * Returns the question-set key to use for this PA + sub-type combination.
 * For PAs without sub-type routing, returns the PA id directly.
 * For sub-typed PAs, returns "{pa}_{subtype_suffix}" or "{pa}_other" as fallback.
 */
export function resolveQuestionSetKey(
  practiceArea: string,
  practiceSubType: string | null | undefined,
): string {
  if (SINGLE_SET_PAS.has(practiceArea)) return practiceArea;
  if (!practiceSubType) return `${practiceArea}_other`;
  // Validate sub-type belongs to this PA
  const valid = SUB_TYPES[practiceArea] ?? [];
  if (valid.includes(practiceSubType)) return practiceSubType;
  return `${practiceArea}_other`;
}

/**
 * Extract the umbrella PA from a sub-type key.
 * e.g. "pi_slip_fall" → "pi", "emp_dismissal" → "emp"
 */
export function umbrellaFromSubType(subType: string): string | null {
  for (const [pa, subtypes] of Object.entries(SUB_TYPES)) {
    if (subtypes.includes(subType)) return pa;
  }
  return null;
}
