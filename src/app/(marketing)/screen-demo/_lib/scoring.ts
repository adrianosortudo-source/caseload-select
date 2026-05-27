/**
 * Screen Demo Scoring Engine
 *
 * Pure functions, no I/O, no React. Takes selected answer IDs across the
 * five questions and computes:
 *
 *   - Fit Score   (0-30):  geo + contactability + legitimacy
 *   - Value Score (0-70):  complexity + urgency + strategic + fee
 *   - CPI Total   (0-100): Fit + Value
 *   - Band:                A (>=90) / B (>=75) / C (>=60) / D (>=45) / E (<45)
 *
 * Plus a deterministic narrative: strongest factor, weakest factor, and a
 * one-line action recommendation calibrated to the band.
 *
 * Deltas come from the question option `delta` shape. Each axis is clamped
 * to its declared maximum so a single question cannot saturate an axis on
 * its own (no axis can exceed its v2.1 cap).
 *
 * The marketing-demo CPI deliberately uses simplified axis ranges that
 * collapse to the same banding model as the production engine. Drift in the
 * underlying math is acceptable; drift in the band thresholds is not.
 */

import type { PracticeArea, ScoreDelta } from "../_data/questions";
import { SCREEN_DEMO_QUESTIONS } from "../_data/questions";

export type Band = "A" | "B" | "C" | "D" | "E";

export interface AxisScores {
  geo: number;            // 0-10
  contactability: number; // 0-10
  legitimacy: number;     // 0-10
  complexity: number;     // 0-25
  urgency: number;        // 0-20
  strategic: number;      // 0-15
  fee: number;            // 0-10
}

export const AXIS_MAX: AxisScores = {
  geo: 10,
  contactability: 10,
  legitimacy: 10,
  complexity: 25,
  urgency: 20,
  strategic: 15,
  fee: 10,
};

export interface ScreenScore {
  axis: AxisScores;
  fitScore: number;        // 0-30
  valueScore: number;      // 0-70
  cpi: number;             // 0-100
  band: Band;
  practiceArea: PracticeArea;
  strongestFactor: keyof AxisScores;
  weakestFactor: keyof AxisScores;
  narrative: string;
  recommendedAction: string;
  recommendedSequence: string;
  responseWindow: string;
}

/** Resolved answer for one question: questionId -> selected option id(s) */
export type Answers = Record<string, string | string[]>;

