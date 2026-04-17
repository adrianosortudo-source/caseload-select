/**
 * Context-aware question auto-skip — extracted from route.ts for reuse.
 *
 * After the AI classifies a practice area and extracts entities from free-text,
 * this module checks whether structured questions can be confidently answered
 * from what the person already told us. Slots matched here are never shown.
 *
 * Rule: only auto-answer when the signal is unambiguous. If there's any doubt,
 * let the question render and let the person confirm.
 *
 * This is the regex fast-path. GPT-based extraction (filled_slots, S10.2) is the
 * primary path and runs in parallel — results are merged into updatedConfirmed.
 *
 * Sub-type routing: AUTO_RULES_BY_PA is keyed by question-set key, which may be
 * a sub-type ID (e.g. "pi_slip_fall") rather than just the umbrella PA ("pi").
 * autoConfirmFromContext() accepts a questionSetKey parameter for this purpose.
 * The umbrella "pi" key still exists as a fallback for legacy sessions without sub-type.
 */

type AutoConfirmRule = {
  questionId: string;
  patterns: RegExp;
  value: string;
};

// ─── PI MVA sub-type rules ────────────────────────────────────────────────────
const PI_MVA_AUTO_RULES: AutoConfirmRule[] = [
  // Role detection — pi_mva_q1
  { questionId: "pi_mva_q1", patterns: /\b(car accident|car crash|my car|i was driving|driving my|drove into|rear[- ]?ended|vehicle collision|hit my car|hit my truck|my truck|my suv|my van|fender bender)\b/i, value: "driver" },
  { questionId: "pi_mva_q1", patterns: /\b(i was a passenger|passenger seat|riding with|riding in)\b/i, value: "passenger" },
  { questionId: "pi_mva_q1", patterns: /\b(pedestrian|walking|crosswalk|hit while walking|struck while crossing|hit me while i was walking)\b/i, value: "pedestrian" },
  { questionId: "pi_mva_q1", patterns: /\b(cycling|bicycle|bike|cyclist|hit while cycling|hit my bike)\b/i, value: "cyclist" },

  // Timing detection — pi_mva_q16
  { questionId: "pi_mva_q16", patterns: /\b(today|just now|just happened|this morning|this afternoon|this evening|tonight|last night|yesterday|few hours ago|earlier today)\b/i, value: "today_week" },

  // Collision type detection — pi_mva_q31
  { questionId: "pi_mva_q31", patterns: /\b(rear[- ]?ended|hit from behind|bumped from behind)\b/i, value: "rear_end" },
  { questionId: "pi_mva_q31", patterns: /\b(head[- ]?on|head on collision|frontal)\b/i, value: "head_on" },
  { questionId: "pi_mva_q31", patterns: /\b(t[- ]?bone|side[- ]?impact|intersection collision|ran a red|ran the light)\b/i, value: "side_impact" },
];

// ─── PI Slip-and-Fall sub-type rules ─────────────────────────────────────────
const PI_SF_AUTO_RULES: AutoConfirmRule[] = [
  // Location — pi_sf_q1
  { questionId: "pi_sf_q1", patterns: /\b(walmart|costco|supermarket|grocery\s+store|pharmacy|restaurant|mall|shopping\s+centre|shopping\s+center|office\s+building|convenience\s+store)\b/i, value: "commercial" },
  { questionId: "pi_sf_q1", patterns: /\b(sidewalk|city\s+sidewalk|municipal|TTC|subway|bus\s+stop|park|public\s+property)\b/i, value: "public" },
  { questionId: "pi_sf_q1", patterns: /\b(at\s+work|job\s+site|workplace|office\s+at\s+work)\b/i, value: "workplace" },

  // Hazard type — pi_sf_q31
  { questionId: "pi_sf_q31", patterns: /\b(wet\s+floor|spill|mopping|slippery\s+floor|no\s+wet\s+floor\s+sign)\b/i, value: "wet_floor" },
  { questionId: "pi_sf_q31", patterns: /\b(ice|icy|snow|slippery\s+(sidewalk|driveway|steps|walkway))\b/i, value: "ice_snow" },
  { questionId: "pi_sf_q31", patterns: /\b(uneven|pothole|cracked\s+(pavement|sidewalk)|broken\s+(step|pavement))\b/i, value: "uneven" },

  // Timing — pi_sf_q16
  { questionId: "pi_sf_q16", patterns: /\b(today|just now|just happened|this morning|last night|yesterday|few hours ago)\b/i, value: "within_week" },
];

