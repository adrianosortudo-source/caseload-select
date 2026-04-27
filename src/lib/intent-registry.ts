/**
 * intent-registry.ts — canonical fact intents the system tracks across the
 * entire intake (R1/R2/R3, slots, all channels).
 *
 * THIS IS THE CONTRACT.
 *
 * Today the system stores answers keyed by the AI's question IDs (e.g.
 * `pi_dog_bite_q16`, `emp_constructive_q2`, or whatever the AI invents on a
 * given turn). That makes dedupe brittle  -  if the AI uses a different ID,
 * dedupe misses the duplicate.
 *
 * This registry inverts the model: every fact the system needs is given a
 * stable canonical key (an "intent") that the AI can never invent or rename.
 * When facts are extracted from the kickoff text, they're written to
 * scoring._intents under these keys. R1/R2/R3 dedupe layers then check the
 * intents map first, before falling back to ID-based wildcard rules.
 *
 * Design notes:
 *  - Intents are practice-area-aware: each declares which PAs it applies to.
 *    A PI session won't extract "termination_type"; an employment session won't
 *    extract "collision_pattern".
 *  - Intent VALUES use stable enums where possible (so downstream scoring can
 *    rely on them) and free-form strings only as a last resort.
 *  - The set is intentionally small (~20 intents). Expand only when a real
 *    dedupe gap demonstrates the need. Premature expansion bloats the prompt.
 *
 * Future direction (not yet in scope):
 *  - Each intent declares a CPI delta so scoring becomes deterministic
 *  - Each intent declares a memo template fragment for direct memo composition
 *  - Question library declares which intent each question fills, enabling
 *    "skip questions whose intent is filled" without category-mapping
 */

export type PracticeArea = "pi" | "emp" | "fam" | "imm" | "civ" | "crim" | "ins" | "all";

