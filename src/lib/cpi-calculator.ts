/**
 * CPI Calculator  -  S10.4
 *
 * Centralizes the Case Priority Index (CPI) scoring logic that was previously
 * embedded in route.ts. Exports:
 *   - CpiBreakdown       -  typed shape of the full CPI score object
 *   - FEE_FLOOR          -  per-PA minimum fee_score on first message
 *   - COMPLEXITY_FLOOR   -  per-PA minimum complexity_score on first message
 *   - validateAndFixScoring()  -  clamps components, recomputes sums, assigns band
 *   - computeCpiPartial()      -  derives the cpi_partial field for every response
 *
 * The CPI scale:
 *   fit_score   = geo + practice + legitimacy + referral  (max 40)
 *   value_score = urgency + complexity + multi_practice + fee  (max 60)
 *   total       = fit + value  (max 100)
 *
 * Band thresholds (primary):
 *   A ≥ 80 | B ≥ 60 | C ≥ 40 | D ≥ 20 | E < 20
 *
 * Three-axis derived scores (normalized 0-100, read-only  -  do NOT let GPT write these):
 *   cpi_fit       -  how well this matter matches the firm (from fit_score)
 *   cpi_urgency   -  time pressure on this matter (from urgency_score)
 *   cpi_friction  -  case risk / red-flag signal (inverted legitimacy_score)
 *
 * Band modifiers (applied after primary threshold):
 *   Urgency promotion: cpi_urgency ≥ 75 AND total ≥ 55 → Band A
 *     (imminent deadlines warrant immediate attention regardless of total)
 *   Friction floor:    cpi_friction ≥ 80 (legitimacy ≤ 2) → floor at Band D
 *     (very low legal basis cannot reach Band A or B)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CpiBreakdown {
  fit_score: number;
  geo_score: number;
  practice_score: number;
  legitimacy_score: number;
  referral_score: number;
  value_score: number;
  urgency_score: number;
  complexity_score: number;
  multi_practice_score: number;
  fee_score: number;
  total: number;
  /** A/B/C/D/E are scored bands. X = "Needs Review" fallback (KB-23 Lesson 02):
   *  set when the LLM call failed, returned invalid JSON, scored with confidence
   *  below 0.6, or omitted required reasoning. Routed to manual triage  -  never
   *  treated as a regular score. */
  band: "A" | "B" | "C" | "D" | "E" | "X" | null;
  band_locked: boolean;
  /**
   * Three-axis derived scores (normalized 0-100). Computed server-side in
   * validateAndFixScoring(). Never written by GPT. Used for human-readable
   * triage signals  -  lawyers see fit/urgency/friction, not the raw component scores.
   *
   * cpi_fit:      How well this matter matches what the firm does. Derived from fit_score.
   * cpi_urgency:  Time pressure on this matter. Derived from urgency_score.
   * cpi_friction: Red-flag / case-risk signal. Inverse of legitimacy_score.
   *               High friction = low legal basis, prior complicating factors, or red flags.
   */
  cpi_fit: number;
  cpi_urgency: number;
  cpi_friction: number;
}

/**
 * Compact representation of the current CPI state, returned on every API
 * response so the widget can show a live updating band indicator.
 *
 * confidence:
 *   "provisional"  -  still collecting data; score will change as answers arrive
 *   "final"        -  band is locked or the session is finalized; score is definitive
 */
