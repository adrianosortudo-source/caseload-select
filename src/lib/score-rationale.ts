/**
 * score-rationale.ts  -  Structured "why this band" rationale.
 *
 * Single source of truth for the interpretive layer that sits on top of the
 * raw CPI numbers. Consumed by:
 *   - Demo overlay (src/components/demo/LawyerViewPanel.tsx)
 *   - Admin lead detail (src/app/leads/[id]/page.tsx)
 *   - Portal lead detail (src/app/portal/[firmId]/leads/[leadId]/page.tsx)
 *
 * Three layers compose into one block:
 *   1. Deterministic band rationale  -  always present. Explains the fit/value
 *      trade-off and names the strongest and weakest factors. Pure function of
 *      the score components.
 *   2. Data-gap callout  -  missing fields reframed as first-call questions.
 *      Present whenever the scoring engine returned missing_fields.
 *   3. AI angle (optional)  -  1-sentence legal probe for the first call.
 *      Labeled as AI-assisted. Empty slot for future wiring; safe no-op today.
 *
 * No "use client" directive: pure data + logic, importable from server and
 * client components alike.
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type RationaleBand = "A" | "B" | "C" | "D" | "E";

export interface ScoreFactor {
  label: string;
  value: number;
  max: number;
}

export interface ScoreRationaleInput {
  band: RationaleBand | null | undefined;
  total: number;
  fit: { value: number; max: number };
  val: { value: number; max: number };
  /** Flat list of all sub-scores. Used to rank strengths/weaknesses. */
  components: ScoreFactor[];
  /** Human-readable labels from detectMissingFields(). Optional. */
  missingFields?: string[] | null;
  /** Optional 1-sentence AI-generated legal probe. Clearly labeled as AI. */
  aiAngle?: string | null;
}

export interface ScoreRationale {
  bandLine: string;
  strengths: ScoreFactor[];
  weaknesses: ScoreFactor[];
  callQuestions: string[];
  aiAngle: string | null;
}

// ─────────────────────────────────────────────
// Band line template
// ─────────────────────────────────────────────

type FitValShape =
  | "both_strong"
  | "fit_strong_val_weak"
  | "val_strong_fit_weak"
  | "both_weak"
  | "balanced";

function classifyShape(fitRatio: number, valRatio: number): FitValShape {
  if (fitRatio >= 0.7 && valRatio >= 0.7) return "both_strong";
  if (fitRatio < 0.4 && valRatio < 0.4) return "both_weak";
  if (fitRatio >= 0.65 && valRatio < 0.5) return "fit_strong_val_weak";
  if (valRatio >= 0.65 && fitRatio < 0.5) return "val_strong_fit_weak";
  return "balanced";
}

function buildBandLine(
  band: RationaleBand,
  shape: FitValShape,
  fit: { value: number; max: number },
  val: { value: number; max: number },
): string {
  const f = `${fit.value}/${fit.max}`;
  const v = `${val.value}/${val.max}`;

  switch (band) {
    case "A":
      return `Band A reflects strong fit (${f}) and strong case value (${v}). Priority across every dimension.`;
    case "B":
      if (shape === "fit_strong_val_weak")
        return `Band B: fit is strong (${f}), case value is moderate (${v}). Qualifies for standard intake.`;
      if (shape === "val_strong_fit_weak")
        return `Band B: case value is strong (${v}), fit is moderate (${f}). Qualifies for standard intake.`;
      return `Band B: good fit (${f}) and case value (${v}). Qualifies for standard intake.`;
    case "C":
      if (shape === "fit_strong_val_weak")
        return `Band C: fit signals are strong (${f}) but case value is limited (${v}). Borderline qualification.`;
      if (shape === "val_strong_fit_weak")
        return `Band C: case has real value (${v}) but fit signals are thin (${f}). Borderline qualification.`;
      return `Band C: meets intake criteria (${f} fit, ${v} value) without clearing the priority threshold.`;
    case "D":
      return `Band D: below intake threshold (${f} fit, ${v} value). Nurture track, no lawyer time committed.`;
    case "E":
      return `Band E: outside firm scope (${f} fit, ${v} value). Client redirected to an external resource.`;
  }
}

// ─────────────────────────────────────────────
// Strength / weakness selection
// ─────────────────────────────────────────────

interface RankedFactor extends ScoreFactor {
  ratio: number;
}

function rank(components: ScoreFactor[]): RankedFactor[] {
  return components
    .filter((c) => c.max > 0)
    .map((c) => ({ ...c, ratio: c.value / c.max }))
    .sort((a, b) => b.ratio - a.ratio);
}

function pickStrengths(ranked: RankedFactor[], limit = 2): ScoreFactor[] {
  return ranked
    .filter((c) => c.ratio >= 0.7)
    .slice(0, limit)
    .map(({ label, value, max }) => ({ label, value, max }));
}

function pickWeaknesses(ranked: RankedFactor[], limit = 2): ScoreFactor[] {
  return [...ranked]
    .reverse()
    .filter((c) => c.ratio <= 0.4)
    .slice(0, limit)
    .map(({ label, value, max }) => ({ label, value, max }));
}

// ─────────────────────────────────────────────
// Missing fields  ->  first-call questions
// ─────────────────────────────────────────────

/**
 * Reframes raw "missing field" labels from the scoring engine into
 * actionable first-call prompts. Labels that don't match fall back to
 * a generic "Ask about {label}" form so no missing field is dropped.
 */
const QUESTION_PROMPT: Record<string, string> = {
  "city or region":               "Confirm the city or region where the matter arose",
  "email address":                "Get a reliable email contact",
  "phone number":                 "Get a reliable phone contact",
  "description of the matter":    "Ask the client to describe the matter in their own words",
  "timeline or deadline":         "Confirm any deadlines, court dates, or statutory limits",
  "practice area":                "Clarify the legal area this falls under",
  "urgency level":                "Establish how urgent the matter is",
  "estimated case value":         "Estimate claim size or retainer range",
  "how they found the firm":      "Ask how the client found the firm",
  "compensation or claim range":  "Ask about the compensation or claim range",
  "case complexity details":      "Probe complexity factors (contestation, dependents, prior refusals, special flags)",
  "prior legal experience":       "Ask whether the client has had prior legal representation",
};

function buildCallQuestions(missing: string[] | null | undefined, limit = 3): string[] {
  if (!missing || missing.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of missing) {
    const prompt = QUESTION_PROMPT[raw] ?? `Ask about ${raw}`;
    if (seen.has(prompt)) continue;
    seen.add(prompt);
    out.push(prompt);
    if (out.length >= limit) break;
  }
  return out;
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

export function buildScoreRationale(input: ScoreRationaleInput): ScoreRationale {
  const band: RationaleBand = input.band ?? "E";
  const fitRatio = input.fit.max > 0 ? input.fit.value / input.fit.max : 0;
  const valRatio = input.val.max > 0 ? input.val.value / input.val.max : 0;
  const shape = classifyShape(fitRatio, valRatio);

  const bandLine = buildBandLine(band, shape, input.fit, input.val);
  const ranked = rank(input.components);

  return {
    bandLine,
    strengths: pickStrengths(ranked),
    weaknesses: pickWeaknesses(ranked),
    callQuestions: buildCallQuestions(input.missingFields),
    aiAngle: input.aiAngle ?? null,
  };
}
