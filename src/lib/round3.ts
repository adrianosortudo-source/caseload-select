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
  /**
   * Optional widget rendering hint for IntakeWidget v2.
   *   "card"   - decision card layout, 1 question per screen
   *   "chip"   - chip pills (used for short structured_single questions)
   *   "slider" - bucketed slider (numeric / ordinal options)
   *   "text"   - free-text textarea (default for type=free_text)
   * When omitted, the widget auto-resolves from `type`.
   */
  presentation?: "card" | "chip" | "slider" | "text";
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
    text: "When did the accident happen?",
    type: "structured_single",
    options: [
      { label: "Today or within the last week",  value: "today_week" },
      { label: "Within the last month",           value: "within_month" },
      { label: "1 to 6 months ago",               value: "1_6mo" },
      { label: "6 months to 2 years ago",         value: "6mo_2yr" },
      { label: "Over 2 years ago",                value: "over_2yr" },
    ],
    memo_label: "Incident date / Limitations status",
    // Suppress when the timing question has already been answered in R1.
    // pi_q16 (generic PI base): "When did the accident happen?" — any value
    // here means we already have the timing signal, no need to re-ask in R3.
    // Suppress when ANY R1 timing answer was captured. Coverage based on
    // production query of intake_sessions.scoring._confirmed across 14 real
    // sessions: the AI emits both short (pi_db_q16) and long (pi_dog_bite_q16)
    // sub-type prefixes interchangeably, plus the q1 variant for some banks.
    excludeWhen: {
      "pi_q16": ["*"],          "pi_q1":  ["*"],
      "pi_mva_q16": ["*"],      "pi_mva_q1":  ["*"],
      "pi_sf_q16": ["*"],       "pi_sf_q1":   ["*"],
      "pi_slip_fall_q16": ["*"],"pi_slip_fall_q1": ["*"],
      "pi_db_q16": ["*"],       "pi_db_q1":   ["*"],
      "pi_dog_bite_q16": ["*"], "pi_dog_bite_q1": ["*"],
      "pi_other_q16": ["*"],    "pi_other_q1": ["*"],
      "pi_med_mal_q16": ["*"],
      "pi_product_q16": ["*"],
      "pi_workplace_q16": ["*"],
      "pi_assault_ci_q16": ["*"],
    },
  },
  {
    id: "pi_mva_q2",
    category: "fact_pattern",
    text: "How did the collision happen?",
    type: "structured_single",
    options: [
      { label: "I was stopped, hit from behind",                       value: "rear_end_stopped" },
      { label: "I was moving, hit from behind",                        value: "rear_end_moving" },
      { label: "Intersection — the other driver ran a light or sign",  value: "intersection_other_fault" },
      { label: "Intersection — I may share fault",                     value: "intersection_shared" },
      { label: "Lane-change or merge collision",                       value: "lane_change" },
      { label: "Head-on or oncoming",                                  value: "head_on" },
      { label: "Single-vehicle (lost control, road conditions)",       value: "single_vehicle" },
      { label: "Something else",                                       value: "other" },
    ],
    allow_free_text: true,
    memo_label: "Collision description / Fault indicators",
    // Suppress when collision pattern already captured in R1 via pi_q31.
    // Collision / incident pattern dedupe — covers all PI sub-types both
    // short and long ID variants seen in production data.
    excludeWhen: {
      "pi_q31": ["*"],          "pi_q2":  ["*"],
      "pi_mva_q31": ["*"],      "pi_mva_q2":  ["*"],
      "pi_sf_q31": ["*"],       "pi_sf_q2":   ["*"],
      "pi_slip_fall_q31": ["*"],"pi_slip_fall_q2": ["*"],
      "pi_db_q31": ["*"],       "pi_db_q2":   ["*"],
      "pi_dog_bite_q31": ["*"], "pi_dog_bite_q2": ["*"],
      "pi_other_q31": ["*"],    "pi_other_q2": ["*"],
      "pi_med_mal_q31": ["*"],
      "pi_product_q31": ["*"],
      "pi_workplace_q31": ["*"],
      "pi_assault_ci_q31": ["*"],
    },
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
    text: "Has the accident affected your ability to work?",
    type: "structured_single",
    options: [
      { label: "Yes — I have lost income and have documents proving it",       value: "loss_documented" },
      { label: "Yes — I have lost income but no documents yet",                 value: "loss_undocumented" },
      { label: "Yes — I am off work but income is paid (sick leave, EI, disability)", value: "off_work_paid" },
      { label: "Yes — I am self-employed, harder to document loss",             value: "self_employed_loss" },
      { label: "No — I am working as before",                                   value: "no_impact" },
      { label: "I am a student or not in the workforce",                        value: "not_employed" },
    ],
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
    text: "What do you know about the other driver and any lawyer acting for them?",
    type: "structured_single",
    options: [
      { label: "I know who the driver is and have not heard from a lawyer for them",  value: "known_no_counsel" },
      { label: "I know who the driver is and have heard from their lawyer",            value: "known_with_counsel" },
      { label: "I have insurance contact info but do not know the driver personally",  value: "insurer_only" },
      { label: "I do not know who the other driver is (hit and run, or unknown)",      value: "unknown_driver" },
      { label: "I would rather walk through this with the lawyer directly",            value: "prefer_consult" },
    ],
    memo_label: "Adverse driver / Opposing counsel",
  },
  {
    id: "pi_mva_q8",
    category: "expectations_alignment",
    text: "Where are you in the process of finding a lawyer for this?",
    type: "structured_single",
    options: [
      { label: "First consultation — I have not spoken to anyone yet", value: "first_consult" },
      { label: "I spoke with another lawyer but did not retain them",  value: "spoke_no_retain" },
      { label: "I am still considering options",                        value: "still_considering" },
      { label: "I need someone urgently — there is a deadline I am worried about", value: "urgent_deadline" },
    ],
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
    text: "When did this situation first happen?",
    type: "structured_single",
    options: [
      { label: "Within the last week",                value: "within_week" },
      { label: "Within the last month",               value: "within_month" },
      { label: "1 to 6 months ago",                   value: "1_6mo" },
      { label: "6 months to 2 years ago",             value: "6mo_2yr" },
      { label: "Over 2 years ago",                    value: "over_2yr" },
      { label: "It is ongoing — there is no single date", value: "ongoing" },
    ],
    memo_label: "Incident date / Limitations status",
  },
  {
    id: "gen_q2",
    category: "fact_pattern",
    text: "What are you mainly trying to do?",
    type: "structured_single",
    options: [
      { label: "Make a claim against someone (compensation, damages)",  value: "make_claim" },
      { label: "Defend against a claim someone is making against me",    value: "defend_claim" },
      { label: "Get advice before I decide my next step",                 value: "advice" },
      { label: "Review or sign a document",                               value: "document_review" },
      { label: "Negotiate with someone (settlement, agreement)",          value: "negotiate" },
      { label: "Something else",                                          value: "other" },
    ],
    allow_free_text: true,
    memo_label: "Client objective / Matter type",
  },
  {
    id: "gen_q3",
    category: "evidence_inventory",
    text: "Which documents do you currently have related to this matter?",
    type: "structured_multi",
    options: [
      { label: "Contracts, agreements, or signed documents",         value: "contracts" },
      { label: "Letters, emails, or messages",                        value: "letters_emails" },
      { label: "Court papers, notices, or filings",                   value: "court_papers" },
      { label: "Photos, videos, or recordings",                       value: "photos_videos" },
      { label: "Reports (police, medical, professional)",             value: "reports" },
      { label: "Receipts, statements, or financial records",          value: "financial" },
      { label: "Nothing in writing yet",                              value: "nothing" },
    ],
    allow_multi_select: true,
    memo_label: "Documents / Evidence held",
  },
  {
    id: "gen_q4",
    category: "conflict_and_parties",
    text: "What do you know about the other parties involved in this matter?",
    type: "structured_single",
    options: [
      { label: "I know who they are and have not heard from any lawyer for them",  value: "known_no_counsel" },
      { label: "I know who they are and have already heard from their lawyer",      value: "known_with_counsel" },
      { label: "I know some of them, not all",                                       value: "partial" },
      { label: "I am not sure who the parties are yet",                              value: "unknown" },
      { label: "I would rather discuss this with the lawyer directly",               value: "prefer_consult" },
    ],
    memo_label: "Adverse parties / Opposing counsel",
  },
  {
    id: "gen_q5",
    category: "expectations_alignment",
    text: "Where are you in the process of finding a lawyer for this?",
    type: "structured_single",
    options: [
      { label: "First consultation — I have not spoken to anyone yet", value: "first_consult" },
      { label: "I spoke with another lawyer but did not retain them",  value: "spoke_no_retain" },
      { label: "I am still considering options",                        value: "still_considering" },
      { label: "I need someone urgently — there is a deadline I am worried about", value: "urgent_deadline" },
    ],
    memo_label: "Prior counsel / Client expectations",
  },
];

