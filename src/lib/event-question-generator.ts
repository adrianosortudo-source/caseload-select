/**
 * Event Question Generator
 *
 * Takes a selected ExtractedEvent and returns a single plain-English question
 * string targeting the specific information gap that event represents.
 *
 * Design rules:
 *   - No pronouns in output. Parties are addressed by role:
 *       "the other driver", "your employer", "the property seller", etc.
 *   - Auto-rewrite: if a generated question contains a pronoun, replace it
 *     from context rather than reject. Never surface a pronoun to the caller.
 *   - Targets the highest-value unknown per event type and time state.
 *   - Pure function. No LLM, no side effects. Deterministic given the same input.
 *   - Returns null only when event type is unrecognised (should not happen in prod).
 *
 * Gap taxonomy (matches corpus expected_target_gap values):
 *   when                    - time of event (limitation clock starts here)
 *   injuries                - physical harm sustained
 *   incident_report         - whether the incident was formally reported
 *   reason_given            - whether a stated reason was given for an action
 *   employment_status       - still employed vs. departed, employee vs. contractor
 *   employment_status_during_overtime - status at time of wage violation
 *   current_status          - current immigration status in Canada
 *   reason_for_removal      - grounds cited in a removal / deportation order
 *   removal_disclosure      - whether prior removal has been disclosed to IRCC
 *   written_agreement       - documentary evidence of a debt or obligation
 *   discovery_time          - when a defect or problem was first found
 *   which_incident          - disambiguation when multiple instances of same type exist
 */

import type { ExtractedEvent } from "@/lib/event-extractor";

/**
 * Event types where time is a legal prerequisite. Mirrors the selector's
 * REQUIRES_TIME map. When false, the generator skips the WHEN question even
 * if time is unresolved — a more substantive gap exists.
 */
const REQUIRES_TIME: Record<string, boolean> = {
  deportation: true,
  marriage_to_citizen: false,
  termination: true,
  unpaid_overtime: false,
  mva: true,
  slip_fall: true,
  debt_owed: true,
  real_estate_defect: false,
};

/** Map from pronoun to role-based replacement for known event types. */
const PRONOUN_REPLACEMENTS: Record<string, Record<string, string>> = {
  mva: {
    they: "the other driver",
    them: "the other driver",
    their: "the other driver's",
    he: "the other driver",
    she: "the other driver",
    him: "the other driver",
    his: "the other driver's",
    her: "the other driver's",
  },
  termination: {
    they: "your employer",
    them: "your employer",
    their: "your employer's",
    he: "your employer",
    she: "your employer",
    him: "your employer",
    his: "your employer's",
    her: "your employer's",
  },
  unpaid_overtime: {
    they: "your employer",
    them: "your employer",
    their: "your employer's",
  },
  slip_fall: {
    they: "the property owner",
    them: "the property owner",
    their: "the property owner's",
  },
  real_estate_defect: {
    they: "the seller",
    them: "the seller",
    their: "the seller's",
  },
  debt_owed: {
    they: "the borrower",
    them: "the borrower",
    their: "the borrower's",
  },
  deportation: {
    they: "the immigration officer",
    them: "the immigration officer",
    their: "the immigration officer's",
  },
  marriage_to_citizen: {
    they: "your partner",
    them: "your partner",
    their: "your partner's",
  },
};

const PRONOUN_PATTERN = /\b(they|them|their|he|she|him|his|her)\b/gi;

/**
 * Replace any pronouns in a question string with role-based alternatives.
 * Safe to call on any string — returns unchanged text when no pronouns found
 * or when event type has no replacement map.
 */
function rewritePronouns(question: string, eventType: string): string {
  const replacements = PRONOUN_REPLACEMENTS[eventType];
  if (!replacements) return question;

  return question.replace(PRONOUN_PATTERN, (match) => {
    const lower = match.toLowerCase();
    return replacements[lower] ?? match;
  });
}

/** Questions targeting the WHEN gap (no time anchor present). */
const WHEN_QUESTIONS: Record<string, string> = {
  slip_fall: "When did the incident happen?",
  mva: "When did the accident happen?",
  termination: "When were you let go?",
  unpaid_overtime: "How long has the overtime gone unpaid?",
  deportation: "When did the removal order take effect?",
  debt_owed: "When did you loan the money?",
  real_estate_defect: "When did you discover the problem?",
  marriage_to_citizen: "When are you planning to apply for sponsorship?",
};

/** Questions for resolved events targeting the next meaningful gap. */
const RESOLVED_QUESTIONS: Record<string, (event: ExtractedEvent) => string> = {
  slip_fall: (event) => {
    if (event.attributes.known.includes("incident_reported")) {
      return "Did you get any medical treatment after the incident?";
    }
    return "Did you report the incident to the property owner or manager that day?";
  },

  mva: (event) => {
    if (event.attributes.known.includes("other_driver_fault") || event.attributes.known.includes("ran_red_light")) {
      return "Did you get any medical treatment after the accident?";
    }
    return "Were you the driver, a passenger, or a pedestrian?";
  },

  termination: (event) => {
    if (event.time && /last\s+week|yesterday|today|\d+\s+days?\s+ago/i.test(event.time)) {
      return "Did your employer give any reason for letting you go?";
    }
    return "Did your employer give any reason for letting you go?";
  },

  unpaid_overtime: () =>
    "Are you currently still employed there, or have you left?",

  deportation: () =>
    "What reason was given in the removal order?",

  marriage_to_citizen: () =>
    "What is your current immigration status in Canada?",

  debt_owed: () =>
    "Is there a written agreement, contract, or message record for the loan?",

  real_estate_defect: () =>
    "When did you first discover the problem?",
};

