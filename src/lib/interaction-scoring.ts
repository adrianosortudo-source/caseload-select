/**
 * Interaction Scoring Functions  -  S3 domain-specific urgency calculators
 *
 * Two standalone, pure functions that produce domain-specific urgency
 * scores from slot answers. Designed to be called after slot answers
 * are confirmed and before the final CPI band is locked.
 *
 * computeSabsUrgency   -  Ontario SABS/PI time-pressure calculator
 * computeDismissalBardal  -  Ontario wrongful dismissal Bardal factor scorer
 *
 * Both functions:
 *   - Accept a Record<string, string> of slot answers (question ID → value)
 *   - Are fully pure: no side effects, no I/O
 *   - Return a structured result with a 0–100 urgency/Bardal score
 *   - Include human-readable flags for the lawyer memo
 *
 * Integration: call from screen/route.ts after Round 1/2 answers are
 * confirmed, store the result in session scoring, surface in the memo.
 */

// ─────────────────────────────────────────────────────────────────────────────
// computeSabsUrgency
// Ontario Statutory Accident Benefits Schedule (SABS / O. Reg. 34/10)
// ─────────────────────────────────────────────────────────────────────────────

export interface SabsUrgencyResult {
  /** 0–100. Higher = more time-sensitive. */
  urgencyScore: number;
  /** Human-readable tier for routing. */
  urgencyTier: "critical" | "high" | "moderate" | "low";
  /**
   * Deadline items relevant to this case.
   * daysRemaining: null when accident date is unknown.
   * overdue: true when the window has already passed.
   */
  deadlines: Array<{
    label: string;
    windowDays: number;
    daysRemaining: number | null;
    overdue: boolean;
  }>;
  /** Plain-language flags for the lawyer memo / intake alert. */
  flags: string[];
}

/**
 * Compute SABS urgency from confirmed slot answers.
 *
 * @param answers  Record of slot ID → selected value.
 *
 * Slot IDs consumed (any mix of pi_mva__ and pi_slip_fall__ sub-types):
 *   pi_mva__accident_date       ISO date string (YYYY-MM-DD)
 *   pi_mva__reported_to_insurer "yes" | "no" | "unsure"
 *   pi_mva__ocf1_filed          "yes" | "no" | "unsure"
 *   pi_mva__irb_applied         "yes" | "no"
 *   pi_mva__treatment_status    "in_treatment" | "completed" | "planned" | "none"
 *   pi_mig_designation (flag)   presence in answers signals MIG is at issue
 *   pi_mva__catastrophic        "yes" | "no" | "unsure"
 *   pi_slip_fall__municipality_notified  "yes" | "no" | "unsure"  (slip/fall only)
 *
 * Falls back gracefully when any slot is absent.
 */
