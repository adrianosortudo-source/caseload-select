/**
 * Case Value Estimation  -  S3
 *
 * Maps practice area + CPI score + slot answers to an estimated
 * case value bucket. Shown to the LAWYER (not the client) in the
 * intake memo and portal dashboard.
 *
 * Buckets are ranges, not promises. They reflect median Ontario court
 * awards / settlement ranges for comparable matters. Always annotated
 * with the disclaimers required by LSO Rule 3.2-1 (no outcome guarantees).
 *
 * Integration: call after CPI band is locked, before memo generation.
 * Called from: src/app/api/screen/route.ts (finalize path)
 *              src/lib/memo.ts (memo enrichment)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CaseValueBucket {
  /** Human-readable range label, e.g. "$75,000 – $250,000". */
  label: string;
  /** Lower bound in CAD. */
  low: number;
  /** Upper bound in CAD. null for open-ended top bucket. */
  high: number | null;
  /**
   * Tier identifier for sorting / colour coding:
   * "low" | "moderate" | "significant" | "high" | "exceptional"
   */
  tier: "low" | "moderate" | "significant" | "high" | "exceptional";
  /**
   * One-sentence rationale shown in the lawyer memo.
   * References the dominant scoring factor for this estimate.
   */
  rationale: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PA-specific value tables
// ─────────────────────────────────────────────────────────────────────────────

// CPI band → value bucket, per practice area family.
// Bands: A (80–100), B (60–79), C (40–59), D (20–39), E (0–19)

type BandKey = "A" | "B" | "C" | "D" | "E";

interface BandBucket {
  label: string;
  low: number;
  high: number | null;
  tier: CaseValueBucket["tier"];
  rationale: string;
}

const PI_BANDS: Record<BandKey, BandBucket> = {
  A: { label: "$250,000 – $1,000,000+", low: 250_000, high: null,      tier: "exceptional",  rationale: "Severe/catastrophic injury signals; strong liability and treatment documentation." },
  B: { label: "$75,000 – $250,000",     low: 75_000,  high: 250_000,   tier: "high",         rationale: "Significant soft-tissue or orthopaedic injury with ongoing treatment and wage loss." },
  C: { label: "$25,000 – $75,000",      low: 25_000,  high: 75_000,    tier: "significant",  rationale: "Moderate injury with partial recovery; within MIG cap range or just above." },
  D: { label: "$5,000 – $25,000",       low: 5_000,   high: 25_000,    tier: "moderate",     rationale: "Minor injury, limited treatment, or liability uncertainty." },
  E: { label: "Under $5,000",           low: 0,       high: 5_000,     tier: "low",          rationale: "Minimal injury indicators or hard disqualifiers (over-limitation, jurisdiction)." },
};

const EMP_BANDS: Record<BandKey, BandBucket> = {
  A: { label: "$150,000 – $500,000+",   low: 150_000, high: null,      tier: "exceptional",  rationale: "Long-tenured senior employee, unsigned package, inducement, or protected ground." },
  B: { label: "$50,000 – $150,000",     low: 50_000,  high: 150_000,   tier: "high",         rationale: "Mid-to-senior employee with 5–15 years service; package below common-law entitlement." },
  C: { label: "$15,000 – $50,000",      low: 15_000,  high: 50_000,    tier: "significant",  rationale: "Junior-to-mid employee with 1–5 years; ESA minimum or no package offered." },
  D: { label: "$3,000 – $15,000",       low: 3_000,   high: 15_000,    tier: "moderate",     rationale: "Short tenure or strong employer position; limited Bardal factors." },
  E: { label: "Likely ESA minimum only",low: 0,       high: 5_000,     tier: "low",          rationale: "Signed release, under 3 months tenure, or contract caps notice." },
};

const FAM_BANDS: Record<BandKey, BandBucket> = {
  A: { label: "$500,000+ net family property", low: 500_000, high: null,    tier: "exceptional",  rationale: "Complex equalization, business interests, or contested custody with parens patriae issues." },
  B: { label: "$150,000 – $500,000",           low: 150_000, high: 500_000, tier: "high",         rationale: "Significant matrimonial assets, spousal support, and/or pension division." },
  C: { label: "$30,000 – $150,000",            low: 30_000,  high: 150_000, tier: "significant",  rationale: "Moderate asset division or support dispute; contested parenting." },
  D: { label: "$5,000 – $30,000",              low: 5_000,   high: 30_000,  tier: "moderate",     rationale: "Limited assets, short marriage, or consent-track likely." },
  E: { label: "Consent order / minimal value", low: 0,       high: 10_000,  tier: "low",          rationale: "Uncontested or minimal-asset matter; flat-fee or unbundled service likely." },
};

