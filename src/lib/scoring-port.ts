/**
 * Scoring port (SCORING-ENGINE-SPEC-v1 C1-C3): confidence, explanation, and
 * missing-fields for the canonical four-axis system. A PORT of the legacy
 * scoring.ts algorithms (computeConfidence / buildExplanation / detectMissingFields)
 * onto the Screen 2.0 four-axis output, computed over the H1 axis-input manifest
 * (NOT the legacy flat SCORABLE_FIELDS, which is the H1 bug).
 *
 * Pure + lib/-resident, same boundary as the H1 manifest: it reads the engine
 * (scoreFourAxes, slot provenance) as source of truth but is consumed by the
 * CRM scoring layer, not executed by the engine. No schema, no prod touch.
 *
 * SCOPE of this pass (parallel-safe):
 *   C1 confidence/completeness  - computeScoreConfidence
 *   C2 explanation              - buildScoreExplanation (signed factors + Einstein restraint)
 *   C3 missing-fields           - missingSlotsForMatter (delivered by H1; re-exported)
 *   8.2 confirmed vs inferred   - fieldProvenance
 *   7  route by confidence      - requiresHumanReviewBeforeAuto
 *
 * GATED / NOT here: persisting the Section 5 columns onto screened_leads
 * (client-facing schema, behind the C3 dual-run runbook), wiring into the
 * intake path / brief, the C4 re-score loop, and C5 recalibration. The
 * independent per-field LLM trust pass (spec 8.1) is a future refinement; this
 * pass uses a flat inferred-provenance discount (INFERRED_TRUST).
 */
import { scoreFourAxes } from '@/lib/screen-engine/band';
import { extractRawSignals } from '@/lib/screen-engine/extractor';
import type { EngineState, FourAxisScores, Band } from '@/lib/screen-engine/types';
import {
  AXIS_INPUT_MANIFEST,
  missingSlotsForMatter,
  type Axis,
  type SlotRef,
} from '@/lib/scoring-axis-manifest';

export type ScoreConfidence = 'high' | 'medium' | 'low';
export type FieldProvenance = 'confirmed' | 'inferred' | 'unknown';

// C3 missing-fields is exactly H1's unanswered-manifest-slots list.
export { missingSlotsForMatter } from '@/lib/scoring-axis-manifest';

/**
 * Mirror of the four-axis weights in band.ts (bandFromAxes). band.ts is the
 * source of truth for the band itself; these weight slot completeness and rank
 * the explanation's factors. Maxes: value 20, urgency 15, readiness 8, drag 4.
 */
const AXIS_WEIGHT: Record<Axis, number> = { value: 2.0, urgency: 1.5, readiness: 0.8, complexity: 0.4 };
const AXIS_MAX: Record<Axis, number> = { value: 20, urgency: 15, readiness: 8, complexity: 4 };

/**
 * Provenance trust: deterministic capture (the lead typed or confirmed it) is
 * trusted at 1.0; an LLM-inferred fill is discounted. The independent per-field
 * trust pass (spec 8.1) would replace this flat factor with a calibrated score.
 */
const INFERRED_TRUST = 0.6;

function isPopulated(value: string | null | undefined): value is string {
  return value != null && value.trim() !== '';
}

function isInferred(state: EngineState, slotId: string): boolean {
  return state.slot_meta?.[slotId]?.source === 'llm_inferred';
}

/** Scoring (axis) slot ids for a matter type, each weighted by its top axis. */
function axisSlotWeights(matterType: EngineState['matter_type']): Map<string, number> {
  const weights = new Map<string, number>();
  const entry = AXIS_INPUT_MANIFEST[matterType];
  if (!entry) return weights;
  (['value', 'complexity', 'urgency', 'readiness'] as Axis[]).forEach((axis) => {
    for (const ref of entry[axis]) {
      weights.set(ref.slotId, Math.max(weights.get(ref.slotId) ?? 0, AXIS_WEIGHT[axis]));
    }
  });
  return weights;
}

// ── C1: confidence keyed to completeness ────────────────────────────────────

export interface ScoreConfidenceResult {
  confidence: ScoreConfidence;
  /** weighted completeness ratio, 0..1, rounded to 2dp */
  completeness: number;
  /** count of unanswered scoring (axis) slots; drives the explanation note */
  scoringGaps: number;
}

/**
 * Completeness-keyed confidence over the matter's axis slots, weighted by axis
 * contribution and discounted for inferred fills. Contact slots are the gate
 * (handled elsewhere) and are excluded: confidence is about scoring accuracy.
 * Thresholds match the legacy port: >= 0.75 high, >= 0.45 medium, else low.
 */
export function computeScoreConfidence(state: EngineState): ScoreConfidenceResult {
  const weights = axisSlotWeights(state.matter_type);
  let total = 0;
  let earned = 0;
  let gaps = 0;
  for (const [slotId, weight] of weights) {
    total += weight;
    if (isPopulated(state.slots[slotId])) {
      earned += weight * (isInferred(state, slotId) ? INFERRED_TRUST : 1);
    } else {
      gaps += 1;
    }
  }
  const completeness = total > 0 ? earned / total : 0;
  const confidence: ScoreConfidence =
    completeness >= 0.75 ? 'high' : completeness >= 0.45 ? 'medium' : 'low';
  return { confidence, completeness: Math.round(completeness * 100) / 100, scoringGaps: gaps };
}

// ── 8.2: confirmed vs inferred provenance ────────────────────────────────────

/** Per axis-slot provenance marker for the brief (machine-extracted vs confirmed). */
export function fieldProvenance(state: EngineState): Record<string, FieldProvenance> {
  const out: Record<string, FieldProvenance> = {};
  for (const slotId of axisSlotWeights(state.matter_type).keys()) {
    if (!isPopulated(state.slots[slotId])) out[slotId] = 'unknown';
    else out[slotId] = isInferred(state, slotId) ? 'inferred' : 'confirmed';
  }
  return out;
}