const GENERIC_BAND_C = ["gen_q1", "gen_q2", "gen_q4", "gen_q5"];

// ── Employment Law  -  Wrongful Dismissal ─────────────────────────────────────

const EMPLOYMENT_DISMISSAL_QUESTIONS: Round3Question[] = [
  {
    id: "emp_dis_q1",
    category: "jurisdiction_limitations",
    text: "How long were you employed there?",
    type: "structured_single",
    options: [
      { label: "Less than 1 year",     value: "under_1yr" },
      { label: "1 to 3 years",          value: "1_3yr" },
      { label: "3 to 7 years",          value: "3_7yr" },
      { label: "7 to 15 years",         value: "7_15yr" },
      { label: "Over 15 years",         value: "over_15yr" },
    ],
    memo_label: "Employment tenure / Limitations analysis",
    // Tenure dedupe — short + long sub-type prefixes + custom AI IDs.
    excludeWhen: {
      "emp_q47": ["*"],
      "emp_dis_q47": ["*"],     "emp_dismissal_q47": ["*"],
      "emp_har_q47": ["*"],     "emp_harassment_q47": ["*"],
      "emp_disc_q47": ["*"],
      "emp_con_q47": ["*"],     "emp_constructive_q47": ["*"],
      "emp_wage_q47": ["*"],
      "emp_other_q47": ["*"],
      // Custom semantic IDs the AI sometimes invents
      "emp_tenure": ["*"],
    },
  },
  {
    id: "emp_dis_q2",
    category: "fact_pattern",
    text: "What was your role level at the company?",
    type: "structured_single",
    options: [
      { label: "Junior or entry-level",                          value: "junior" },
      { label: "Mid-level individual contributor",               value: "mid" },
      { label: "Senior individual contributor (specialist, lead)", value: "senior_ic" },
      { label: "Manager or supervisor",                          value: "manager" },
      { label: "Senior executive or director",                   value: "executive" },
    ],
    memo_label: "Role and seniority / Character of employment",
    // Role / seniority dedupe — covers all employment sub-type prefixes.
    excludeWhen: {
      "emp_q46": ["*"],
      "emp_dis_q46": ["*"],     "emp_dismissal_q46": ["*"],
      "emp_har_q46": ["*"],     "emp_harassment_q46": ["*"],
      "emp_disc_q46": ["*"],
      "emp_con_q46": ["*"],     "emp_constructive_q46": ["*"],
      "emp_wage_q46": ["*"],
      "emp_other_q46": ["*"],
    },
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
    text: "Did you raise any concerns or complaints with your employer before being let go?",
    type: "structured_single",
    options: [
      { label: "Yes — in writing (email, formal complaint, HR ticket)", value: "written" },
      { label: "Yes — but only verbally",                                value: "verbal" },
      { label: "I considered raising concerns but did not",              value: "considered" },
      { label: "No — nothing was raised",                                value: "none" },
    ],
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
    text: "What is your current income situation?",
    type: "structured_single",
    options: [
      { label: "Working full-time elsewhere",                         value: "ft_elsewhere" },
      { label: "Working part-time or contract",                        value: "pt_contract" },
      { label: "Receiving Employment Insurance (EI)",                  value: "ei" },
      { label: "On medical or disability leave",                       value: "medical_leave" },
      { label: "Currently without income",                             value: "no_income" },
      { label: "I would rather discuss this with the lawyer",          value: "prefer_consult" },
    ],
    memo_label: "Mitigation / Current income status",
  },
  {
    id: "emp_dis_q7",
    category: "expectations_alignment",
    text: "Where are you in the process of finding a lawyer for this?",
    type: "structured_single",
    options: [
      { label: "First consultation — I have not spoken to anyone yet", value: "first_consult" },
      { label: "I spoke with another lawyer but did not retain them",  value: "spoke_no_retain" },
      { label: "I am still considering options",                        value: "still_considering" },
      { label: "I need someone urgently — there is a deadline I am worried about", value: "urgent_deadline" },
    ],
    memo_label: "Prior counsel / Client expectations and urgency",
  },
];