function clamp(value: number, max: number): number {
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

function applyDelta(axis: AxisScores, delta: ScoreDelta): void {
  (Object.keys(delta) as (keyof ScoreDelta)[]).forEach((key) => {
    const value = delta[key];
    if (typeof value === "number") axis[key] += value;
  });
}

/**
 * Resolve answers into the AxisScores by walking every question, finding the
 * selected option(s), and applying their deltas to the axis totals.
 */
export function computeScore(answers: Answers): ScreenScore {
  const axis: AxisScores = {
    geo: 0, contactability: 0, legitimacy: 0,
    complexity: 0, urgency: 0, strategic: 0, fee: 0,
  };

  // Q1 sets practice area; default to "other" if missing.
  const practiceAreaId = (answers["practice_area"] as string) ?? "other";

  // Walk every question and apply deltas
  for (const question of SCREEN_DEMO_QUESTIONS) {
    const selected = answers[question.id];
    if (!selected) continue;
    const selectedIds = Array.isArray(selected) ? selected : [selected];
    for (const optId of selectedIds) {
      const opt = question.options.find((o) => o.id === optId);
      if (opt) applyDelta(axis, opt.delta);
    }
  }

  // Clamp each axis to its max
  (Object.keys(AXIS_MAX) as (keyof AxisScores)[]).forEach((key) => {
    axis[key] = clamp(axis[key], AXIS_MAX[key]);
  });

  const fitScore = axis.geo + axis.contactability + axis.legitimacy;
  const valueScore = axis.complexity + axis.urgency + axis.strategic + axis.fee;
  const cpi = fitScore + valueScore;

  const band: Band =
    cpi >= 90 ? "A" :
    cpi >= 75 ? "B" :
    cpi >= 60 ? "C" :
    cpi >= 45 ? "D" : "E";

  // Find strongest and weakest factor (by % of axis max)
  const ratios = (Object.keys(AXIS_MAX) as (keyof AxisScores)[]).map((key) => ({
    key,
    ratio: axis[key] / AXIS_MAX[key],
  }));
  ratios.sort((a, b) => b.ratio - a.ratio);
  const strongestFactor = ratios[0].key;
  const weakestFactor = ratios[ratios.length - 1].key;

  return {
    axis,
    fitScore,
    valueScore,
    cpi,
    band,
    practiceArea: practiceAreaId as PracticeArea,
    strongestFactor,
    weakestFactor,
    narrative: buildNarrative(band, practiceAreaId as PracticeArea, axis, strongestFactor, weakestFactor),
    recommendedAction: recommendedActionFor(band),
    recommendedSequence: recommendedSequenceFor(band),
    responseWindow: responseWindowFor(band),
  };
}

/* ──────────────────────────────────────────────────────────────────
 *  Narrative builders — deterministic strings, no AI generation
 * ────────────────────────────────────────────────────────────────── */

const FACTOR_LABELS: Record<keyof AxisScores, string> = {
  geo: "jurisdiction fit",
  contactability: "contactability",
  legitimacy: "intent signals",
  complexity: "matter complexity",
  urgency: "time sensitivity",
  strategic: "strategic value",
  fee: "fee fit",
};

const PRACTICE_LABELS: Record<PracticeArea, string> = {
  criminal_defense: "criminal defense",
  immigration: "immigration",
  real_estate: "real estate transaction",
  family: "family law",
  employment: "employment",
  estates: "estates and probate",
  personal_injury: "personal injury",
  corporate: "corporate and commercial",
  other: "general",
};

/** Pick "a" or "an" based on whether the following word starts with a vowel sound. */
function indefiniteArticle(word: string): "a" | "an" {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function buildNarrative(
  band: Band,
  practice: PracticeArea,
  _axis: AxisScores,
  strongest: keyof AxisScores,
  weakest: keyof AxisScores,
): string {
  const practiceLabel = PRACTICE_LABELS[practice];
  const article = indefiniteArticle(practiceLabel);
  const strongestLabel = FACTOR_LABELS[strongest];
  const weakestLabel = FACTOR_LABELS[weakest];

  switch (band) {
    case "A":
      return `Band A inquiry. ${article.charAt(0).toUpperCase() + article.slice(1)} ${practiceLabel} matter with strong ${strongestLabel} and clear buying intent. This is the case your partner should call back inside the hour. The Screen flags weak ${weakestLabel} as the one factor worth probing on the first call.`;
    case "B":
      return `Band B inquiry. ${article.charAt(0).toUpperCase() + article.slice(1)} ${practiceLabel} matter that fits the firm on most axes, with ${strongestLabel} as the strongest signal. Worth a standard follow-up cadence. Weak ${weakestLabel} should be clarified before the consultation is scheduled.`;
    case "C":
      return `Band C inquiry. ${article.charAt(0).toUpperCase() + article.slice(1)} ${practiceLabel} matter sitting in the middle of the queue. Decent ${strongestLabel} but weak ${weakestLabel}. Worth a look when the calendar opens, not before the Band A and B leads have been worked.`;
    case "D":
      return `Band D inquiry. ${article.charAt(0).toUpperCase() + article.slice(1)} ${practiceLabel} matter that is refer-eligible. ${strongestLabel.charAt(0).toUpperCase() + strongestLabel.slice(1)} is present but weak ${weakestLabel} pulls the case below the firm's threshold. The Screen surfaces Refer or Pass as the primary affordances.`;
    case "E":
      return `Band E inquiry. ${article.charAt(0).toUpperCase() + article.slice(1)} ${practiceLabel} matter that scored below the firm's qualification floor. Weak ${weakestLabel} dominates. The Screen would auto-decline this with a polite holding response; your partner never reads the brief.`;
  }
}

function recommendedActionFor(band: Band): string {
  switch (band) {
    case "A": return "Immediate callback. Within 60 minutes during business hours, before noon next business day overnight.";
    case "B": return "Standard follow-up cadence. Within 4 business hours.";
    case "C": return "Ranked queue. Reviewed after Band A and B inquiries cleared.";
    case "D": return "Refer-eligible. Surface Refer / Take / Pass to the lawyer with a 96-hour window.";
    case "E": return "Auto-decline with a polite holding response. Lawyer not notified.";
  }
}

function recommendedSequenceFor(band: Band): string {
  switch (band) {
    case "A": return "J1 New Lead Response (immediate) + J4 Persistence Engine if no booking inside 48h.";
    case "B": return "J1 New Lead Response (standard cadence) + J4 Persistence Engine.";
    case "C": return "J4 Persistence Engine only. No high-priority callback.";
    case "D": return "Decline-with-grace cadence with a referral suggestion to a fit-appropriate firm.";
    case "E": return "Auto-decline template. No further sequences.";
  }
}

function responseWindowFor(band: Band): string {
  switch (band) {
    case "A": return "Inside 1 hour";
    case "B": return "Inside 4 business hours";
    case "C": return "Inside 1 business day";
    case "D": return "Inside 96 hours";
    case "E": return "Auto-handled, no lawyer time";
  }
}

/* ──────────────────────────────────────────────────────────────────
 *  Band colours — matches the brand book priority bands palette
 * ────────────────────────────────────────────────────────────────── */

export const BAND_COLOR: Record<Band, string> = {
  A: "#2E7D5B",
  B: "#5A8A6E",
  C: "#B58D2E",
  D: "#C07A2E",
  E: "#9C5B5B",
};

export const BAND_LABEL: Record<Band, string> = {
  A: "Priority",
  B: "Qualified",
  C: "Review",
  D: "Refer-eligible",
  E: "Auto-decline",
};

// Production CPI thresholds (v2.1): A >= 90, B >= 75, C >= 60, D >= 45, E < 45
export const BAND_RANGE: Record<Band, string> = {
  A: "90 – 100",
  B: "75 – 89",
  C: "60 – 74",
  D: "45 – 59",
  E: "0 – 44",
};
