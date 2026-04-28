/**
 * first-question-router.ts — DETERMINISTIC selection of the prospect's
 * first question based on (practice_area, sub_type, stage_of_engagement).
 *
 * Why this exists:
 *  The AI was the previous authority on first-question selection and routinely
 *  defaulted to seed-bank questions that didn't match the prospect's situation.
 *  Stacking prompt rules helped maybe 80% of the time. The remaining 20% were
 *  catastrophic UX failures (wrong question first → prospect abandons).
 *
 *  This router replaces that decision. After classification + intent extraction,
 *  the route consults the router with the three known facts and gets a
 *  deterministic question back. The AI is still used for everything else
 *  (response text, scoring, follow-up questions, rewriting), but turn 1's
 *  opening question is no longer GPT's call.
 *
 * Key design rule:
 *  Lookup is most-specific to least-specific. (pa|sub|stage) → (pa|sub|*) →
 *  (pa|*|stage) → (pa|*|*) → null. Returning null means the AI handles it
 *  (legacy fallback). Add table entries to incrementally remove AI control
 *  over the failure points.
 *
 * Future direction:
 *  Each entry can declare cpi_deltas and a memo template fragment so the
 *  scoring/memo layers also become deterministic per (PA, sub, stage).
 *  Not yet wired  -  the v1 of this router only owns the question text.
 */

export interface RoutedFirstQuestion {
  id: string;
  text: string;
  options: Array<{ label: string; value: string }>;
  allow_free_text: boolean;
  /** Optional preamble shown above the options (one line). */
  description?: string;
  /** When true, the router suggests this is the only first question to serve.
   *  When false, the AI may add additional R1 questions alongside. */
  exclusive?: boolean;
}

type RouterKey = string; // "pa|sub_type|stage"

/**
 * Map of long-form practice area names (returned by the classifier) to the
 * short codes the router table uses. Production data shows the classifier
 * sometimes returns "corporate_commercial" / "personal_injury" / etc. instead
 * of "corp" / "pi". Normalize before lookup so the router still works.
 */
const PA_NORMALIZE: Record<string, string> = {
  corporate_commercial: "corp",
  personal_injury:      "pi",
  employment_law:       "emp",
  family_law:           "fam",
  civil_litigation:     "civ",
  criminal_law:         "crim",
  immigration_law:      "imm",
  insurance_law:        "ins",
  real_estate_law:      "real",
  wills_estates:        "est",
  intellectual_property:"ip",
  tax_law:              "tax",
  construction_law:     "const",
  defamation:           "defam",
};

function normalizePA(pa: string | null): string {
  if (!pa) return "*";
  const lower = pa.toLowerCase();
  return PA_NORMALIZE[lower] ?? lower;
}

/**
 * Build a key for table lookup. Lowercases everything, replaces missing
 * values with "*" wildcards. PA is normalized to its short code first.
 */