const BAND_C_QUESTIONS_EMP_DIS = ["emp_dis_q1", "emp_dis_q3", "emp_dis_q6", "emp_dis_q7"];

// ── Employment Law  -  Wage Claims ────────────────────────────────────────────

const EMPLOYMENT_WAGE_QUESTIONS: Round3Question[] = [
  {
    id: "emp_wage_q1",
    category: "jurisdiction_limitations",
    text: "When did the unpaid overtime begin?",
    type: "structured_single",
    options: [
      { label: "Within the last 3 months",            value: "under_3mo" },
      { label: "3 to 12 months ago",                   value: "3_12mo" },
      { label: "1 to 2 years ago",                     value: "1_2yr" },
      { label: "Over 2 years ago",                     value: "over_2yr" },
      { label: "It has been ongoing since I started",  value: "ongoing_since_start" },
    ],
    memo_label: "Claim period / Current employment status",
  },
  {
    id: "emp_wage_q2",
    category: "fact_pattern",
    text: "What is your annual salary or pay range?",
    type: "structured_single",
    options: [
      { label: "Under $50,000",                                    value: "under_50k" },
      { label: "$50,000 to $80,000",                                value: "50_80k" },
      { label: "$80,000 to $120,000",                               value: "80_120k" },
      { label: "$120,000 to $200,000",                              value: "120_200k" },
      { label: "Over $200,000",                                     value: "over_200k" },
      { label: "I am paid hourly, not salaried",                    value: "hourly" },
      { label: "I would rather discuss this with the lawyer",       value: "prefer_consult" },
    ],
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
    text: "Have you raised the overtime issue with your employer?",
    type: "structured_single",
    options: [
      { label: "Yes — in writing (email or formal complaint)",       value: "written" },
      { label: "Yes — but only verbally",                             value: "verbal" },
      { label: "I have not raised it yet",                            value: "not_raised" },
      { label: "I raised it and was told it would be addressed but nothing changed", value: "ignored" },
    ],
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
    text: "Where are you in the process of finding a lawyer for this?",
    type: "structured_single",
    options: [
      { label: "First consultation — I have not spoken to anyone yet", value: "first_consult" },
      { label: "I spoke with another lawyer but did not retain them",  value: "spoke_no_retain" },
      { label: "I am still considering options",                        value: "still_considering" },
      { label: "I need someone urgently — there is a deadline I am worried about", value: "urgent_deadline" },
    ],
    memo_label: "Prior counsel / Client expectations and urgency",
  },
];