const CRIM_BANDS: Record<BandKey, BandBucket> = {
  A: { label: "$25,000 – $75,000+ (fees)", low: 25_000, high: null,      tier: "exceptional",  rationale: "Indictable with real incarceration risk; multi-day trial likely." },
  B: { label: "$10,000 – $25,000 (fees)",  low: 10_000, high: 25_000,    tier: "high",         rationale: "Serious hybrid or summary with significant Charter issues." },
  C: { label: "$4,000 – $10,000 (fees)",   low: 4_000,  high: 10_000,    tier: "significant",  rationale: "Summary conviction; diversion or guilty plea plausible." },
  D: { label: "$2,000 – $4,000 (fees)",    low: 2_000,  high: 4_000,     tier: "moderate",     rationale: "Minor summary; duty counsel or unbundled service may apply." },
  E: { label: "Duty counsel / legal aid",  low: 0,      high: 2_000,     tier: "low",          rationale: "Low complexity or likely legal aid eligible." },
};

// Fallback for practice areas without a specific table
const DEFAULT_BANDS: Record<BandKey, BandBucket> = {
  A: { label: "$100,000+",    low: 100_000, high: null,    tier: "exceptional",  rationale: "High CPI score  -  strong fit indicators." },
  B: { label: "$30,000 – $100,000", low: 30_000, high: 100_000, tier: "high",   rationale: "Above-average fit and value signals." },
  C: { label: "$10,000 – $30,000",  low: 10_000, high: 30_000,  tier: "significant", rationale: "Moderate fit; value confirmation needed." },
  D: { label: "$2,000 – $10,000",   low: 2_000,  high: 10_000,  tier: "moderate",    rationale: "Below-average fit; limited qualifying signals." },
  E: { label: "Under $2,000",       low: 0,      high: 2_000,   tier: "low",         rationale: "Poor fit; likely out-of-scope or low-value." },
};

// ─────────────────────────────────────────────────────────────────────────────
// Band resolver
// ─────────────────────────────────────────────────────────────────────────────

function cpiToBand(cpiScore: number): BandKey {
  if (cpiScore >= 80) return "A";
  if (cpiScore >= 60) return "B";
  if (cpiScore >= 40) return "C";
  if (cpiScore >= 20) return "D";
  return "E";
}

function tableForPa(practiceAreaId: string): Record<BandKey, BandBucket> {
  const pa = practiceAreaId.toLowerCase();
  if (pa.startsWith("pi"))   return PI_BANDS;
  if (pa.startsWith("emp"))  return EMP_BANDS;
  if (pa.startsWith("fam"))  return FAM_BANDS;
  if (pa.startsWith("crim")) return CRIM_BANDS;
  return DEFAULT_BANDS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate case value bucket from CPI score and practice area.
 *
 * @param practiceAreaId  Sub-type or top-level PA ID (e.g. "pi_mva", "emp", "fam_separation").
 * @param cpiScore        Composite CPI score 0–100.
 * @param answers         Optional slot answers for slot-level overrides.
 *
 * Slot-level overrides applied:
 *   - emp: signed_full_release → forces Band E
 *   - pi:  disqualifies flag   → forces Band E
 */
export function estimateCaseValue(
  practiceAreaId: string,
  cpiScore: number,
  answers: Record<string, string> = {},
): CaseValueBucket {
  let band = cpiToBand(cpiScore);

  // Hard overrides
  if (answers["emp_dismissal__severance_offered"] === "signed_full_release") {
    band = "E";
  }

  const table = tableForPa(practiceAreaId);
  const bucket = table[band];

  return {
    label: bucket.label,
    low: bucket.low,
    high: bucket.high,
    tier: bucket.tier,
    rationale: bucket.rationale,
  };
}

/**
 * Format a CaseValueBucket as a single line for the lawyer memo.
 * Example: "Estimated value: $75,000 – $250,000 (high)  -  Significant soft-tissue..."
 */
export function formatCaseValueForMemo(bucket: CaseValueBucket): string {
  return `Estimated value: ${bucket.label} (${bucket.tier})  -  ${bucket.rationale}`;
}