// ─── PI Dog Bite sub-type rules ───────────────────────────────────────────────
const PI_DB_AUTO_RULES: AutoConfirmRule[] = [
  // Timing — pi_db_q16
  { questionId: "pi_db_q16", patterns: /\b(today|just now|just happened|this morning|last night|yesterday|few hours ago)\b/i, value: "within_week" },
];

// ─── PI Med-Mal sub-type rules ────────────────────────────────────────────────
const PI_MM_AUTO_RULES: AutoConfirmRule[] = [
  // Provider type — pi_mm_q1
  { questionId: "pi_mm_q1", patterns: /\b(family\s+doctor|general\s+practitioner|GP|physician)\b/i, value: "physician" },
  { questionId: "pi_mm_q1", patterns: /\b(surgeon|specialist|cardiologist|oncologist|orthopedic|neurosurgeon)\b/i, value: "surgeon" },
  { questionId: "pi_mm_q1", patterns: /\b(hospital|clinic|health\s+centre)\b/i, value: "hospital" },
  { questionId: "pi_mm_q1", patterns: /\b(dentist|dental\s+clinic|dental\s+office)\b/i, value: "dentist" },

  // Error type — pi_mm_q17
  { questionId: "pi_mm_q17", patterns: /\b(misdiagnosis|wrong\s+diagnosis|failed\s+to\s+diagnose|delayed\s+diagnosis)\b/i, value: "misdiagnosis" },
  { questionId: "pi_mm_q17", patterns: /\b(surgical\s+error|wrong[- ]site\s+surgery|surgery\s+went\s+wrong|operated\s+on\s+wrong)\b/i, value: "surgical" },
  { questionId: "pi_mm_q17", patterns: /\b(wrong\s+medication|wrong\s+drug|wrong\s+dosage|medication\s+error)\b/i, value: "medication" },
];

// ─── Legacy umbrella PI rules (backward compat for sessions without sub-type) ─
const PI_AUTO_RULES: AutoConfirmRule[] = [
  // Role detection — pi_q1
  { questionId: "pi_q1", patterns: /\b(car accident|car crash|my car|i was driving|driving my|drove into|rear[- ]?ended|vehicle collision|hit my car|hit my truck|my truck|my suv|my van|fender bender)\b/i, value: "driver" },
  { questionId: "pi_q1", patterns: /\b(i was a passenger|passenger seat|riding with|riding in)\b/i, value: "passenger" },
  { questionId: "pi_q1", patterns: /\b(pedestrian|walking|crosswalk|hit while walking|struck while crossing|hit me while i was walking)\b/i, value: "pedestrian" },
  { questionId: "pi_q1", patterns: /\b(cycling|bicycle|bike|cyclist|hit while cycling|hit my bike)\b/i, value: "cyclist" },

  // Timing detection — pi_q16
  { questionId: "pi_q16", patterns: /\b(today|just now|just happened|this morning|this afternoon|this evening|tonight|last night|yesterday|few hours ago|earlier today)\b/i, value: "today_week" },

  // Accident type detection — pi_q31
  { questionId: "pi_q31", patterns: /\b(rear[- ]?ended|hit from behind|bumped from behind)\b/i, value: "rear_end" },
  { questionId: "pi_q31", patterns: /\b(head[- ]?on|head on collision|frontal)\b/i, value: "head_on" },
  { questionId: "pi_q31", patterns: /\b(t[- ]?bone|side[- ]?impact|intersection collision|ran a red|ran the light)\b/i, value: "side_impact" },
];

const EMP_AUTO_RULES: AutoConfirmRule[] = [
  // Employee status — emp_q1
  { questionId: "emp_q1", patterns: /\b(fired|terminated|let go|laid off|dismissed|lost my job|my employer|my boss)\b/i, value: "yes" },

  // Timing — emp_q16
  { questionId: "emp_q16", patterns: /\b(today|just now|yesterday|this week|last week|just (got |been )?fired|just (got |been )?terminated|just (got |been )?let go)\b/i, value: "under_3mo" },
];