/** Disambiguation question when multiple instances of the same type are detected. */
const MULTI_INSTANCE_QUESTIONS: Partial<Record<string, string>> = {
  termination: "Which of those situations do you want to focus on?",
  mva: "Which of those accidents do you want to focus on?",
  slip_fall: "Which of those incidents do you want to focus on?",
};

/**
 * One-sentence preambles shown as grey subtext beneath the first event question.
 * Warm, plain English. Never clinical. No outcome promises, no LSO-prohibited language.
 * Keyed by the gap the question is targeting, not the event type, to avoid repetition
 * when the same type produces different questions depending on state.
 */
const PREAMBLE_BY_GAP: Record<string, string> = {
  // WHEN gap — time is unresolved
  slip_fall_when: "Knowing when the incident happened helps us identify which legal rules and timelines apply.",
  mva_when: "The date of the accident determines which rules and deadlines are relevant to your situation.",
  termination_when: "Knowing when you were let go helps us work out which timelines and obligations apply.",
  debt_owed_when: "The date the loan was made affects which legal options are still open to you.",
  deportation_when: "The date the removal order took effect determines what steps may still be available.",
  // Substantive gap — time is resolved (or REQUIRES_TIME = false)
  slip_fall_report: "Whether the incident was reported affects the strength of any future claim.",
  mva_role: "Your role in the accident affects how a potential claim would be assessed.",
  mva_injuries: "Medical treatment records are one of the key factors in evaluating a personal injury case.",
  termination_reason: "The reason given for a dismissal often determines whether it is challengeable.",
  unpaid_overtime_status: "Your current employment status affects the type of claim and how it is calculated.",
  deportation_reason: "The grounds stated in a removal order shape which legal responses are available.",
  marriage_to_citizen_status: "Your current immigration status in Canada determines which sponsorship pathway applies.",
  debt_owed_agreement: "A written record of the loan significantly affects the options available to recover it.",
  real_estate_defect_discovery: "When the problem was first discovered affects whether a legal claim is still timely.",
  // Multi-instance disambiguation
  multi: "You mentioned more than one situation. Focusing on the right one helps us give you accurate information.",
};

/**
 * Generate a targeted intake question for a selected event.
 *
 * Returns null only when the event type is unrecognised. Callers should
 * fall back to the standard question bank in that case.
 */
export function generateQuestion(
  event: ExtractedEvent,
  allEventsOfSameType?: ExtractedEvent[],
): string | null {
  const { type } = event;

  // Disambiguation: multiple instances of the same event type
  if (allEventsOfSameType && allEventsOfSameType.length > 1) {
    const multiQ = MULTI_INSTANCE_QUESTIONS[type];
    if (multiQ) return rewritePronouns(multiQ, type);
  }

  // Primary gap: time not resolved AND time is a legal requirement for this type.
  // For types where REQUIRES_TIME = false, skip straight to the substantive question.
  if (!event.time_resolved && REQUIRES_TIME[type] !== false) {
    const whenQ = WHEN_QUESTIONS[type];
    if (whenQ) return rewritePronouns(whenQ, type);
  }

  // Secondary gap: time resolved, target next unknown
  const resolvedFn = RESOLVED_QUESTIONS[type];
  if (resolvedFn) {
    return rewritePronouns(resolvedFn(event), type);
  }

  return null;
}

/**
 * Generate a one-sentence preamble (grey subtext) for the event-derived question.
 *
 * Explains briefly why we need the answer — makes the first question feel like
 * a conversation rather than a form. Safe to display directly to clients.
 *
 * Returns null when the event type is unrecognised (same contract as generateQuestion).
 */
export function generatePreamble(
  event: ExtractedEvent,
  allEventsOfSameType?: ExtractedEvent[],
): string | null {
  const { type } = event;

  // Multi-instance: same preamble for all types
  if (allEventsOfSameType && allEventsOfSameType.length > 1) {
    if (MULTI_INSTANCE_QUESTIONS[type]) return PREAMBLE_BY_GAP["multi"];
  }

  // WHEN gap
  if (!event.time_resolved && REQUIRES_TIME[type] !== false) {
    const key = `${type}_when`;
    return PREAMBLE_BY_GAP[key] ?? null;
  }

  // Substantive gap — derive the key from which question the resolved path would pick
  if (type === "slip_fall") {
    return event.attributes.known.includes("incident_reported")
      ? PREAMBLE_BY_GAP["slip_fall_injuries"] ?? PREAMBLE_BY_GAP["slip_fall_report"]
      : PREAMBLE_BY_GAP["slip_fall_report"];
  }
  if (type === "mva") {
    return (event.attributes.known.includes("other_driver_fault") || event.attributes.known.includes("ran_red_light"))
      ? PREAMBLE_BY_GAP["mva_injuries"]
      : PREAMBLE_BY_GAP["mva_role"];
  }
  if (type === "termination")  return PREAMBLE_BY_GAP["termination_reason"];
  if (type === "unpaid_overtime") return PREAMBLE_BY_GAP["unpaid_overtime_status"];
  if (type === "deportation")  return PREAMBLE_BY_GAP["deportation_reason"];
  if (type === "marriage_to_citizen") return PREAMBLE_BY_GAP["marriage_to_citizen_status"];
  if (type === "debt_owed")    return PREAMBLE_BY_GAP["debt_owed_agreement"];
  if (type === "real_estate_defect") return PREAMBLE_BY_GAP["real_estate_defect_discovery"];

  return null;
}
