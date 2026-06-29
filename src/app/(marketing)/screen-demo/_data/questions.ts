/**
 * Screen Demo Questions
 *
 * Five marketing-calibrated questions for the public /screen-demo experience.
 *
 * DELIBERATE DRIFT FROM PRODUCT
 * These are NOT the Layer 2 production questions from screen-prompt.ts.
 * They are calibrated to produce a satisfying scoring narrative for a lawyer
 * who has never seen the product. Real production logic stays in the trial.
 * Drift between marketing demo and product is acceptable.
 *
 * SCORING MODEL
 * Each answer carries deltas mapped to the v2.1 Fit/Value scoring axes:
 *   Fit Score (30 max)   = geo (0-10) + contactability (0-10) + legitimacy (0-10)
 *   Value Score (70 max) = complexity (0-25) + urgency (0-20) + strategic (0-15) + fee (0-10)
 * Total CPI = Fit + Value, banded A (>=90) / B (>=75) / C (>=60) / D (>=45) / E (<45).
 *
 * Q1 sets practice area (used for report narrative only, no scoring delta).
 * Q2-Q5 each contribute deltas across the scoring axes.
 *
 * The lawyer fills these out FOR A HYPOTHETICAL CLIENT (or a remembered real
 * inquiry). They see the experience from the prospect side, then see the
 * Screen report their firm would receive.
 */

export type PracticeArea =
  | "criminal_defense"
  | "immigration"
  | "real_estate"
  | "family"
  | "employment"
  | "estates"
  | "personal_injury"
  | "corporate"
  | "other";

export interface ScoreDelta {
  /** Out-of-province / cross-jurisdiction friction */
  geo?: number;
  /** Likelihood the client is reachable on a real phone/email */
  contactability?: number;
  /** Is this a real legal matter vs fishing for free advice */
  legitimacy?: number;
  /** Difficulty / billable depth */
  complexity?: number;
  /** How time-sensitive */
  urgency?: number;
  /** Strategic value to the firm (referral source, repeat-business potential) */
  strategic?: number;
  /** Fee fit — likelihood of paying retainer + ongoing billing */
  fee?: number;
}

export interface QuestionOption {
  id: string;
  label: string;
  sub?: string;
  delta: ScoreDelta;
}

export interface Question {
  id: string;
  num: number;
  total: number;
  /** Eyebrow above the question, e.g. "Question 2 of 5" */
  eyebrow?: string;
  /** The headline question — what the prospect would see if this were the real form */
  prompt: string;
  /** Optional context line beneath the prompt explaining the framing */
  context?: string;
  /** Single-select by default; set multi=true for Q5-style multi-select */
  multi?: boolean;
  /** When multi=true, the max number selectable */
  maxSelections?: number;
  options: QuestionOption[];
}

/* ──────────────────────────────────────────────────────────────────
 *  Q1 · Practice area (sets context, no scoring delta)
 * ────────────────────────────────────────────────────────────────── */

export const Q1_PRACTICE_AREA: Question = {
  id: "practice_area",
  num: 1,
  total: 5,
  prompt: "What kind of legal matter is the prospect asking about?",
  context:
    "This is the first question the Screen asks every inbound inquiry. It sets the conversational lane the rest of the questions run in.",
  options: [
    { id: "criminal_defense", label: "Criminal defense",                    delta: {} },
    { id: "immigration",      label: "Immigration",                          delta: {} },
    { id: "real_estate",      label: "Real estate transaction",              delta: {} },
    { id: "family",           label: "Family law or divorce",                delta: {} },
    { id: "employment",       label: "Employment matter",                    delta: {} },
    { id: "estates",          label: "Estates, wills, or probate",           delta: {} },
    { id: "personal_injury",  label: "Personal injury",                      delta: {} },
    { id: "corporate",        label: "Business or commercial",               delta: {} },
    { id: "other",            label: "Something else",                       delta: {} },
  ],
};

/* ──────────────────────────────────────────────────────────────────
 *  Q2 · Jurisdiction fit  (geo axis, 0-10)
 * ────────────────────────────────────────────────────────────────── */

export const Q2_JURISDICTION: Question = {
  id: "jurisdiction",
  num: 2,
  total: 5,
  prompt: "Where is the prospect, and where will the matter be heard or filed?",
  context:
    "The Screen needs to know whether your firm can serve this client without a referral. Out-of-province matters carry friction.",
  options: [
    {
      id: "ontario_local",
      label: "Ontario, in the GTA or close enough to meet in person",
      delta: { geo: 10, contactability: 8 },
    },
    {
      id: "ontario_remote",
      label: "Ontario, but outside the GTA",
      delta: { geo: 8, contactability: 7 },
    },
    {
      id: "out_of_province",
      label: "Out of province, matter is in Ontario",
      delta: { geo: 6, contactability: 6 },
    },
    {
      id: "out_of_province_matter",
      label: "Out of province, matter is also out of province",
      delta: { geo: 2, contactability: 5 },
    },
    {
      id: "international",
      label: "Outside Canada",
      delta: { geo: 3, contactability: 4 },
    },
  ],
};