function k(pa: string | null, sub: string | null, stage: string | null): RouterKey {
  return `${normalizePA(pa)}|${(sub ?? "*").toLowerCase()}|${(stage ?? "*").toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRST_QUESTION_TABLE
// Authored entries  -  expand as failure modes are discovered.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE: Record<RouterKey, RoutedFirstQuestion> = {

  // ── CORP: shareholder / partnership disputes ──
  // Active production failure mode: prospect typed "my business partner is
  // using company money without telling me" and got the incorporation seed
  // question. Now deterministic.
  [k("corp", "corp_shareholder_dispute", null)]: {
    id: "rt_corp_dispute_q1",
    text: "What's the issue with your business partner or co-owner?",
    options: [
      { label: "Misuse of company funds",                      value: "misuse_funds" },
      { label: "Self-dealing or conflicts of interest",        value: "self_dealing" },
      { label: "Refusing to share financial information",      value: "info_refusal" },
      { label: "Excluding me from decisions",                  value: "exclusion_decisions" },
      { label: "Disagreement on direction or strategy",        value: "direction_dispute" },
      { label: "I want to exit the partnership",               value: "want_to_exit" },
      { label: "Something else",                               value: "other" },
    ],
    allow_free_text: true,
    exclusive: true,
  },
  [k("corp", "corp_partnership_dispute", null)]: {
    id: "rt_corp_partnership_q1",
    text: "What's the issue with your business partner?",
    options: [
      { label: "Misuse of business funds",                     value: "misuse_funds" },
      { label: "Refusing to communicate or cooperate",         value: "no_cooperation" },
      { label: "Disagreement on business direction",           value: "direction_dispute" },
      { label: "I want to dissolve the partnership",           value: "dissolve" },
      { label: "Partner wants out and is asking for buyout",   value: "buyout_request" },
      { label: "Something else",                               value: "other" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── CORP: acquisition  -  buying a business ──
  // Active production failure mode: "I want to buy a small business" got
  // the share-vs-asset structure question instead of stage discovery.
  [k("corp", "corp_acquisition", "exploring")]: {
    id: "rt_corp_acq_explore_q1",
    text: "What stage are you at with buying this business?",
    options: [
      { label: "Just exploring options",                       value: "exploring" },
      { label: "Identified a target business",                 value: "identified_target" },
      { label: "In active negotiations",                       value: "negotiations" },
      { label: "Doing due diligence",                          value: "due_diligence" },
      { label: "Ready to close",                               value: "closing_soon" },
    ],
    allow_free_text: true,
    exclusive: true,
  },
  [k("corp", "corp_acquisition", null)]: {
    id: "rt_corp_acq_q1",
    text: "Where are you in the process of buying this business?",
    options: [
      { label: "Exploring  -  haven't picked one yet",         value: "exploring" },
      { label: "Have a target  -  no offer yet",               value: "identified_target" },
      { label: "Offer made  -  in negotiations",               value: "negotiations" },
      { label: "Due diligence underway",                       value: "due_diligence" },
      { label: "Ready to close",                               value: "closing_soon" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── CORP: incorporation  -  forming a new entity ──
  [k("corp", "corp_incorporation", "exploring")]: {
    id: "rt_corp_inc_explore_q1",
    text: "Where are you with starting this business?",
    options: [
      { label: "Still validating the idea",                    value: "validating" },
      { label: "Have the idea, ready to form an entity",       value: "ready_to_form" },
      { label: "Already operating  -  need to incorporate now",value: "already_operating" },
      { label: "Not sure if I need to incorporate",            value: "unsure" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── CORP fallback ──
  // Used when the classifier returns corp without a more specific sub-type.
  [k("corp", null, null)]: {
    id: "rt_corp_fallback_q1",
    text: "What kind of corporate or business matter is this?",
    options: [
      { label: "Starting a new business or incorporating",     value: "incorporation" },
      { label: "Buying a business",                            value: "acquisition" },
      { label: "Selling a business",                           value: "sale" },
      { label: "Issue with a business partner or co-owner",    value: "partner_dispute" },
      { label: "Shareholder or board issue",                   value: "shareholder_matter" },
      { label: "Reorganizing or restructuring",                value: "reorganization" },
      { label: "Reviewing or signing a business contract",     value: "contract" },
      { label: "Something else",                               value: "other" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── EMP: dismissal ──
  [k("emp", "emp_dismissal", null)]: {
    id: "rt_emp_dis_q1",
    text: "Are you still employed there, or have you been let go?",
    options: [
      { label: "I was let go without cause",                   value: "without_cause" },
      { label: "I was let go with cause stated",               value: "with_cause" },
      { label: "I was laid off / position eliminated",         value: "laid_off" },
      { label: "I was forced to resign",                       value: "constructive" },
      { label: "Still employed but worried about it",          value: "still_employed" },
      { label: "I resigned recently",                          value: "resigned" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── EMP: harassment ──
  [k("emp", "emp_harassment", null)]: {
    id: "rt_emp_har_q1",
    text: "What kind of harassment or mistreatment is happening?",
    options: [
      { label: "Personal harassment / bullying",               value: "personal" },
      { label: "Sexual harassment",                            value: "sexual" },
      { label: "Discrimination based on a protected ground",   value: "discriminatory" },
      { label: "Retaliation after I raised a complaint",       value: "retaliation" },
      { label: "Toxic environment, hard to describe in one",   value: "toxic_general" },
      { label: "Something else",                               value: "other" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── FAM: divorce ──
  [k("fam", "fam_divorce", null)]: {
    id: "rt_fam_div_q1",
    text: "Where are you in the separation or divorce process?",
    options: [
      { label: "Thinking about it, haven't separated yet",     value: "thinking" },
      { label: "Recently separated",                           value: "recently_separated" },
      { label: "Separated for a while  -  ready to file",      value: "ready_to_file" },
      { label: "Already filed and case is moving",             value: "filed" },
      { label: "Other party filed against me",                 value: "responding" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── FAM: custody ──
  [k("fam", "fam_custody", null)]: {
    id: "rt_fam_cus_q1",
    text: "What is the situation with your child/children?",
    options: [
      { label: "Other parent is preventing me from seeing them",      value: "denied_access" },
      { label: "We disagree on custody / parenting time",             value: "disagreement" },
      { label: "Need to set up a formal arrangement",                 value: "need_formal" },
      { label: "Existing order needs to change",                      value: "modify_order" },
      { label: "Concerned about safety or wellbeing",                 value: "safety_concern" },
      { label: "Other parent moved or wants to move with the child",  value: "relocation" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── CIV: defendant in lawsuit ──
  [k("civ", "civ_defendant", null)]: {
    id: "rt_civ_def_q1",
    text: "What kind of legal claim is being made against you?",
    options: [
      { label: "Breach of contract",                                value: "contract" },
      { label: "Negligence or other tort",                          value: "tort" },
      { label: "Debt collection",                                   value: "debt" },
      { label: "Property dispute",                                  value: "property" },
      { label: "Something else",                                    value: "other" },
    ],
    allow_free_text: true,
    exclusive: true,
  },

  // ── PI: dog bite (victim) ──
  // Already covered by pi_db_q* seed bank, so the router defers to AI by
  // returning null  -  this entry intentionally omitted.

  // ── DEFAM: defamation plaintiff (defamed) ──
  [k("defam", null, null)]: {
    id: "rt_defam_q1",
    text: "What kind of defamation situation is this?",
    options: [
      { label: "Someone made false statements about me online",     value: "online_about_me" },
      { label: "Someone made false statements about me offline",    value: "offline_about_me" },
      { label: "Someone is threatening to sue me for defamation",   value: "threatened_against_me" },
      { label: "I've been served with a defamation lawsuit",        value: "served_against_me" },
      { label: "False statements about my business",                value: "business_defamation" },
    ],
    allow_free_text: true,
    exclusive: true,
  },
};

/**
 * Look up the deterministic first question for the given (PA, sub_type, stage).
 * Returns null if no entry covers the combination  -  caller should fall back
 * to the AI's selection.
 */
export function firstQuestionFor(
  practiceArea: string | null,
  subType: string | null,
  stage: string | null,
): RoutedFirstQuestion | null {
  const tries: RouterKey[] = [
    k(practiceArea, subType, stage),
    k(practiceArea, subType, null),
    k(practiceArea, null,    stage),
    k(practiceArea, null,    null),
  ];
  for (const key of tries) {
    if (TABLE[key]) return TABLE[key];
  }
  return null;
}

/**
 * For tests / debug: list every authored (PA, sub_type, stage) combination.
 */
export function listRoutedKeys(): string[] {
  return Object.keys(TABLE);
}
