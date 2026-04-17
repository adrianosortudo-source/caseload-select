/**
 * round3.ts — Round 3 post-capture deep qualification.
 *
 * Responsibilities:
 *  - Determine whether a session qualifies for Round 3 based on band.
 *  - Load the sub-type-specific question bank.
 *  - Return structured questions for the widget to render.
 *
 * Band routing:
 *  - A/B: full question bank (up to 8 questions)
 *  - C:   shortened bank (4 questions — ids listed in BAND_C_QUESTIONS)
 *  - D/E: skip Round 3 entirely
 *
 * LSO compliance: questions are neutral and non-advisory.
 * Evidence inventory captures existence/location only — no uploads pre-retainer.
 */

export interface Round3Question {
  id: string;
  category: string;
  text: string;
  type: "free_text" | "structured_multi" | "structured_single";
  options?: Array<{ label: string; value: string }>;
  allow_multi_select?: boolean;
  allow_free_text?: boolean;
  free_text_label?: string;
  follow_up_condition?: string;
  follow_up_text?: string;
  /** Internal label used in memo generation — not shown to prospect. */
  memo_label: string;
}

export interface Round3Bank {
  sub_type: string;
  practice_area: string;
  questions: Round3Question[];
}

// ── Band routing ─────────────────────────────────────────────────────────────

/** Returns true if this band should receive Round 3. */
export function qualifiesForRound3(band: string | null): boolean {
  return band === "A" || band === "B" || band === "C";
}

/** Returns true if this band receives the full question bank (A/B) vs shortened (C). */
export function isFullRound3(band: string | null): boolean {
  return band === "A" || band === "B";
}

// Band C receives only these question IDs from the PI-MVA bank
const BAND_C_QUESTIONS_PI_MVA = ["pi_mva_q1", "pi_mva_q2", "pi_mva_q5", "pi_mva_q8"];

// ── Question banks ────────────────────────────────────────────────────────────

const PI_MVA_QUESTIONS: Round3Question[] = [
  {
    id: "pi_mva_q1",
    category: "jurisdiction_limitations",
    text: "When did the accident happen? Please give the date as precisely as you can.",
    type: "free_text",
    memo_label: "Incident date / Limitations status",
  },
  {
    id: "pi_mva_q2",
    category: "fact_pattern",
    text: "In your own words, describe how the collision happened. Who was involved, how many vehicles, and what was each vehicle doing at the moment of impact?",
    type: "free_text",
    memo_label: "Collision description / Fault indicators",
  },
  {
    id: "pi_mva_q3",
    category: "evidence_inventory",
    text: "Did police attend the scene? Do you have the collision report number, or have you requested the full report? Did an ambulance attend, and were you transported to hospital?",
    type: "structured_multi",
    options: [
      { label: "Police attended — I have the report number", value: "police_report_number" },
      { label: "Police attended — I haven't requested the report yet", value: "police_no_request" },
      { label: "Police attended — no report was made", value: "police_no_report" },
      { label: "No police at scene", value: "no_police" },
      { label: "Ambulance attended — I was taken to hospital", value: "ambulance_transported" },
      { label: "Ambulance attended — I was not transported", value: "ambulance_not_transported" },
      { label: "No ambulance", value: "no_ambulance" },
    ],
    allow_multi_select: true,
    allow_free_text: true,
    free_text_label: "Report number (if known)",
    memo_label: "Evidence held: Police / EMS",
  },
  {
    id: "pi_mva_q4",
    category: "evidence_inventory",
    text: "What medical treatment have you received since the accident?",
    type: "structured_multi",
    options: [
      { label: "Emergency room / hospital", value: "emergency_room" },
      { label: "Family doctor", value: "family_doctor" },
      { label: "Orthopaedic specialist", value: "orthopaedic" },
      { label: "Neurologist", value: "neurologist" },
      { label: "Physiotherapy", value: "physiotherapy" },
      { label: "Chiropractor", value: "chiropractor" },
      { label: "Psychologist / counsellor", value: "psychologist" },
      { label: "Other specialist", value: "other_specialist" },
      { label: "No treatment received yet", value: "no_treatment" },
    ],
    allow_multi_select: true,
    allow_free_text: true,
    free_text_label: "Any other treatment not listed",
    memo_label: "Medical treatment received / Records held",
  },
  {
    id: "pi_mva_q5",
    category: "evidence_inventory",
    text: "Has your own insurance company been in contact with you since the accident? What about the other driver's insurer?",
    type: "structured_multi",
    options: [
      { label: "My insurer contacted me — I have letters or emails", value: "own_insurer_written" },
      { label: "My insurer contacted me — nothing in writing yet", value: "own_insurer_verbal" },
      { label: "My insurer has not contacted me", value: "no_own_insurer" },
      { label: "The other driver's insurer contacted me — I have correspondence", value: "adverse_insurer_written" },
      { label: "The other driver's insurer contacted me — verbally only", value: "adverse_insurer_verbal" },
      { label: "I don't know who the other driver's insurer is", value: "adverse_insurer_unknown" },
      { label: "The other driver was uninsured or fled the scene", value: "uninsured_or_fled" },
    ],
    allow_multi_select: true,
    memo_label: "Insurance contact / Correspondence held",
  },
  {
    id: "pi_mva_q6",
    category: "fact_pattern_depth",
    text: "Has the accident affected your ability to work? If yes, are you employed, self-employed, or a student? Have you lost income, and do you have documentation of that loss?",
    type: "free_text",
    memo_label: "Employment impact / Income loss documentation",
  },
  {
    id: "pi_mva_q7",
    category: "conflict_and_parties",
    text: "Please give me the full legal name of the other driver, if you know it. Do you know if they have retained a lawyer? Have you received any correspondence from a lawyer acting on their behalf?",
    type: "free_text",
    memo_label: "Adverse parties / Opposing counsel",
  },
  {
    id: "pi_mva_q8",
    category: "expectations_alignment",
    text: "Have you spoken with any other lawyer about this accident? What outcome are you hoping for from this consultation, and is there a specific timeline driving your decision to reach out now?",
    type: "free_text",
    memo_label: "Prior counsel / Client expectations and urgency",
  },
];