const CRIM_AUTO_RULES: AutoConfirmRule[] = [
  // Driving — crim_q1
  { questionId: "crim_q1", patterns: /\b(i was driving|driving my|pulled over|traffic stop|behind the wheel|dui|dwi|impaired driving)\b/i, value: "yes" },

  // Timing — crim_q19
  { questionId: "crim_q19", patterns: /\b(today|last night|yesterday|this week|just happened|got pulled over)\b/i, value: "under_3mo" },
];

const FAM_AUTO_RULES: AutoConfirmRule[] = [
  // Marriage status — fam_q1
  { questionId: "fam_q1", patterns: /\b(married|legal marriage|my wife|my husband|my spouse)\b/i, value: "yes" },
  { questionId: "fam_q1", patterns: /\b(common.law|common law partner|not legally married|not married)\b/i, value: "no" },

  // Ontario residency — fam_q2
  { questionId: "fam_q2", patterns: /\b(ontario|living in ontario|based in ontario|years in ontario|moved to ontario)\b/i, value: "yes" },
];

const LLT_AUTO_RULES: AutoConfirmRule[] = [
  // Landlord role — llt_q1
  { questionId: "llt_q1", patterns: /\b(i am (the )?landlord|i own (the )?property|property owner|my rental|my tenant|my unit|i own (the )?unit)\b/i, value: "landlord" },
];

const REAL_AUTO_RULES: AutoConfirmRule[] = [
  // Transaction type — real_q1
  { questionId: "real_q1", patterns: /\b(buying (a |the )?house|purchasing (a |the )?home|buying (a |the )?condo|i am (a )?buyer)\b/i, value: "buying" },
  { questionId: "real_q1", patterns: /\b(selling (a |the )?house|selling (my )?home|selling (a |the )?condo|i am (a )?seller)\b/i, value: "selling" },
];

export const AUTO_RULES_BY_PA: Record<string, AutoConfirmRule[]> = {
  // Umbrella PA (legacy / backward compat)
  pi:            PI_AUTO_RULES,
  emp:           EMP_AUTO_RULES,
  crim:          CRIM_AUTO_RULES,
  fam:           FAM_AUTO_RULES,
  llt:           LLT_AUTO_RULES,
  real:          REAL_AUTO_RULES,
  // PI sub-types
  pi_mva:        PI_MVA_AUTO_RULES,
  pi_slip_fall:  PI_SF_AUTO_RULES,
  pi_dog_bite:   PI_DB_AUTO_RULES,
  pi_med_mal:    PI_MM_AUTO_RULES,
  pi_product:    [],   // no unambiguous regex patterns; GPT extraction handles
  pi_workplace:  [],   // no unambiguous regex patterns; GPT extraction handles
  pi_assault_ci: [],   // no unambiguous regex patterns; GPT extraction handles
  pi_other:      [],   // qualifier set — no auto-confirm needed
};

/**
 * Scan situationText for unambiguous answers to structured questions.
 * Returns a map of { questionId → answerValue } to merge into confirmedAnswers.
 * Never overrides a human-confirmed answer.
 *
 * @param practiceArea    Umbrella PA id (e.g. "pi"). Used as fallback key.
 * @param situationText   Full concatenated client text to scan.
 * @param existingConfirmed  Already-confirmed answers — never overridden.
 * @param questionSetKey  Optional sub-type key (e.g. "pi_slip_fall"). Takes
 *                        precedence over practiceArea when present.
 */
export function autoConfirmFromContext(
  practiceArea: string | null,
  situationText: string,
  existingConfirmed: Record<string, unknown>,
  questionSetKey?: string | null,
): Record<string, string> {
  if (!practiceArea) return {};
  // Prefer sub-type-specific rules when available, fall back to umbrella
  const lookupKey = questionSetKey ?? practiceArea;
  const rules = AUTO_RULES_BY_PA[lookupKey] ?? AUTO_RULES_BY_PA[practiceArea];
  if (!rules) return {};

  const auto: Record<string, string> = {};

  for (const rule of rules) {
    if (rule.questionId in existingConfirmed) continue; // don't override human answer
    if (rule.questionId in auto) continue;              // first match wins

    if (rule.patterns.test(situationText)) {
      auto[rule.questionId] = rule.value;
    }
  }

  return auto;
}
