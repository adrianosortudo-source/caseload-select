/**
 * score-components.ts  -  source-aware ScoreRationaleInput builder.
 *
 * CaseLoad Select scores leads via two engines:
 *
 *   1. v2.1_form   -  src/lib/scoring.ts::computeScore()
 *      7 factors, fit max 30, value max 65.
 *      Writers: src/app/api/leads/route.ts, src/app/api/v1/leads/route.ts.
 *
 *   2. gpt_cpi_v1  -  src/lib/cpi-calculator.ts::validateAndFixScoring()
 *      8 factors, fit max 40, value max 60.
 *      Writer: src/app/api/otp/verify/route.ts (promoteToLead path).
 *
 * The two engines share five sub-score columns (geo, legitimacy, complexity,
 * urgency, fee) but diverge on the rest  -  the form engine has contactability
 * and strategic; the GPT engine has practice, referral, multi_practice.
 *
 * leads.scoring_model tags which engine produced the row. leads.score_components
 * carries the native breakdown as JSONB so the source-specific extra factors
 * survive. This helper reads both and returns a ScoreRationaleInput shaped
 * correctly for buildScoreRationale() in src/lib/score-rationale.ts.
 *
 * Consumers:
 *   - src/app/leads/[id]/page.tsx (admin lead detail)
 *   - src/app/portal/[firmId]/leads/[leadId]/page.tsx (portal lead detail)
 *   - src/components/demo/LawyerViewPanel.tsx (demo overlay, mock leads)
 */

import type {
  RationaleBand,
  ScoreFactor,
  ScoreRationaleInput,
} from "@/lib/score-rationale";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ScoringModel = "v2.1_form" | "gpt_cpi_v1";

/**
 * Minimal lead shape this helper reads. Callers can pass a lead row from
 * Supabase directly  -  extra fields are ignored. All fields are optional so
 * the helper degrades gracefully on partial rows.
 */
export interface LeadScoringRow {
  band?: string | null;
  priority_band?: string | null;
  priority_index?: number | null;
  cpi_score?: number | null;
  fit_score?: number | null;
  value_score?: number | null;
  geo_score?: number | null;
  contactability_score?: number | null;
  legitimacy_score?: number | null;
  complexity_score?: number | null;
  urgency_score?: number | null;
  strategic_score?: number | null;
  fee_score?: number | null;
  scoring_model?: string | null;
  score_components?: Record<string, unknown> | null;
  cpi_missing_fields?: string[] | null;
}

/**
 * Component layout each engine produces. Kept flat for ranking; callers that
 * want to display "/30" totals use fitMax / valMax.
 */
interface ModelLayout {
  fitMax: number;
  valMax: number;
  components: ScoreFactor[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-model builders
// ─────────────────────────────────────────────────────────────────────────────

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildFormLayout(row: LeadScoringRow): ModelLayout {
  // v2.1 form engine. Shape defined in src/lib/scoring.ts. The top-level
  // sub-score columns on leads are the canonical source here; score_components
  // JSONB (when present) is a mirror.
  const c = row.score_components ?? {};
  return {
    fitMax: 30,
    valMax: 65,
    components: [
      { label: "Geographic fit",     value: numberOr(row.geo_score            ?? c.geo_score),            max: 10 },
      { label: "Contactability",     value: numberOr(row.contactability_score ?? c.contactability_score), max: 10 },
      { label: "Inquiry legitimacy", value: numberOr(row.legitimacy_score     ?? c.legitimacy_score),     max: 10 },
      { label: "Case complexity",    value: numberOr(row.complexity_score     ?? c.complexity_score),     max: 25 },
      { label: "Urgency",            value: numberOr(row.urgency_score        ?? c.urgency_score),        max: 20 },
      { label: "Strategic value",    value: numberOr(row.strategic_score      ?? c.strategic_score),      max: 10 },
      { label: "Fee capacity",       value: numberOr(row.fee_score            ?? c.fee_score),            max: 10 },
    ],
  };
}

function buildGptLayout(row: LeadScoringRow): ModelLayout {
  // gpt_cpi_v1 engine. Shape defined in src/lib/cpi-calculator.ts. The OTP
  // verify writer populates the overlapping columns on leads (geo, legitimacy,
  // complexity, urgency, fee) for the current admin score-bar UI, but the
  // full 8-factor breakdown  -  including practice, referral, multi_practice,
  // plus GPT's fit_score / value_score totals  -  lives in score_components
  // JSONB. Prefer JSONB values when present; fall back to top-level columns.
  const c = row.score_components ?? {};
  return {
    fitMax: 40,
    valMax: 60,
    components: [
      { label: "Geographic fit",     value: numberOr(c.geo_score          ?? row.geo_score),        max: 10 },
      { label: "Practice fit",       value: numberOr(c.practice_score),                             max: 10 },
      { label: "Inquiry legitimacy", value: numberOr(c.legitimacy_score   ?? row.legitimacy_score), max: 10 },
      { label: "Referral signal",    value: numberOr(c.referral_score),                             max: 10 },
      { label: "Urgency",            value: numberOr(c.urgency_score      ?? row.urgency_score),    max: 20 },
      { label: "Case complexity",    value: numberOr(c.complexity_score   ?? row.complexity_score), max: 25 },
      { label: "Multi-practice fit", value: numberOr(c.multi_practice_score),                       max: 5  },
      { label: "Fee capacity",       value: numberOr(c.fee_score          ?? row.fee_score),        max: 10 },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the scoring model for a lead, defaulting unknown rows to v2.1_form.
 * Legacy rows inserted before scoring_model was a column fall under this
 * default because their sub-scores were written by the form engine.
 */
export function resolveScoringModel(row: LeadScoringRow): ScoringModel {
  return row.scoring_model === "gpt_cpi_v1" ? "gpt_cpi_v1" : "v2.1_form";
}

/**
 * Build a ScoreRationaleInput from a lead row, branching on scoring_model.
 *
 * Returns null when the lead has no band assigned (nothing to rationalise).
 * Callers pass the return value straight into buildScoreRationale().
 */
export function buildScoreRationaleInput(
  row: LeadScoringRow,
  opts: { aiAngle?: string | null } = {},
): ScoreRationaleInput | null {
  const band = (row.band ?? row.priority_band ?? null) as RationaleBand | null;
  if (!band) return null;

  const model = resolveScoringModel(row);
  const layout = model === "gpt_cpi_v1" ? buildGptLayout(row) : buildFormLayout(row);

  // Prefer the native totals from score_components when the engine populated
  // them (GPT writes fit_score / value_score into the JSONB snapshot). Fall
  // back to the lead columns for form rows, which is where computeScore writes.
  const c = row.score_components ?? {};
  const fitValue = model === "gpt_cpi_v1"
    ? numberOr(c.fit_score,   numberOr(row.fit_score))
    : numberOr(row.fit_score, numberOr(c.fit_score));
  const valValue = model === "gpt_cpi_v1"
    ? numberOr(c.value_score,   numberOr(row.value_score))
    : numberOr(row.value_score, numberOr(c.value_score));

  const total = numberOr(row.priority_index ?? row.cpi_score ?? c.total);

  return {
    band,
    total,
    fit: { value: fitValue, max: layout.fitMax },
    val: { value: valValue, max: layout.valMax },
    components: layout.components,
    missingFields: row.cpi_missing_fields ?? null,
    aiAngle: opts.aiAngle ?? null,
  };
}
