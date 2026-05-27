/**
 * Screen Demo · Case Fixtures
 *
 * Four cases. Three pre-configured sample scenarios calibrated to produce
 * specific banding outcomes that demonstrate the Screen's range. One
 * "Use your own inquiry" option for the high-intent prospect who wants
 * personalized output on the first pass.
 *
 * Each sample carries a pre-filled answer pattern. The lawyer can adjust
 * any answer and the Screen re-scores live. Defaults are calibrated to
 * land in the target band when left untouched.
 *
 * Calibration discipline:
 *   - Sample A produces Band A or high B (immigration appeal, urgent, fee-ready)
 *   - Sample B produces Band B (criminal defense, out-of-jurisdiction wrinkle)
 *   - Sample C produces Band C or D (real estate, modest stakes, fee unclear)
 *   - Sample D is the "your own" track — no pre-fill, lawyer answers from scratch
 *
 * The calibration spread is deliberate: one A, one B, one C/D. The lawyer
 * who runs all three samples sees the Screen behave consistently across the
 * banding spectrum, which builds confidence in the methodology.
 */

import type { Answers } from "../_lib/scoring";
import type { Band } from "../_lib/scoring";

export interface SampleCase {
  id: string;
  /** Card eyebrow */
  tag: string;
  /** Card title — the one-line scenario */
  title: string;
  /** Card body — the full description the lawyer sees on the picker */
  description: string;
  /** Expected outcome chip shown on the card */
  expectedOutcome: string;
  /** Expected band (informs the chip and helps QA the fixture) */
  expectedBand: Band;
  /** Pre-filled answers; the lawyer can adjust any of them */
  defaultAnswers: Answers;
  /**
   * Whether this is the "Use your own inquiry" pass-through.
   * When true, defaultAnswers is empty and the lawyer answers from scratch.
   */
  isCustom: boolean;
}

/* ──────────────────────────────────────────────────────────────────
 *  Sample A · Immigration appeal, urgent, fee-ready → Band A
 * ────────────────────────────────────────────────────────────────── */

export const SAMPLE_IMMIGRATION: SampleCase = {
  id: "immigration-appeal",
  tag: "Immigration",
  title: "Refused application, wants to appeal",
  description:
    "A prospective client in Mississauga whose work-permit application was refused last week. They have 30 days to file an appeal. They have already spoken to two firms and are ready to retain.",
  expectedOutcome: "Band A · Priority",
  expectedBand: "A",
  isCustom: false,
  defaultAnswers: {
    practice_area: "immigration",
    jurisdiction: "ontario_local",
    timeline: "this_month",
    stakes: "high_stakes_complex",
    fee_fit: "ready_retainer",
  },
};

/* ──────────────────────────────────────────────────────────────────
 *  Sample B · Criminal defense, out-of-province wrinkle → Band B
 * ────────────────────────────────────────────────────────────────── */

export const SAMPLE_CRIMINAL: SampleCase = {
  id: "criminal-impaired",
  tag: "Criminal defense",
  title: "Partner charged with impaired driving in a neighbouring jurisdiction",
  description:
    "A prospective client whose partner was charged with impaired driving in Quebec last weekend. They live in Toronto. First appearance in three weeks. They understand legal work costs money but want to compare fees.",
  expectedOutcome: "Band B · Qualified",
  expectedBand: "B",
  isCustom: false,
  defaultAnswers: {
    practice_area: "criminal_defense",
    jurisdiction: "out_of_province_matter",
    timeline: "few_months",
    stakes: "high_stakes_routine",
    fee_fit: "shopping_compare",
  },
};

/* ──────────────────────────────────────────────────────────────────
 *  Sample C · Real estate transactional, fee unclear → Band C/D
 * ────────────────────────────────────────────────────────────────── */

export const SAMPLE_REAL_ESTATE: SampleCase = {
  id: "real-estate-closing",
  tag: "Real estate",
  title: "Residential closing in three weeks",
  description:
    "A first-time buyer in Scarborough closing on a condo in three weeks. They asked if you do free first consultations before committing. They have not asked about your fee structure.",
  expectedOutcome: "Band C · Review",
  expectedBand: "C",
  isCustom: false,
  defaultAnswers: {
    practice_area: "real_estate",
    jurisdiction: "ontario_local",
    timeline: "this_month",
    stakes: "moderate_routine",
    fee_fit: "wants_free_advice",
  },
};

/* ──────────────────────────────────────────────────────────────────
 *  Custom track · "Use your own inquiry"
 * ────────────────────────────────────────────────────────────────── */

export const SAMPLE_CUSTOM: SampleCase = {
  id: "your-own",
  tag: "Your own inquiry",
  title: "Score a real inquiry your firm received recently",
  description:
    "Walk through the Screen as if your last inquiry were filling it out now. The report shows how the Screen would have routed that case before your partner read a word.",
  expectedOutcome: "Personalized report",
  expectedBand: "A", // not used for custom — chip suppressed in UI
  isCustom: true,
  defaultAnswers: {},
};

export const SAMPLE_CASES: SampleCase[] = [
  SAMPLE_IMMIGRATION,
  SAMPLE_CRIMINAL,
  SAMPLE_REAL_ESTATE,
  SAMPLE_CUSTOM,
];

export function getCase(caseId: string): SampleCase | undefined {
  return SAMPLE_CASES.find((c) => c.id === caseId);
}