export function computeSabsUrgency(answers: Record<string, string>): SabsUrgencyResult {
  const flags: string[] = [];
  const deadlines: SabsUrgencyResult["deadlines"] = [];
  let score = 0;

  // ── Accident date → compute days elapsed ─────────────────────────────────
  const accidentDateRaw =
    answers["pi_mva__accident_date"] ??
    answers["pi_slip_fall__accident_date"] ??
    null;

  let daysElapsed: number | null = null;
  if (accidentDateRaw) {
    const d = new Date(accidentDateRaw);
    if (!isNaN(d.getTime())) {
      daysElapsed = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  // ── 7-day insurer notification window ────────────────────────────────────
  const reportedToInsurer = answers["pi_mva__reported_to_insurer"];
  if (reportedToInsurer !== "yes") {
    const remaining = daysElapsed !== null ? 7 - daysElapsed : null;
    const overdue = remaining !== null && remaining < 0;
    deadlines.push({
      label: "Notify insurer (SABS s.32, 7-day window)",
      windowDays: 7,
      daysRemaining: remaining,
      overdue,
    });
    if (overdue) {
      flags.push("Insurer notification window (7 days) has passed  -  late notice may trigger s.33 disentitlement defence.");
      score += 35;
    } else if (remaining !== null && remaining <= 2) {
      flags.push(`Insurer notification deadline in ${remaining} day${remaining === 1 ? "" : "s"}  -  urgent.`);
      score += 30;
    } else if (remaining !== null && remaining <= 5) {
      score += 20;
    } else {
      score += 10; // Unknown date but unreported  -  still urgent
    }
  }

  // ── 30-day OCF-1 filing window ───────────────────────────────────────────
  const ocf1Filed = answers["pi_mva__ocf1_filed"];
  if (ocf1Filed !== "yes") {
    const remaining = daysElapsed !== null ? 30 - daysElapsed : null;
    const overdue = remaining !== null && remaining < 0;
    deadlines.push({
      label: "File OCF-1 Application for Accident Benefits (30-day window)",
      windowDays: 30,
      daysRemaining: remaining,
      overdue,
    });
    if (overdue) {
      flags.push("OCF-1 filing window (30 days) appears overdue  -  insurer may dispute entitlement.");
      score += 25;
    } else if (remaining !== null && remaining <= 7) {
      flags.push(`OCF-1 deadline in ${remaining} day${remaining === 1 ? "" : "s"}.`);
      score += 20;
    } else {
      score += 8;
    }
  }

  // ── IRB (Income Replacement Benefits)  -  7-day elimination period ─────────
  const irbApplied = answers["pi_mva__irb_applied"];
  if (irbApplied === "no" && daysElapsed !== null && daysElapsed > 7) {
    flags.push("IRB not applied for  -  7-day elimination period may have started without the client's knowledge.");
    score += 12;
  }

  // ── MIG designation  -  $3,500 treatment cap ───────────────────────────────
  const migSignal =
    answers["pi_mig_designation"] === "yes" ||
    answers["pi_mva__mig_designation"] === "yes" ||
    answers["pi_mva__mig_designation"] === "at_issue";
  if (migSignal) {
    flags.push("MIG designation at issue  -  $3,500 treatment cap applies unless successfully disputed. Requires physiatrist or specialist report.");
    score += 15;
  }

  // ── Catastrophic impairment determination ────────────────────────────────
  const catastrophic = answers["pi_mva__catastrophic"];
  if (catastrophic === "yes" || catastrophic === "unsure") {
    flags.push("Catastrophic impairment claim  -  SABS Part IV enhanced benefits available; DAC assessment required.");
    score += 10;
    deadlines.push({
      label: "Catastrophic determination application (no strict deadline but early assessment recommended)",
      windowDays: 365,
      daysRemaining: daysElapsed !== null ? 365 - daysElapsed : null,
      overdue: false,
    });
  }

  // ── Slip/fall: municipal notice ───────────────────────────────────────────
  const municipalityNotified = answers["pi_slip_fall__municipality_notified"];
  if (municipalityNotified !== "yes") {
    const remaining = daysElapsed !== null ? 10 - daysElapsed : null;
    const overdue = remaining !== null && remaining < 0;
    deadlines.push({
      label: "Municipal Act written notice (10-day window for city-property falls)",
      windowDays: 10,
      daysRemaining: remaining,
      overdue,
    });
    if (overdue) {
      flags.push("10-day municipal notice window appears overdue  -  may face s.44(9) Municipal Act defence.");
      score += 30;
    } else if (remaining !== null && remaining <= 3) {
      flags.push(`Municipal notice deadline in ${remaining} day${remaining === 1 ? "" : "s"}  -  extremely urgent.`);
      score += 25;
    }
  }

  // Cap at 100
  score = Math.min(100, score);

  // Tier
  const urgencyTier: SabsUrgencyResult["urgencyTier"] =
    score >= 70 ? "critical" :
    score >= 45 ? "high" :
    score >= 20 ? "moderate" :
    "low";

  return { urgencyScore: score, urgencyTier, deadlines, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeDismissalBardal
// Ontario wrongful dismissal  -  Bardal factor reasonable notice estimator
// Reference: Bardal v Globe and Mail Ltd (1960) 24 DLR (2d) 140 (Ont HC)
// ─────────────────────────────────────────────────────────────────────────────

export interface BardalResult {
  /**
   * Estimated reasonable notice range in months.
   * Ontario courts rarely exceed 24 months except for long-tenured executives.
   */
  estimatedNoticeMonths: { low: number; high: number };
  /**
   * 0–100 score for use as a CPI scoring input.
   * Maps the notice range mid-point onto the 0–100 scale, anchored at
   * 24 months = 100 (maximum realistic common-law award without aggravating factors).
   */
  bardalScore: number;
  /**
   * Individual factor breakdown for the lawyer memo.
   */
  factors: Array<{
    factor: string;
    /** Months contributed by this factor (can be negative for deductions). */
    monthsContribution: number;
    impact: "positive" | "negative" | "neutral";
    note?: string;
  }>;
  /** Plain-language flags for the memo. */
  flags: string[];
}

/**
 * Compute Bardal factors from confirmed slot answers.
 *
 * @param answers  Record of slot ID → selected value.
 *
 * Slot IDs consumed:
 *   emp_dismissal__tenure_years          "under_1" | "1_3" | "3_5" | "5_10" | "10_15" | "over_15"
 *   emp_dismissal__position_level        "executive_c_suite" | "manager_director" | "professional_specialist" | "clerical_administrative" | "entry_level"
 *   emp_dismissal__age_bracket           "under_30" | "30_40" | "40_50" | "50_60" | "over_60"
 *   emp_dismissal__salary_range          "under_50k" | "50k_100k" | "100k_200k" | "over_200k"
 *   emp_dismissal__induced_to_leave      "yes" | "no" | "unsure"
 *   emp_dismissal__severance_offered     "no_package_offered" | "esa_minimum_only" | "partial_package" | "package_unsigned" | "signed_full_release"
 *   emp_dismissal__signing_deadline      "deadline_7d" | "deadline_7d+" | "no_deadline" (followUp)
 *   emp_dismissal__protected_ground      "yes" | "no" | "unsure"
 *
 * All fields are optional  -  missing fields reduce confidence, not accuracy.
 */
export function computeDismissalBardal(answers: Record<string, string>): BardalResult {
  const factors: BardalResult["factors"] = [];
  const flags: string[] = [];
  let baseMonths = 0;

  // ── 1. Length of service ─────────────────────────────────────────────────
  const tenureMap: Record<string, { years: number; label: string }> = {
    "under_1":  { years: 0.5,  label: "Less than 1 year" },
    "1_3":      { years: 2,    label: "1–3 years" },
    "3_5":      { years: 4,    label: "3–5 years" },
    "5_10":     { years: 7.5,  label: "5–10 years" },
    "10_15":    { years: 12.5, label: "10–15 years" },
    "over_15":  { years: 18,   label: "Over 15 years" },
  };
  const tenure = tenureMap[answers["emp_dismissal__tenure_years"]];
  const tenureMonths = tenure ? Math.min(tenure.years * 1.0, 18) : 0;
  if (tenure) {
    factors.push({
      factor: `Length of service (${tenure.label})`,
      monthsContribution: tenureMonths,
      impact: tenureMonths >= 8 ? "positive" : "neutral",
    });
    baseMonths += tenureMonths;
  }

  // ── 2. Character of employment (position level) ──────────────────────────
  const positionMultipliers: Record<string, { mult: number; label: string; cap: number }> = {
    "executive_c_suite":       { mult: 1.4, label: "Executive / C-suite", cap: 24 },
    "manager_director":        { mult: 1.2, label: "Manager or director",  cap: 20 },
    "professional_specialist": { mult: 1.1, label: "Professional / specialist", cap: 18 },
    "clerical_administrative": { mult: 0.9, label: "Clerical / administrative", cap: 14 },
    "entry_level":             { mult: 0.7, label: "Entry level / casual", cap: 10 },
  };
  const position = positionMultipliers[answers["emp_dismissal__position_level"]];
  const positionBonus = tenure && position ? tenureMonths * (position.mult - 1) : 0;
  if (position && positionBonus !== 0) {
    factors.push({
      factor: `Character of employment (${position.label})`,
      monthsContribution: positionBonus,
      impact: positionBonus > 0 ? "positive" : "negative",
    });
    baseMonths += positionBonus;
  }

  // ── 3. Age at dismissal ───────────────────────────────────────────────────
  const ageAdjustments: Record<string, { bonus: number; label: string }> = {
    "under_30": { bonus: -1,   label: "Under 30" },
    "30_40":    { bonus: 0,    label: "30–40" },
    "40_50":    { bonus: 1,    label: "40–50" },
    "50_60":    { bonus: 2.5,  label: "50–60" },
    "over_60":  { bonus: 4,    label: "Over 60" },
  };
  const ageBracket = ageAdjustments[answers["emp_dismissal__age_bracket"]];
  if (ageBracket) {
    factors.push({
      factor: `Age at dismissal (${ageBracket.label})`,
      monthsContribution: ageBracket.bonus,
      impact: ageBracket.bonus > 0 ? "positive" : ageBracket.bonus < 0 ? "negative" : "neutral",
      note: ageBracket.bonus > 0
        ? "Older workers face greater re-employment difficulty (Wallace, Bardal)"
        : undefined,
    });
    baseMonths += ageBracket.bonus;
  }

  // ── 4. Inducement ────────────────────────────────────────────────────────
  const induced = answers["emp_dismissal__induced_to_leave"];
  if (induced === "yes") {
    factors.push({
      factor: "Inducement to leave secure employment",
      monthsContribution: 3,
      impact: "positive",
      note: "Employer-induced departure supports extended notice: Gillespie v 1249012 Ontario",
    });
    baseMonths += 3;
    flags.push("Inducement flag: client was recruited away from a secure position. Courts consistently extend notice awards in inducement cases.");
  }

  // ── 5. Protected ground / discrimination ─────────────────────────────────
  const protectedGround = answers["emp_dismissal__protected_ground"];
  if (protectedGround === "yes") {
    flags.push("Potential Human Rights Code ground  -  consider concurrent HRTO application (no limitation period until complaint resolved). Aggravated damages possible.");
  }

  // ── 6. Severance already offered ─────────────────────────────────────────
  const severance = answers["emp_dismissal__severance_offered"];
  if (severance === "signed_full_release") {
    flags.push("Full release signed  -  recovery is likely barred unless signed under duress or misrepresentation. Seek immediate advice.");
    factors.push({
      factor: "Full release already signed",
      monthsContribution: 0,
      impact: "negative",
      note: "Signed release is a full defence to common-law wrongful dismissal claim.",
    });
  } else if (severance === "package_unsigned") {
    const deadline = answers["emp_dismissal__signing_deadline"];
    if (deadline === "deadline_7d") {
      flags.push("Signing deadline within 7 days  -  critical. Client must consult counsel before signing or deadline passes.");
    } else if (deadline === "deadline_7d+") {
      flags.push("Signing deadline over 7 days away  -  advise client not to sign until reviewed.");
    }
    flags.push("Package is unsigned  -  full common-law notice claim is still available.");
  }

  // Cap total months by position ceiling
  const cap = position?.cap ?? 18;
  baseMonths = Math.min(baseMonths, cap);
  baseMonths = Math.max(0, baseMonths);

  // Build range: low = 80%, high = 120%, both rounded to 0.5
  const roundHalf = (n: number) => Math.round(n * 2) / 2;
  const low  = Math.max(0.5, roundHalf(baseMonths * 0.80));
  const high = Math.min(cap,  roundHalf(baseMonths * 1.20));

  // Bardal score: mid-point of range mapped to 0–100 (24 months = 100)
  const midMonths = (low + high) / 2;
  const bardalScore = Math.round(Math.min(100, (midMonths / 24) * 100));

  return {
    estimatedNoticeMonths: { low, high },
    bardalScore,
    factors,
    flags,
  };
}
