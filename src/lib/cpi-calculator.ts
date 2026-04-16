/**
 * CPI Calculator — S10.4
 *
 * Centralizes the Case Priority Index (CPI) scoring logic that was previously
 * embedded in route.ts. Exports:
 *   - CpiBreakdown      — typed shape of the full CPI score object
 *   - FEE_FLOOR         — per-PA minimum fee_score on first message
 *   - COMPLEXITY_FLOOR  — per-PA minimum complexity_score on first message
 *   - validateAndFixScoring() — clamps components, recomputes sums, assigns band
 *   - computeCpiPartial()     — derives the cpi_partial field for every response
 *
 * The CPI scale:
 *   fit_score   = geo + practice + legitimacy + referral  (max 40)
 *   value_score = urgency + complexity + multi_practice + fee  (max 60)
 *   total       = fit + value  (max 100)
 *
 * Band thresholds:
 *   A ≥ 80 | B ≥ 60 | C ≥ 40 | D ≥ 20 | E < 20
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
  band: "A" | "B" | "C" | "D" | "E" | null;
  band_locked: boolean;
}

/**
 * Compact representation of the current CPI state, returned on every API
 * response so the widget can show a live updating band indicator.
 *
 * confidence:
 *   "provisional" — still collecting data; score will change as answers arrive
 *   "final"       — band is locked or the session is finalized; score is definitive
 */
export interface CpiPartial {
  score: number;
  band: "A" | "B" | "C" | "D" | "E" | null;
  confidence: "provisional" | "final";
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
// Scoring validator — trust GPT's components, recompute sums, assign band
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

  // Assign band from total
  if      (cpi.total >= 80) cpi.band = "A";
  else if (cpi.total >= 60) cpi.band = "B";
  else if (cpi.total >= 40) cpi.band = "C";
  else if (cpi.total >= 20) cpi.band = "D";
  else                       cpi.band = "E";

  return cpi;
}

// ─────────────────────────────────────────────────────────────────────────────
// Partial CPI — for every API response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the `cpi_partial` field from the current CPI breakdown.
 *
 * @param cpi       Current CPI breakdown (post-validate).
 * @param finalized Whether this response has finalize=true.
 * @returns         CpiPartial for inclusion in every API response.
 */
export function computeCpiPartial(cpi: CpiBreakdown, finalized: boolean): CpiPartial {
  return {
    score: cpi.total,
    band: cpi.band,
    confidence: (finalized || cpi.band_locked) ? "final" : "provisional",
  };
}