// ── C2: "why this score" explanation (signed factors + Einstein restraint) ──

export interface ExplanationContext {
  confidence: ScoreConfidence;
  /** unanswered scoring slots (from computeScoreConfidence.scoringGaps) */
  scoringGaps: number;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Two-to-three sentence top-line. The four-axis weights give signed factor
 * contributions, so no SHAP is needed (spec 8.4). Einstein restraint: when no
 * factor dominates, say "scored evenly" rather than fabricate a thin reason.
 */
export function buildScoreExplanation(scores: FourAxisScores, ctx: ExplanationContext): string {
  const lifts = [
    { label: 'value', ratio: (scores.value * AXIS_WEIGHT.value) / AXIS_MAX.value },
    { label: 'urgency', ratio: (scores.urgency * AXIS_WEIGHT.urgency) / AXIS_MAX.urgency },
    ...(scores.readinessAnswered
      ? [{ label: 'readiness', ratio: (scores.readiness * AXIS_WEIGHT.readiness) / AXIS_MAX.readiness }]
      : []),
  ].sort((a, b) => b.ratio - a.ratio);
  const dragRatio = (scores.complexity * AXIS_WEIGHT.complexity) / AXIS_MAX.complexity;

  const parts: string[] = [];
  const top = lifts[0];
  const dominates =
    !!top && top.ratio >= 0.7 && (lifts.length < 2 || top.ratio - lifts[1].ratio >= 0.2);
  const moderate = lifts.filter((f) => f.ratio >= 0.4);

  if (dominates) {
    parts.push(`${cap(top.label)} is the dominant scoring factor.`);
  } else if (moderate.length > 0) {
    parts.push(`Scored on ${moderate.map((f) => f.label).join(', ')}.`);
  } else {
    parts.push('Scored evenly across the axes; no single factor dominates.');
  }

  if (dragRatio >= 0.5) {
    parts.push('Low simplicity drags the weighted score down.');
  }

  if (ctx.confidence === 'low' && ctx.scoringGaps > 0) {
    parts.push(
      `Confidence is low: ${ctx.scoringGaps} scoring input${ctx.scoringGaps === 1 ? '' : 's'} not yet provided. Collecting them could move the band.`,
    );
  } else if (ctx.confidence === 'medium' && ctx.scoringGaps > 0) {
    parts.push('Confidence is moderate; a few scoring inputs are still open.');
  }

  return parts.join(' ');
}

// ── 7: route by confidence (gates automation, not just display) ─────────────

/** A low-confidence Band A needs a human nudge before the auto kickoff cadence. */
export function requiresHumanReviewBeforeAuto(band: Band, confidence: ScoreConfidence): boolean {
  return band === 'A' && confidence === 'low';
}

// ── bundle: the computed score-port object (persisted once schema lands) ────

export interface ScorePort {
  confidence: ScoreConfidence;
  completeness: number;
  missing_fields: SlotRef[];
  explanation: string;
  field_provenance: Record<string, FieldProvenance>;
  requires_human_review: boolean;
}

/**
 * Rehydrate the scored EngineState from a stored screened_leads row. The
 * persisted `slot_answers` is a PARTIAL serialized state: it carries
 * slots / slot_meta / advisory_subtrack / dispute_family / etc., but NOT
 * `matter_type` (which lives in its own column). Pass the column value back in,
 * or the whole port keys off an undefined matter_type, axisSlotWeights returns
 * an empty map, and completeness collapses to 0 for every row.
 *
 * `raw` is intentionally left as-is here; computeScorePort defaults a missing
 * `raw` to the all-false RawSignals.
 */
export function rehydrateScoredState(slotAnswers: unknown, matterType: string): EngineState {
  return { ...(slotAnswers as Record<string, unknown>), matter_type: matterType } as unknown as EngineState;
}

/**
 * Compute the full C1-C3 + 8.2 + 7 bundle for a four-axis-scored lead. `band`
 * comes from computeBand (the caller already has it). This is the shape the
 * Section 5 columns will persist once the dual-run schema lands (gated by C3).
 *
 * Callers building `state` from a screened_leads row MUST run it through
 * rehydrateScoredState first so matter_type is present.
 */
export function computeScorePort(state: EngineState, band: Band): ScorePort {
  // Serialized/historical states may omit `raw` (the extracted mention-flags
  // container): in the live data 31 of 44 rows had no `raw` because no flags were
  // serialized. scoreUrgency and friends read `state.raw.mentions_*`, so a missing
  // `raw` crashes them. A missing `raw` means "no mentions", so default it to {}
  // (the honest neutral: no flags read, no bump added) rather than throw. In the
  // live intake path `raw` is always present, so this is a no-op there.
  //
  // `slots` / `slot_meta` are deliberately NOT defaulted. A state missing those is
  // genuinely degenerate (no answers at all) and must surface as malformed
  // upstream, not be silently scored as an empty intake.
  // extractRawSignals('') is the canonical all-false RawSignals (empty input
  // mentions nothing): type-correct and semantically exact for "no mentions".
  const safeState: EngineState = state.raw ? state : { ...state, raw: extractRawSignals('') };
  const { confidence, completeness, scoringGaps } = computeScoreConfidence(safeState);
  const scores: FourAxisScores = scoreFourAxes(safeState);
  return {
    confidence,
    completeness,
    missing_fields: missingSlotsForMatter(safeState),
    explanation: buildScoreExplanation(scores, { confidence, scoringGaps }),
    field_provenance: fieldProvenance(safeState),
    requires_human_review: requiresHumanReviewBeforeAuto(band, confidence),
  };
}