export interface CpiPartial {
  score: number;
  band: "A" | "B" | "C" | "D" | "E" | "X" | null;
  confidence: "provisional" | "final";
  /**
   * Urgency axis (0-100). Exposed in partial when ≥ 50 so the widget can
   * show a "time-sensitive" badge without revealing the full breakdown.
   * Undefined when urgency is low (< 50) to keep the response lean.
   */
  urgency?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-practice-area CPI floor maps
// Prevents GPT from scoring 0 on the first message when data is sparse.
// Floors are applied server-side after each GPT response.
// fee_score ceiling: 10  |  complexity_score ceiling: 25
// ─────────────────────────────────────────────────────────────────────────────

export const FEE_FLOOR: Record<string, number> = {
  fam: 6, pi: 6, emp: 6, crim: 6, real: 6, corp: 6, est: 5, llt: 5,
  civ: 6, imm: 6, ip: 5, tax: 5, admin: 5, ins: 6, const: 6, bank: 6,
  priv: 5, fran: 5, env: 5, prov: 4, condo: 5, hr: 5, edu: 4, health: 5,
  debt: 4, nfp: 4, defam: 5, socben: 4, gig: 5, sec: 7, elder: 5,
  str: 4, crypto: 5, ecom: 4, animal: 5,
};

export const COMPLEXITY_FLOOR: Record<string, number> = {
  fam: 6, pi: 6, emp: 5, crim: 7, real: 5, corp: 5, est: 4, llt: 5,
  civ: 5, imm: 7, ip: 6, tax: 7, admin: 6, ins: 6, const: 6, bank: 5,
  priv: 5, fran: 5, env: 7, prov: 4, condo: 5, hr: 6, edu: 5, health: 6,
  debt: 4, nfp: 4, defam: 5, socben: 4, gig: 5, sec: 7, elder: 5,
  str: 4, crypto: 5, ecom: 4, animal: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// Scoring validator  -  trust GPT's components, recompute sums, assign band
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamp all CPI components to their valid ranges, recompute sums from
 * components (overriding any GPT arithmetic errors), and assign the band.
 * Always call this after receiving a GPT response.
 */
export function validateAndFixScoring(cpi: CpiBreakdown): CpiBreakdown {
  // Clamp all components to valid ranges
  cpi.geo_score          = Math.min(10, Math.max(0, Math.round(cpi.geo_score          ?? 0)));
  cpi.practice_score     = Math.min(10, Math.max(0, Math.round(cpi.practice_score     ?? 0)));
  cpi.legitimacy_score   = Math.min(10, Math.max(0, Math.round(cpi.legitimacy_score   ?? 0)));
  cpi.referral_score     = Math.min(10, Math.max(0, Math.round(cpi.referral_score     ?? 0)));
  cpi.urgency_score      = Math.min(20, Math.max(0, Math.round(cpi.urgency_score      ?? 0)));
  cpi.complexity_score   = Math.min(25, Math.max(0, Math.round(cpi.complexity_score   ?? 0)));
  cpi.multi_practice_score = Math.min(5, Math.max(0, Math.round(cpi.multi_practice_score ?? 0)));
  cpi.fee_score          = Math.min(10, Math.max(0, Math.round(cpi.fee_score          ?? 0)));

  // Recompute sums from components (overrides any GPT arithmetic)
  cpi.fit_score   = cpi.geo_score + cpi.practice_score + cpi.legitimacy_score + cpi.referral_score;
  cpi.value_score = cpi.urgency_score + cpi.complexity_score + cpi.multi_practice_score + cpi.fee_score;
  cpi.total       = cpi.fit_score + cpi.value_score;

  // ── Three-axis derived scores (normalized 0-100) ───────────────────────
  // Server-computed. Never written by GPT. These are exposed to lawyers as
  // human-readable triage signals  -  fit quality, time pressure, and case risk.
  //
  // cpi_fit:     fit_score normalized from max 40
  // cpi_urgency: urgency_score normalized from max 20
  // cpi_friction: inverted legitimacy_score  -  high friction = low legitimacy
  //               Ranges from 0 (legitimacy=10, clean) to 100 (legitimacy=0, red flags)
  cpi.cpi_fit      = Math.round(cpi.fit_score / 40 * 100);
  cpi.cpi_urgency  = Math.round(cpi.urgency_score / 20 * 100);
  cpi.cpi_friction = Math.round((10 - cpi.legitimacy_score) / 10 * 100);

  // ── Primary band assignment ────────────────────────────────────────────
  if      (cpi.total >= 80) cpi.band = "A";
  else if (cpi.total >= 60) cpi.band = "B";
  else if (cpi.total >= 40) cpi.band = "C";
  else if (cpi.total >= 20) cpi.band = "D";
  else                       cpi.band = "E";

  // ── Band modifiers (applied after primary threshold) ──────────────────
  // These only activate at the extremes  -  the middle of the distribution is unchanged.

  // Urgency promotion: time-sensitive matters (imm_removal_order, fam_abduction,
  // imm_rad_deadline, construction_lien expiring) get Band A if total ≥ 55.
  // cpi_urgency ≥ 75 ↔ urgency_score ≥ 15/20.
  if (!cpi.band_locked && cpi.cpi_urgency >= 75 && cpi.total >= 55 && cpi.band !== "A") {
    cpi.band = "A";
  }

  // Friction floor: very low legitimacy (legitimacy_score ≤ 2, cpi_friction ≥ 80)
  // cannot reach Band A or B  -  cap at D for matters with near-zero legal basis.
  // Does not apply when band is locked (B+ already confirmed after full intake).
  if (!cpi.band_locked && cpi.cpi_friction >= 80 && (cpi.band === "A" || cpi.band === "B")) {
    cpi.band = "D";
  }

  return cpi;
}

// ─────────────────────────────────────────────────────────────────────────────
// Partial CPI  -  for every API response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the `cpi_partial` field from the current CPI breakdown.
 *
 * @param cpi       Current CPI breakdown (post-validate).
 * @param finalized Whether this response has finalize=true.
 * @returns         CpiPartial for inclusion in every API response.
 */
export function computeCpiPartial(cpi: CpiBreakdown, finalized: boolean): CpiPartial {
  const partial: CpiPartial = {
    score: cpi.total,
    band: cpi.band,
    confidence: (finalized || cpi.band_locked) ? "final" : "provisional",
  };
  // Expose urgency when it's significant (≥ 50) so the widget can show
  // a "time-sensitive" badge without revealing the full breakdown.
  if (cpi.cpi_urgency >= 50) {
    partial.urgency = cpi.cpi_urgency;
  }
  return partial;
}