const BAND_C_QUESTIONS_EMP_WAGE = ["emp_wage_q1", "emp_wage_q2", "emp_wage_q3", "emp_wage_q6"];

// ── Immigration Law  -  Spousal Sponsorship ───────────────────────────────────

const IMMIGRATION_SPOUSAL_QUESTIONS: Round3Question[] = [
  {
    id: "imm_sp_q1",
    category: "jurisdiction_limitations",
    text: "What is your current status in Canada?",
    type: "structured_single",
    options: [
      { label: "Canadian citizen",                                value: "citizen" },
      { label: "Permanent resident",                              value: "pr" },
      { label: "Work permit (valid for over 6 months)",           value: "work_permit_long" },
      { label: "Work permit (expiring within 6 months)",          value: "work_permit_short" },
      { label: "Study permit",                                    value: "study_permit" },
      { label: "Visitor record or implied status",                value: "visitor" },
      { label: "Status has expired or no current status",         value: "no_status" },
      { label: "Other",                                           value: "other" },
    ],
    allow_free_text: true,
    memo_label: "Current status / Expiry date / Pathway urgency",
  },
  {
    id: "imm_sp_q2",
    category: "fact_pattern",
    text: "How long have you been with your partner, and are you living together?",
    type: "structured_single",
    options: [
      { label: "Under 1 year — not living together",  value: "u1_apart" },
      { label: "Under 1 year — living together",      value: "u1_together" },
      { label: "1 to 3 years — not living together",  value: "1_3_apart" },
      { label: "1 to 3 years — living together",      value: "1_3_together" },
      { label: "Over 3 years — not living together",  value: "over3_apart" },
      { label: "Over 3 years — living together",      value: "over3_together" },
    ],
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
    text: "What is your sponsor's status, and have they sponsored anyone before?",
    type: "structured_single",
    options: [
      { label: "Canadian citizen — never sponsored anyone before",    value: "citizen_first" },
      { label: "Canadian citizen — has sponsored someone in the past", value: "citizen_prior" },
      { label: "Permanent resident — never sponsored anyone before",  value: "pr_first" },
      { label: "Permanent resident — has sponsored someone in the past", value: "pr_prior" },
      { label: "Sponsor's status is unclear or I would rather discuss with the lawyer", value: "prefer_consult" },
    ],
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
    text: "What is your marriage situation?",
    type: "structured_single",
    options: [
      { label: "We are already legally married in Canada",                       value: "married_canada" },
      { label: "We are already legally married outside Canada",                  value: "married_abroad" },
      { label: "We are planning to marry in Canada within the next 6 months",    value: "marrying_canada" },
      { label: "We are planning to marry outside Canada within the next 6 months", value: "marrying_abroad" },
      { label: "We are common-law and not planning to marry",                    value: "common_law" },
      { label: "We are still deciding",                                          value: "undecided" },
    ],
    memo_label: "Marriage details / Registration",
  },
  {
    id: "imm_sp_q7",
    category: "evidence_inventory",
    text: "Are there any concerns that could affect your admissibility to Canada?",
    type: "structured_single",
    options: [
      { label: "No — passport valid, no criminal or health issues",          value: "clear" },
      { label: "My passport expires within 6 months",                         value: "passport_expiring" },
      { label: "I have a past criminal conviction (any country)",             value: "criminal_history" },
      { label: "I have a current or past health condition that could be flagged", value: "health" },
      { label: "I have had a prior visa refusal or enforcement issue",        value: "refusal_history" },
      { label: "I would rather discuss this with the lawyer directly",        value: "prefer_consult" },
    ],
    memo_label: "Passport validity / Admissibility flags",
  },
  {
    id: "imm_sp_q8",
    category: "expectations_alignment",
    text: "Where are you in the process of finding an immigration lawyer for this?",
    type: "structured_single",
    options: [
      { label: "First consultation — I have not spoken to anyone yet",                value: "first_consult" },
      { label: "I spoke with another lawyer or consultant but did not retain them",    value: "spoke_no_retain" },
      { label: "I am still considering options",                                        value: "still_considering" },
      { label: "I need someone urgently — there is a deadline driving this",            value: "urgent_deadline" },
    ],
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
  // ── Short-code keys (what the AI actually emits in practice_sub_type) ──
  // Personal Injury sub-types
  "pi_mva":          { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "pi_slip_fall":    { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "pi_dog_bite":     { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA }, // TODO: dedicated pi_db R3 bank
  "pi_med_mal":      { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "pi_product":      { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "pi_workplace":    { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "pi_assault_ci":   { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "pi_other":        { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "pi":              { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },

  // Employment Law sub-types
  "emp_dismissal":   { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS },
  "emp_wage":        { questions: EMPLOYMENT_WAGE_QUESTIONS,       bandCIds: BAND_C_QUESTIONS_EMP_WAGE },
  "emp_disc":        { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS }, // TODO: dedicated discrimination bank
  "emp_harassment":  { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS }, // TODO: dedicated harassment bank
  "emp_other":       { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS },
  "emp":             { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS },

  // Immigration Law sub-types
  "imm_spousal":     { questions: IMMIGRATION_SPOUSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_IMM_SP },
  "imm_other":       { questions: IMMIGRATION_SPOUSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_IMM_SP },
  "imm":             { questions: IMMIGRATION_SPOUSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_IMM_SP },

  // ── Long-form keys (kept for backwards compatibility with any older callers) ──
  "personal_injury:motor_vehicle_accident": { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "personal_injury:slip_and_fall":          { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "personal_injury:general":                { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "personal_injury":                        { questions: PI_MVA_QUESTIONS, bandCIds: BAND_C_QUESTIONS_PI_MVA },
  "employment_law:wrongful_dismissal":      { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS },
  "employment_law:wage_claim":              { questions: EMPLOYMENT_WAGE_QUESTIONS,       bandCIds: BAND_C_QUESTIONS_EMP_WAGE },
  "employment_law":                         { questions: EMPLOYMENT_DISMISSAL_QUESTIONS, bandCIds: BAND_C_QUESTIONS_EMP_DIS },
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

  // Lookup priority:
  //   1. short-code sub_type (e.g. "pi_mva")  -  what the AI emits in practice_sub_type
  //   2. compound long-form key (e.g. "personal_injury:motor_vehicle_accident")  -  legacy callers
  //   3. short-code practice area (e.g. "pi")  -  when sub_type unknown
  //   4. long-form practice area (e.g. "personal_injury")  -  legacy callers
  //   5. generic fallback
  const entry =
    (st ? BANK_REGISTRY[st] : undefined) ??
    BANK_REGISTRY[`${pa}:${st}`] ??
    BANK_REGISTRY[pa] ??
    BANK_REGISTRY["__generic__"];

  if (isFullRound3(band)) {
    return entry.questions;
  }

  // Band C: filter to shortened set
  const bandCIds = new Set(entry.bandCIds ?? GENERIC_BAND_C);
  return entry.questions.filter(q => bandCIds.has(q.id));
}

/**
 * Resolve raw R3 answer codes back to their human-readable labels.
 *
 * The R3 banks store structured codes (e.g. "loss_documented", "rear_end_stopped").
 * Memo generation reads these and would echo the codes verbatim into the memo
 * unless we translate them. This function looks up each answered question in
 * the registry, finds the matching option, and produces a parallel map keyed
 * by question.id where values are the option labels (or arrays of labels for
 * multi-select). Free-text answers prefixed "other:" are stripped to the user's
 * own text. Unknown codes are passed through unchanged so nothing is silently
 * lost.
 *
 * Returns a Record<questionId, humanLabel | humanLabel[]> with both the
 * resolved label and the original question text alongside, suitable for
 * direct inclusion in the memo prompt.
 */
export interface HumanizedAnswer {
  question_id: string;
  question_text: string;
  memo_label: string;
  answer: string | string[];
}

export function humanizeRound3Answers(
  answers: Record<string, unknown>,
  practiceArea: string | null,
  subType: string | null,
): HumanizedAnswer[] {
  const pa = (practiceArea ?? "").toLowerCase().replace(/\s+/g, "_");
  const st = (subType ?? "").toLowerCase().replace(/\s+/g, "_");
  const entry =
    (st ? BANK_REGISTRY[st] : undefined) ??
    BANK_REGISTRY[`${pa}:${st}`] ??
    BANK_REGISTRY[pa] ??
    BANK_REGISTRY["__generic__"];

  const byId = new Map(entry.questions.map(q => [q.id, q]));
  const result: HumanizedAnswer[] = [];

  for (const [qid, raw] of Object.entries(answers)) {
    const q = byId.get(qid);
    if (!q) {
      // Unknown question id  -  pass through with the raw value
      result.push({
        question_id: qid,
        question_text: qid,
        memo_label: qid,
        answer: typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map(String) : String(raw ?? ""),
      });
      continue;
    }
    const optionMap = new Map((q.options ?? []).map(o => [o.value, o.label]));
    const labelOf = (v: string): string => {
      if (typeof v !== "string") return String(v ?? "");
      if (v.startsWith("other:")) return v.slice(6).trim();
      return optionMap.get(v) ?? v;
    };
    const answer = Array.isArray(raw) ? (raw as string[]).map(labelOf) : labelOf(String(raw ?? ""));
    result.push({
      question_id: qid,
      question_text: q.text,
      memo_label: q.memo_label,
      answer,
    });
  }
  return result;
}