// ── Generic fallback bank for unmapped sub-types ──────────────────────────────
// Used when a practice area is detected but no specific bank exists yet.
// Covers the five core categories with neutral, sub-type-agnostic questions.

const GENERIC_QUESTIONS: Round3Question[] = [
  {
    id: "gen_q1",
    category: "jurisdiction_limitations",
    text: "When did the incident, event, or situation you are seeking legal help for first occur? Please give the date as precisely as you can.",
    type: "free_text",
    memo_label: "Incident date / Limitations status",
  },
  {
    id: "gen_q2",
    category: "fact_pattern",
    text: "Please describe what happened in as much detail as you can. Include who was involved, what each party did, and the sequence of events.",
    type: "free_text",
    memo_label: "Fact pattern",
  },
  {
    id: "gen_q3",
    category: "evidence_inventory",
    text: "Do you have any documents related to this matter — contracts, letters, emails, notices, reports, or photographs? If yes, who currently holds them?",
    type: "free_text",
    memo_label: "Documents / Evidence held",
  },
  {
    id: "gen_q4",
    category: "conflict_and_parties",
    text: "Who are the other parties involved? Please provide their full legal names. Do you know if any of them have retained legal counsel?",
    type: "free_text",
    memo_label: "Adverse parties / Opposing counsel",
  },
  {
    id: "gen_q5",
    category: "expectations_alignment",
    text: "Have you consulted any other lawyer about this matter? What outcome are you hoping this consultation will produce, and what is your timeline?",
    type: "free_text",
    memo_label: "Prior counsel / Client expectations",
  },
];

const GENERIC_BAND_C = ["gen_q1", "gen_q2", "gen_q4", "gen_q5"];

// ── Bank registry ─────────────────────────────────────────────────────────────

type SubTypeKey = string;

interface BankEntry {
  questions: Round3Question[];
  bandCIds: string[];
}

const BANK_REGISTRY: Record<SubTypeKey, BankEntry> = {
  // PI sub-types
  "personal_injury:motor_vehicle_accident": { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "personal_injury:slip_and_fall":          { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA }, // placeholder — reuse PI bank
  "personal_injury:general":                { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "personal_injury":                        { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },

  // Generic fallback for all other PAs
  "__generic__": { questions: GENERIC_QUESTIONS, bandCIds: GENERIC_BAND_C },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolves the Round 3 question bank for a given practice area / sub-type pair.
 * Falls back to the generic bank if no specific bank is registered.
 */
export function getRound3Questions(
  practiceArea: string | null,
  subType: string | null,
  band: string | null
): Round3Question[] {
  if (!qualifiesForRound3(band)) return [];

  const pa = (practiceArea ?? "").toLowerCase().replace(/\s+/g, "_");
  const st = (subType ?? "").toLowerCase().replace(/\s+/g, "_");

  const key = st ? `${pa}:${st}` : pa;
  const entry = BANK_REGISTRY[key] ?? BANK_REGISTRY[`${pa}`] ?? BANK_REGISTRY["__generic__"];

  if (isFullRound3(band)) {
    return entry.questions;
  }

  // Band C: filter to shortened set
  const bandCIds = new Set(entry.bandCIds ?? GENERIC_BAND_C);
  return entry.questions.filter(q => bandCIds.has(q.id));
}
