/**
 * Projection of a computed ScorePort onto the screened_leads scoring-delta
 * columns (the Phase 1 expand-phase migration, drafted in
 * supabase/migrations-draft/20260625_screened_leads_scoring_delta.sql).
 *
 * This is the single place the column row shape is defined, so the backfill
 * script, the engine write path (once wired), and the brief renderer all agree.
 * Pure; no DB access. Persistence itself is gated by the C3 dual-run runbook.
 */
import type { ScorePort, FieldProvenance } from '@/lib/scoring-port';

/** A persisted missing-field uses snake_case slot_id (queryable as ->>'slot_id'). */
export interface PersistedMissingField {
  slot_id: string;
  label: string;
}

/** The exact screened_leads scoring-delta column values for one row. */
export interface ScoringDeltaColumns {
  score_confidence: ScorePort['confidence'];
  score_completeness: number;
  score_explanation: string;
  score_missing_fields: PersistedMissingField[];
  field_provenance: Record<string, FieldProvenance>;
  score_version: number;
  calibration_version: number | null;
}

/**
 * Score-version legend for `buildScoreExplanation`'s prose (scoring-port.ts).
 * Bump CURRENT_SCORE_VERSION whenever that prose changes in a way that would
 * make a freshly recomputed explanation disagree with what is already
 * persisted, and add the retired value to HISTORICAL_SCORE_VERSIONS so the
 * shadow comparators (scoring-shadow.ts, scoring-port-read.ts) stop treating
 * that expected disagreement as drift. DR-059 forbids retroactive recompute,
 * so historical rows keep their old version and wording forever.
 *   1 = pre-DR-103 wording ("High complexity drags the weighted score down.")
 *   2 = DR-103 wording ("Low simplicity drags the weighted score down."), current since 2026-07-16
 */
export const CURRENT_SCORE_VERSION = 2;
export const HISTORICAL_SCORE_VERSIONS: ReadonlySet<number> = new Set([1]);

/**
 * Map a ScorePort onto the column row the backfill (or the engine write) sets.
 * `slotId` becomes `slot_id` in the persisted jsonb, matching the spec Section 5
 * and the migration's column comment. `requires_human_review` is intentionally
 * NOT persisted: it is derived from band + score_confidence at routing time.
 */
export function scorePortToColumns(port: ScorePort, scoreVersion = CURRENT_SCORE_VERSION): ScoringDeltaColumns {
  return {
    score_confidence: port.confidence,
    score_completeness: port.completeness,
    score_explanation: port.explanation,
    score_missing_fields: port.missing_fields.map((r) => ({ slot_id: r.slotId, label: r.label })),
    field_provenance: port.field_provenance,
    score_version: scoreVersion,
    calibration_version: null, // reserved for C5 per-firm recalibration
  };
}