export interface Intent {
  /** Stable canonical key. Used as the JSONB key in scoring._intents. */
  key: string;
  /** Short human-readable label, used in the GPT extraction prompt. */
  label: string;
  /** Description for GPT  -  what fact this intent captures. */
  description: string;
  /** Practice areas this intent applies to. "all" = practice-area-agnostic. */
  appliesTo: PracticeArea[];
  /** Stable enum of allowed values (preferred). When the value is more nuanced,
   *  uses null and the extraction returns the closest interpretation as a string. */
  enum?: string[];
  /** Question IDs in the seeded library that fill this same intent. Used to
   *  back-fill _intents from legacy _confirmed maps and to dedupe questions
   *  that share intent. Both short and long sub-type prefixes listed. */
  questionIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Core intents (initial set  -  expand based on real dedupe needs)
// ─────────────────────────────────────────────────────────────────────────────

export const INTENTS: Intent[] = [
  // ── Universal ──
  {
    key: "incident_timing",
    label: "When the incident happened",
    description: "Bucket of how recently the incident, accident, attack, dismissal, separation, or relevant event occurred. Extract only when explicitly mentioned (e.g. 'last week', 'two months ago', 'in 2023', 'last summer').",
    appliesTo: ["all"],
    enum: ["today_week", "within_month", "1_6mo", "6mo_2yr", "over_2yr"],
    questionIds: [
      "pi_q16", "pi_q1",
      "pi_mva_q16", "pi_mva_q1",
      "pi_sf_q16", "pi_sf_q1", "pi_slip_fall_q16", "pi_slip_fall_q1",
      "pi_db_q16", "pi_db_q1", "pi_dog_bite_q16", "pi_dog_bite_q1",
      "pi_other_q16", "pi_other_q1",
      "pi_med_mal_q16", "pi_product_q16", "pi_workplace_q16", "pi_assault_ci_q16",
      "emp_q16", "emp_dis_q16", "emp_dismissal_q16",
      "emp_har_q16", "emp_harassment_q16",
      "emp_disc_q16", "emp_con_q16", "emp_constructive_q16",
      "emp_wage_q16", "emp_other_q16",
      "fam_q29", "fam_q30",
      "crim_q19", "crim_q20",
      "imm_q16",
      "civ_q16",
      "gen_q1", "pi_mva_q1",
    ],
  },
  {
    key: "treatment_received",
    label: "Whether they got medical treatment",
    description: "Did the prospect receive any medical treatment for an injury arising from the incident? Extract only when mentioned (e.g. 'I went to the ER', 'saw a doctor', 'no injuries needed treatment').",
    appliesTo: ["pi"],
    enum: ["immediate", "within_week", "delayed", "not_yet", "no_injuries"],
    questionIds: [
      "pi_q17", "pi_mva_q17", "pi_sf_q17",
      "pi_db_q17", "pi_dog_bite_q17",
      "pi_other_q17", "pi_med_mal_q17", "pi_product_q17", "pi_workplace_q17", "pi_assault_ci_q17",
    ],
  },
  {
    key: "fault_pattern",
    label: "How the incident happened",
    description: "Mechanism of the personal injury incident: rear-end collision, head-on, side-impact, slip-fall, dog attack, etc. Extract only when the mechanism is explicit.",
    appliesTo: ["pi"],
    enum: ["rear_end", "side_impact", "head_on", "pedestrian", "single_vehicle", "slip_fall", "dog_bite", "other"],
    questionIds: [
      "pi_q31", "pi_q2",
      "pi_mva_q31", "pi_mva_q2",
      "pi_sf_q31", "pi_sf_q2", "pi_slip_fall_q31", "pi_slip_fall_q2",
      "pi_db_q31", "pi_db_q2", "pi_dog_bite_q31", "pi_dog_bite_q2",
      "pi_other_q31", "pi_other_q2",
    ],
  },
  {
    key: "tenure",
    label: "Length of employment",
    description: "How long the prospect was employed at the firm or company in question, expressed as a duration band.",
    appliesTo: ["emp"],
    enum: ["under_1yr", "1_5yr", "5_15yr", "over_15yr"],
    questionIds: [
      "emp_q47", "emp_dis_q47", "emp_dismissal_q47",
      "emp_har_q47", "emp_harassment_q47",
      "emp_disc_q47", "emp_con_q47", "emp_constructive_q47",
      "emp_wage_q47", "emp_other_q47",
      "emp_tenure",
    ],
  },
  {
    key: "role_level",
    label: "Job seniority level",
    description: "Prospect's role level: junior, mid-level individual contributor, senior IC, manager, or executive.",
    appliesTo: ["emp"],
    enum: ["junior", "mid", "senior_ic", "manager", "executive"],
    questionIds: [
      "emp_q46", "emp_dis_q46", "emp_dismissal_q46",
      "emp_har_q46", "emp_harassment_q46",
      "emp_disc_q46", "emp_con_q46", "emp_constructive_q46",
      "emp_wage_q46", "emp_other_q46",
    ],
  },
  {
    key: "termination_type",
    label: "How they left employment",
    description: "How the employment ended: terminated without cause, with cause, laid off, constructive dismissal (forced to resign), or voluntary resignation.",
    appliesTo: ["emp"],
    enum: ["without_cause", "with_cause", "laid_off", "constructive", "resignation"],
    questionIds: [
      "emp_q31", "emp_dis_q31", "emp_dismissal_q31",
      "emp_termination_type",
    ],
  },
  {
    key: "severity",
    label: "Severity of injury or harm",
    description: "How serious are the injuries: minor, moderate, significant, severe (surgery/hospitalisation), or permanent.",
    appliesTo: ["pi"],
    enum: ["minor", "moderate", "significant", "severe", "permanent"],
    questionIds: [
      "pi_db_q31", "pi_dog_bite_q31",
      "pi_mva_q33",
    ],
  },
  {
    key: "prior_counsel",
    label: "Whether they have spoken to another lawyer",
    description: "Has the prospect already consulted another lawyer about this matter?",
    appliesTo: ["all"],
    enum: ["first_consult", "spoke_no_retain", "still_considering", "urgent_deadline", "currently_represented"],
    questionIds: [],
  },
  {
    key: "deadline_pressure",
    label: "Whether there is a hard deadline driving the matter",
    description: "Is there a specific deadline, court date, expiry, or limitation period the prospect mentioned?",
    appliesTo: ["all"],
    enum: ["no_deadline", "soft_deadline", "hard_deadline_30d", "hard_deadline_90d", "limitations_concern"],
    questionIds: [],
  },
  {
    key: "police_involvement",
    label: "Whether police attended or filed a report",
    description: "For PI / criminal matters: did police attend the scene or file a report?",
    appliesTo: ["pi", "crim"],
    enum: ["report_filed", "attended_no_report", "no_police", "unknown"],
    questionIds: ["r2_police_report"],
  },
  {
    key: "documentation_held",
    label: "Whether they have documents related to the matter",
    description: "Does the prospect have written records, contracts, photos, or correspondence relevant to the case?",
    appliesTo: ["all"],
    enum: ["complete", "partial", "minimal", "none"],
    questionIds: [],
  },
  {
    key: "insurance_status",
    label: "Insurance coverage involved",
    description: "Whether insurance applies and any communications with insurers.",
    appliesTo: ["pi", "ins"],
    enum: ["own_insurer_engaged", "other_insurer_engaged", "uninsured", "no_contact", "unknown"],
    questionIds: ["r2_insurer_communications"],
  },
  {
    key: "witness_availability",
    label: "Whether witnesses to the incident exist",
    description: "Were there witnesses to the incident and can they be contacted?",
    appliesTo: ["pi", "crim", "emp"],
    enum: ["yes_independent", "yes_related", "none", "unknown"],
    questionIds: ["pi_q32", "pi_mva_q32", "pi_sf_q32"],
  },
  {
    key: "prior_complaint",
    label: "Whether they raised a formal complaint before this",
    description: "For employment harassment / dismissal: did the prospect file an HR complaint, grievance, or written objection before the matter escalated?",
    appliesTo: ["emp"],
    enum: ["written", "verbal", "considered", "none"],
    questionIds: [],
  },
  {
    key: "marriage_status",
    label: "Marriage / relationship status",
    description: "For family or immigration sponsorship matters: married, common-law, separated, divorced, etc.",
    appliesTo: ["fam", "imm"],
    enum: ["married_canada", "married_abroad", "common_law", "separated", "divorced", "engaged"],
    questionIds: [],
  },
  {
    key: "immigration_status",
    label: "Current immigration status in Canada",
    description: "Citizen, permanent resident, work permit, study permit, visitor, or no current status.",
    appliesTo: ["imm"],
    enum: ["citizen", "pr", "work_permit_long", "work_permit_short", "study_permit", "visitor", "no_status", "other"],
    questionIds: [],
  },
];

/**
 * Lookup an intent by its canonical key.
 */
export function getIntent(key: string): Intent | undefined {
  return INTENTS.find(i => i.key === key);
}

/**
 * Reverse-lookup: given a question ID (canonical or AI-emitted), return the
 * intent that question fills, if any. Used to back-fill _intents from a
 * legacy _confirmed map.
 */
export function intentForQuestionId(questionId: string): Intent | undefined {
  // Exact match first
  for (const intent of INTENTS) {
    if (intent.questionIds.includes(questionId)) return intent;
  }
  // Suffix-match for AI-invented variants (e.g. pi_some_new_q16 → matches q16 timing)
  const tail = questionId.match(/_q\d+$/)?.[0];
  if (tail) {
    for (const intent of INTENTS) {
      if (intent.questionIds.some(qid => qid.endsWith(tail))) return intent;
    }
  }
  return undefined;
}

/**
 * Filter intents to those applicable to a practice area.
 */
export function intentsForPracticeArea(pa: string | null): Intent[] {
  const norm = (pa ?? "").toLowerCase().slice(0, 3);
  if (!norm) return INTENTS.filter(i => i.appliesTo.includes("all"));
  return INTENTS.filter(i => i.appliesTo.includes("all") || i.appliesTo.includes(norm as PracticeArea));
}
