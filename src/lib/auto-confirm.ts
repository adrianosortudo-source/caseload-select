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
 */

type AutoConfirmRule = {
  questionId: string;
  patterns: RegExp;
  value: string;
};

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
  pi:   PI_AUTO_RULES,
  emp:  EMP_AUTO_RULES,
  crim: CRIM_AUTO_RULES,
  fam:  FAM_AUTO_RULES,
  llt:  LLT_AUTO_RULES,
  real: REAL_AUTO_RULES,
};

/**
 * Scan situationText for unambiguous answers to structured questions.
 * Returns a map of { questionId → answerValue } to merge into confirmedAnswers.
 * Never overrides a human-confirmed answer.
 */
export function autoConfirmFromContext(
  practiceArea: string | null,
  situationText: string,
  existingConfirmed: Record<string, unknown>,
): Record<string, string> {
  if (!practiceArea) return {};
  const rules = AUTO_RULES_BY_PA[practiceArea];
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