/* ──────────────────────────────────────────────────────────────────
 *  Q3 · Timeline / urgency  (urgency axis, 0-20)
 * ────────────────────────────────────────────────────────────────── */

export const Q3_TIMELINE: Question = {
  id: "timeline",
  num: 3,
  total: 5,
  prompt: "How time-sensitive is the matter?",
  context:
    "Urgency drives both the Screen's routing decision and the response cadence your firm should follow.",
  options: [
    {
      id: "this_week",
      label: "Something is happening this week",
      sub: "Hearing, deadline, closing, or filing imminent",
      delta: { urgency: 20, complexity: 4 },
    },
    {
      id: "this_month",
      label: "Something is happening this month",
      sub: "Need to act within the next 30 days",
      delta: { urgency: 16, complexity: 3 },
    },
    {
      id: "few_months",
      label: "Within the next two or three months",
      delta: { urgency: 12, complexity: 2 },
    },
    {
      id: "this_year",
      label: "Sometime this year, but no fixed deadline",
      delta: { urgency: 7, complexity: 2 },
    },
    {
      id: "exploring",
      label: "Just exploring options",
      delta: { urgency: 3, complexity: 1, legitimacy: -2 },
    },
  ],
};

/* ──────────────────────────────────────────────────────────────────
 *  Q4 · Complexity / what's at stake  (complexity 0-25 + strategic 0-15)
 * ────────────────────────────────────────────────────────────────── */

export const Q4_STAKES: Question = {
  id: "stakes",
  num: 4,
  total: 5,
  prompt: "How much is at stake, and how complex is the matter likely to be?",
  context:
    "The Screen looks for cases worth your partner's time. Stakes and complexity together signal the depth of work required.",
  options: [
    {
      id: "high_stakes_complex",
      label: "High stakes, complex matter",
      sub: "Charges with jail exposure, major financial dispute, complex corporate transaction, or contested family proceeding",
      delta: { complexity: 25, strategic: 13, legitimacy: 9 },
    },
    {
      id: "high_stakes_routine",
      label: "High stakes, but procedurally routine",
      sub: "Standard immigration application, standard real estate closing on a high-value property, undisputed estate",
      delta: { complexity: 18, strategic: 11, legitimacy: 9 },
    },
    {
      id: "moderate_complex",
      label: "Moderate stakes, some complexity",
      sub: "Mid-tier dispute, employment claim with negotiation room, contested but resolvable family matter",
      delta: { complexity: 14, strategic: 8, legitimacy: 8 },
    },
    {
      id: "moderate_routine",
      label: "Moderate stakes, procedurally routine",
      sub: "Standard contract review, small claims, basic will drafting",
      delta: { complexity: 9, strategic: 5, legitimacy: 7 },
    },
    {
      id: "low_stakes",
      label: "Low stakes, simple matter",
      sub: "Quick question, minor procedural issue, fact-checking call",
      delta: { complexity: 4, strategic: 2, legitimacy: 5 },
    },
    {
      id: "unclear",
      label: "Not sure yet: the prospect couldn't articulate it",
      delta: { complexity: 5, strategic: 2, legitimacy: 4 },
    },
  ],
};

/* ──────────────────────────────────────────────────────────────────
 *  Q5 · Fee fit  (fee 0-10 + legitimacy 0-10)
 * ────────────────────────────────────────────────────────────────── */

export const Q5_FEE_FIT: Question = {
  id: "fee_fit",
  num: 5,
  total: 5,
  prompt: "When the prospect was asked about fees, what did they say?",
  context:
    "The Screen asks this conversationally, not as a price filter. The answer tells you whether the prospect is a buyer or a tire-kicker.",
  options: [
    {
      id: "ready_retainer",
      label: "Ready to pay a retainer, asked what's required",
      delta: { fee: 10, legitimacy: 10, strategic: 4 },
    },
    {
      id: "understands_cost",
      label: "Understands legal work costs money, wants to discuss structure",
      delta: { fee: 8, legitimacy: 9, strategic: 3 },
    },
    {
      id: "shopping_compare",
      label: "Comparing fees with other firms before deciding",
      delta: { fee: 5, legitimacy: 7, strategic: 2 },
    },
    {
      id: "wants_free_advice",
      label: "Asked for a quick free opinion before paying anything",
      delta: { fee: 2, legitimacy: 3 },
    },
    {
      id: "cannot_afford",
      label: "Said directly they can't afford a retainer",
      delta: { fee: 0, legitimacy: 4 },
    },
    {
      id: "not_discussed",
      label: "Fees never came up in the conversation",
      delta: { fee: 4, legitimacy: 5 },
    },
  ],
};

export const SCREEN_DEMO_QUESTIONS: Question[] = [
  Q1_PRACTICE_AREA,
  Q2_JURISDICTION,
  Q3_TIMELINE,
  Q4_STAKES,
  Q5_FEE_FIT,
];
