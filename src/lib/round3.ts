/**
 * round3.ts  -  Round 3 post-capture deep qualification.
 *
 * Responsibilities:
 *  - Determine whether a session qualifies for Round 3 based on band.
 *  - Load the sub-type-specific question bank.
 *  - Return structured questions for the widget to render.
 *
 * Band routing:
 *  - A/B: full question bank (up to 8 questions)
 *  - C:   shortened bank (4 questions  -  ids listed in BAND_C_QUESTIONS)
 *  - D/E: skip Round 3 entirely
 *
 * LSO compliance: questions are neutral and non-advisory.
 * Evidence inventory captures existence/location only  -  no uploads pre-retainer.
 */

export interface Round3Question {
  id: string;
  category: string;
  text: string;
  type: "free_text" | "structured_multi" | "structured_single" | "file";
  options?: Array<{ label: string; value: string }>;
  allow_multi_select?: boolean;
  allow_free_text?: boolean;
  free_text_label?: string;
  follow_up_condition?: string;
  follow_up_text?: string;
  /** Internal label used in memo generation  -  not shown to prospect. */
  memo_label: string;
  /**
   * Server-side conditional: suppress this question when a confirmed R1/R2
   * answer matches. Key: R1/R2 question ID. Value: answer values that suppress
   * this question. Applied in /api/screen/round3/start before LLM rewrite.
   */
  excludeWhen?: Record<string, string[]>;
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
      { label: "Police attended  -  I have the report number", value: "police_report_number" },
      { label: "Police attended  -  I haven't requested the report yet", value: "police_no_request" },
      { label: "Police attended  -  no report was made", value: "police_no_report" },
      { label: "No police at scene", value: "no_police" },
      { label: "Ambulance attended  -  I was taken to hospital", value: "ambulance_transported" },
      { label: "Ambulance attended  -  I was not transported", value: "ambulance_not_transported" },
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
    // Suppress if client already confirmed no injuries in R1/R2.
    // Three IDs: pi_q17 (generic PI base), pi_mva_q17 (MVA sub-module),
    // pi_sf_q17 (slip-and-fall sub-module) — all store value "no_injuries".
    excludeWhen: { "pi_q17": ["no_injuries"], "pi_mva_q17": ["no_injuries"], "pi_sf_q17": ["no_injuries"] },
  },
  {
    id: "pi_mva_q5",
    category: "evidence_inventory",
    text: "Has your own insurance company been in contact with you since the accident? What about the other driver's insurer?",
    type: "structured_multi",
    options: [
      { label: "My insurer contacted me  -  I have letters or emails", value: "own_insurer_written" },
      { label: "My insurer contacted me  -  nothing in writing yet", value: "own_insurer_verbal" },
      { label: "My insurer has not contacted me", value: "no_own_insurer" },
      { label: "The other driver's insurer contacted me  -  I have correspondence", value: "adverse_insurer_written" },
      { label: "The other driver's insurer contacted me  -  verbally only", value: "adverse_insurer_verbal" },
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
    // Suppress if client already confirmed no injuries in R1/R2 — income loss
    // is not relevant when no injury was reported.
    // Three IDs: pi_q17 (generic PI base), pi_mva_q17 (MVA sub-module),
    // pi_sf_q17 (slip-and-fall sub-module) — all store value "no_injuries".
    excludeWhen: { "pi_q17": ["no_injuries"], "pi_mva_q17": ["no_injuries"], "pi_sf_q17": ["no_injuries"] },
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
    text: "Do you have any documents related to this matter  -  contracts, letters, emails, notices, reports, or photographs? If yes, who currently holds them?",
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

// ── Employment Law  -  Wrongful Dismissal ─────────────────────────────────────

const EMPLOYMENT_DISMISSAL_QUESTIONS: Round3Question[] = [
  {
    id: "emp_dis_q1",
    category: "jurisdiction_limitations",
    text: "When did your employment start, and when were you terminated? Please give dates as precisely as you can.",
    type: "free_text",
    memo_label: "Employment tenure / Limitations analysis",
  },
  {
    id: "emp_dis_q2",
    category: "fact_pattern",
    text: "What was your job title and a brief description of your main responsibilities? Were you in a management or supervisory role?",
    type: "free_text",
    memo_label: "Role and seniority / Character of employment",
  },
  {
    id: "emp_dis_q3",
    category: "evidence_inventory",
    text: "Which of the following documents do you currently have?",
    type: "structured_multi",
    options: [
      { label: "Written employment contract or offer letter", value: "employment_contract" },
      { label: "Termination letter or written notice", value: "termination_letter" },
      { label: "Severance or separation agreement (signed or unsigned)", value: "separation_agreement" },
      { label: "Performance reviews or written evaluations", value: "performance_reviews" },
      { label: "Written warnings or disciplinary records", value: "disciplinary_records" },
      { label: "Relevant emails or internal communications", value: "internal_emails" },
      { label: "Pay stubs for the relevant period", value: "paystubs" },
    ],
    allow_multi_select: true,
    memo_label: "Documents held",
  },
  {
    id: "emp_dis_q4",
    category: "fact_pattern_depth",
    text: "Were there any HR complaints, grievances, or workplace disputes in the period before your termination? Did you raise any concerns about pay, conditions, or treatment with your employer?",
    type: "free_text",
    memo_label: "Pre-termination complaints / Reprisal indicators",
  },
  {
    id: "emp_dis_q5",
    category: "conflict_and_parties",
    text: "Were you asked to sign anything at the time of termination or since?",
    type: "structured_single",
    options: [
      { label: "Yes, I signed  -  I have a copy", value: "signed_have_copy" },
      { label: "Yes, I signed  -  I don't have a copy", value: "signed_no_copy" },
      { label: "I was asked to sign but declined", value: "declined_to_sign" },
      { label: "Nothing was presented to me", value: "nothing_presented" },
    ],
    memo_label: "Release or waiver status",
  },
  {
    id: "emp_dis_q6",
    category: "fact_pattern_depth",
    text: "What is your current income situation since the termination? Are you working, receiving EI, or currently without income?",
    type: "free_text",
    memo_label: "Mitigation / Current income status",
  },
  {
    id: "emp_dis_q7",
    category: "expectations_alignment",
    text: "Have you consulted any other lawyer about this matter? What outcome are you hoping for, and is there a specific deadline or pressure driving your decision to reach out now?",
    type: "free_text",
    memo_label: "Prior counsel / Client expectations and urgency",
  },
];

const BAND_C_QUESTIONS_EMP_DIS = ["emp_dis_q1", "emp_dis_q3", "emp_dis_q6", "emp_dis_q7"];

// ── Employment Law  -  Wage Claims ────────────────────────────────────────────

const EMPLOYMENT_WAGE_QUESTIONS: Round3Question[] = [
  {
    id: "emp_wage_q1",
    category: "jurisdiction_limitations",
    text: "When did the unpaid overtime begin? Please give the start date as precisely as you can, and confirm whether you are still employed at this company.",
    type: "free_text",
    memo_label: "Claim period / Current employment status",
  },
  {
    id: "emp_wage_q2",
    category: "fact_pattern",
    text: "What is your hourly or annual salary? Approximately how many hours per week were you working during the period of unpaid overtime?",
    type: "free_text",
    memo_label: "Compensation details / Overtime calculation basis",
  },
  {
    id: "emp_wage_q3",
    category: "evidence_inventory",
    text: "Which of the following do you currently have?",
    type: "structured_multi",
    options: [
      { label: "Written employment contract or offer letter", value: "employment_contract" },
      { label: "Timesheets, schedules, or personal hours records", value: "hours_records" },
      { label: "Pay stubs or direct deposit records for the period", value: "paystubs" },
      { label: "Emails or messages about hours or workload", value: "communications" },
      { label: "Any written response from your employer about overtime", value: "employer_response" },
    ],
    allow_multi_select: true,
    memo_label: "Documents and evidence held",
  },
  {
    id: "emp_wage_q4",
    category: "fact_pattern_depth",
    text: "Have you raised the overtime issue with your employer, HR, or a manager? If yes, what was the response, and was anything communicated in writing?",
    type: "free_text",
    memo_label: "Internal complaint history / Employer response",
  },
  {
    id: "emp_wage_q5",
    category: "conflict_and_parties",
    text: "Are there other employees in your workplace who have experienced the same unpaid overtime situation?",
    type: "structured_single",
    options: [
      { label: "Yes, I know of others in the same situation", value: "yes_others" },
      { label: "Possibly  -  I haven't discussed it with colleagues", value: "possibly" },
      { label: "No  -  this appears to be my situation alone", value: "no" },
    ],
    memo_label: "Class action potential / Other affected employees",
  },
  {
    id: "emp_wage_q6",
    category: "expectations_alignment",
    text: "Have you consulted any other lawyer about this? What outcome are you hoping for, and is there any deadline or urgency driving your decision to act now?",
    type: "free_text",
    memo_label: "Prior counsel / Client expectations and urgency",
  },
];

const BAND_C_QUESTIONS_EMP_WAGE = ["emp_wage_q1", "emp_wage_q2", "emp_wage_q3", "emp_wage_q6"];

// ── Immigration Law  -  Spousal Sponsorship ───────────────────────────────────

const IMMIGRATION_SPOUSAL_QUESTIONS: Round3Question[] = [
  {
    id: "imm_sp_q1",
    category: "jurisdiction_limitations",
    text: "What type of permit or status do you currently hold, and when does it expire? Please give the exact expiry date if you have it available.",
    type: "free_text",
    memo_label: "Current status / Expiry date / Pathway urgency",
  },
  {
    id: "imm_sp_q2",
    category: "fact_pattern",
    text: "When did you and your partner meet? How long have you been together, and are you currently living together?",
    type: "free_text",
    memo_label: "Relationship timeline / Cohabitation history",
  },
  {
    id: "imm_sp_q3",
    category: "evidence_inventory",
    text: "Which of the following relationship documents do you currently have?",
    type: "structured_multi",
    options: [
      { label: "Photographs together (at different times and locations)", value: "photos" },
      { label: "Joint lease or mortgage documents", value: "joint_lease" },
      { label: "Shared utility or bank accounts", value: "shared_accounts" },
      { label: "Travel records together (flights, hotel, etc.)", value: "travel_records" },
      { label: "Communications (messages, emails, call records)", value: "communications" },
      { label: "Statutory declarations from friends or family", value: "statutory_declarations" },
      { label: "Marriage certificate (if already married)", value: "marriage_certificate" },
    ],
    allow_multi_select: true,
    memo_label: "Relationship evidence inventory",
  },
  {
    id: "imm_sp_q4",
    category: "fact_pattern_depth",
    text: "Tell me about the sponsor. Are they a Canadian citizen or permanent resident? How long have they lived in Canada? Have they sponsored anyone before?",
    type: "free_text",
    memo_label: "Sponsor eligibility / Prior undertakings",
  },
  {
    id: "imm_sp_q5",
    category: "fact_pattern_depth",
    text: "Have you ever been refused a visa or immigration application in Canada or any other country? Have you ever had an enforcement action (deportation order, removal, or overstay) in any country?",
    type: "structured_single",
    options: [
      { label: "No refusals or enforcement history", value: "none" },
      { label: "One refusal  -  no enforcement history", value: "one_refusal" },
      { label: "Multiple refusals", value: "multiple_refusals" },
      { label: "I have had an enforcement action", value: "enforcement" },
      { label: "I prefer to discuss this with the lawyer directly", value: "prefer_not" },
    ],
    memo_label: "Immigration history / Refusals / Enforcement",
  },
  {
    id: "imm_sp_q6",
    category: "fact_pattern_depth",
    text: "When is the marriage taking place, and where? Will it be a civil or religious ceremony, and will it be registered in Canada?",
    type: "free_text",
    memo_label: "Marriage details / Registration",
  },
  {
    id: "imm_sp_q7",
    category: "evidence_inventory",
    text: "Do you have a valid passport, and when does it expire? Are there any criminality or health issues that could affect your admissibility?",
    type: "free_text",
    memo_label: "Passport validity / Admissibility flags",
  },
  {
    id: "imm_sp_q8",
    category: "expectations_alignment",
    text: "Have you consulted any other immigration lawyer or consultant about this matter? What is your most important priority right now  -  speed, cost, or certainty  -  and is there a hard deadline we need to plan around?",
    type: "free_text",
    memo_label: "Prior counsel / Client priorities and timeline",
  },
];

const BAND_C_QUESTIONS_IMM_SP = ["imm_sp_q1", "imm_sp_q2", "imm_sp_q3", "imm_sp_q8"];

// ── Bank registry ─────────────────────────────────────────────────────────────

type SubTypeKey = string;

interface BankEntry {
  questions: Round3Question[];
  bandCIds: string[];
}

const BANK_REGISTRY: Record<SubTypeKey, BankEntry> = {
  // PI sub-types
  "personal_injury:motor_vehicle_accident": { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "personal_injury:slip_and_fall":          { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "personal_injury:general":                { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "personal_injury":                        { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },

  // Employment Law sub-types
  "employment_law:wrongful_dismissal":      { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS },
  "employment_law:wage_claim":              { questions: EMPLOYMENT_WAGE_QUESTIONS,       bandCIds: BAND_C_QUESTIONS_EMP_WAGE },
  "employment_law":                         { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS },

  // Immigration Law sub-types
  "immigration_law:spousal_sponsorship":    { questions: IMMIGRATION_SPOUSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_IMM_SP },
  "immigration_law":                        { questions: IMMIGRATION_SPOUSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_IMM_SP },

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
