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

// ─── Emp Dismissal sub-type rules ────────────────────────────────────────────
const EMP_DIS_AUTO_RULES: AutoConfirmRule[] = [
  // Timing — emp_dis_q16
  { questionId: "emp_dis_q16", patterns: /\b(fired today|terminated today|let go today|fired yesterday|fired this week|fired last week|just (got |been )?fired|just (got |been )?terminated|just (got |been )?let go)\b/i, value: "under_3mo" },

  // What they received — emp_dis_q17
  { questionId: "emp_dis_q17", patterns: /\b(no notice|immediate(ly)?|walked out (the same day|same day)|effective immediately|nothing (on (the )?way out|when (I was|they))|no payment)\b/i, value: "nothing" },
  { questionId: "emp_dis_q17", patterns: /\b(severance (pay|package|offer)|pay in lieu|lump sum payment|paid out)\b/i, value: "severance" },
  { questionId: "emp_dis_q17", patterns: /\b(working notice|notice period|continued (to work|working)|worked through the notice)\b/i, value: "working_notice" },

  // Reason — emp_dis_q31
  { questionId: "emp_dis_q31", patterns: /\b(no reason|without cause|without a reason|without explanation|didn.t give a reason)\b/i, value: "no_reason" },
  { questionId: "emp_dis_q31", patterns: /\b(restructur|reorganiz|position (eliminated|abolished)|role (eliminated|no longer exists)|downsizing|layoff)\b/i, value: "restructure" },
  { questionId: "emp_dis_q31", patterns: /\b(performance (issues?|reasons?|concerns?)|based on performance|they said my performance)\b/i, value: "performance" },
  { questionId: "emp_dis_q31", patterns: /\b(just cause|serious misconduct|theft|fraud|fired for cause)\b/i, value: "just_cause" },

  // Signed release — emp_dis_q32
  { questionId: "emp_dis_q32", patterns: /\b(haven.t signed|nothing (has been |is |been )?signed|not signed (yet|anything)|they gave me (papers|documents|an agreement) (to sign|and I haven.t))\b/i, value: "given_not_signed" },
  { questionId: "emp_dis_q32", patterns: /\b(signed (a )?release|signed (a )?severance|signed (the )?agreement|full and final release)\b/i, value: "signed_release" },

  // Seniority — emp_dis_q46
  { questionId: "emp_dis_q46", patterns: /\b(director|vice[- ]?president|VP|C[- ]?suite|CEO|CFO|COO|president)\b/i, value: "executive" },
  { questionId: "emp_dis_q46", patterns: /\b(manager|supervisor|team lead|head of)\b/i, value: "manager" },
  { questionId: "emp_dis_q46", patterns: /\b(junior|entry[- ]?level|intern|assistant|coordinator)\b/i, value: "junior" },
];

// ─── Emp Harassment sub-type rules ───────────────────────────────────────────
const EMP_HAR_AUTO_RULES: AutoConfirmRule[] = [
  // Type — emp_har_q1
  { questionId: "emp_har_q1", patterns: /\bsexual harassment\b/i, value: "sexual" },
  { questionId: "emp_har_q1", patterns: /\b(discrimination|discriminatory harassment|harassment based on|racial|gender-based)\b/i, value: "discriminatory" },
  { questionId: "emp_har_q1", patterns: /\b(bullying|personal harassment|bullied|being targeted)\b/i, value: "personal" },

  // Perpetrator — emp_har_q2
  { questionId: "emp_har_q2", patterns: /\b(my (direct )?supervisor|my (direct )?manager|my boss)\b/i, value: "supervisor" },
  { questionId: "emp_har_q2", patterns: /\b(senior management|VP|director|executive (above|over))\b/i, value: "senior_mgmt" },
  { questionId: "emp_har_q2", patterns: /\b(coworker|colleague|peer|someone at my level)\b/i, value: "coworker" },

  // Still employed — emp_har_q17
  { questionId: "emp_har_q17", patterns: /\b(still (working|employed|at (the company|work))|currently employed)\b/i, value: "yes_ongoing" },
  { questionId: "emp_har_q17", patterns: /\b(I resigned|I quit|left the (job|company)|no longer (work|employed) there)\b.{0,30}\b(because of|due to)\b/i, value: "resigned" },
];

// ─── Emp Constructive sub-type rules ─────────────────────────────────────────
const EMP_CON_AUTO_RULES: AutoConfirmRule[] = [
  // Change type — emp_con_q1
  { questionId: "emp_con_q1", patterns: /\b(pay cut|salary (cut|reduced|reduction)|compensation (cut|reduced|reduction)|they cut my (pay|salary))\b/i, value: "pay_cut" },
  { questionId: "emp_con_q1", patterns: /\b(job duties (changed|altered)|my role (changed|was changed)|different (role|job|duties)|new duties)\b/i, value: "role_change" },
  { questionId: "emp_con_q1", patterns: /\b(demoted|demotion|title (stripped|downgraded|removed)|reporting (changed|restructured)|lost (my authority|my team))\b/i, value: "demotion" },
  { questionId: "emp_con_q1", patterns: /\b(relocated|forced to move|transfer(red)? to (another|a different) (city|location|office))\b/i, value: "relocation" },

  // Still employed — emp_con_q2
  { questionId: "emp_con_q2", patterns: /\b(still (employed|working there)|haven.t resigned|deciding (what|whether) to)\b/i, value: "still_employed" },
  { questionId: "emp_con_q2", patterns: /\b(I (have )?resigned|I quit|I left)\b/i, value: "resigned_recent" },

  // Objected — emp_con_q17
  { questionId: "emp_con_q17", patterns: /\b(objected in writing|wrote (a letter|an email|to employer)|sent (them|HR) (a letter|an email) (objecting|about this|protesting))\b/i, value: "yes_refused" },
  { questionId: "emp_con_q17", patterns: /\b(continued (to work|working)|didn.t (formally )?object|accepted (the change|it) (by continuing|and kept working))\b/i, value: "no_objection" },
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
  // Emp sub-types
  emp_dismissal:    EMP_DIS_AUTO_RULES,
  emp_harassment:   EMP_HAR_AUTO_RULES,
  emp_constructive: EMP_CON_AUTO_RULES,
  emp_disc:         [],   // GPT handles — too many protected grounds for safe regex
  emp_wage:         [],   // GPT handles — amount/type too varied for safe regex
  emp_other:        [],   // qualifier set — no auto-confirm needed
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
