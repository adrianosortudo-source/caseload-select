/**
 * Scoring-port read-flag helpers (C3 brief/intake wiring).
 *
 * Write path: `buildScoringDeltaForInsert` is called at every screened_leads
 * insert, regardless of any flag. Its return value (null on failure) is spread
 * into the insert payload so new rows always carry the scoring-delta columns.
 *
 * Read path: `getScoringPortForRead` gates on `intake_firms.read_scoring_port`.
 * When false (default), it returns null; the caller falls back to legacy
 * brief_html display only. When true, it logs any drift via the shadow
 * comparator and returns the persisted columns.
 *
 * Rollback: setting read_scoring_port = false immediately restores legacy reads.
 * No code change required; no firm is enabled by default.
 */

import { computeScorePort, rehydrateScoredState } from '@/lib/scoring-port';
import { scorePortToColumns, type ScoringDeltaColumns } from '@/lib/scoring-port-persistence';
import type { Band } from '@/lib/screen-engine/types';

// Firm config

/** The subset of intake_firms needed for scoring-port read decisions. */
export interface FirmScoringConfig {
  read_scoring_port: boolean;
}

/** True when the firm has opted into reading persisted scoring-port columns. */
export function shouldUseScoringPortForFirm(config: FirmScoringConfig): boolean {
  return config.read_scoring_port === true;
}

// Write path

/**
 * Compute scoring-delta columns for a new screened_leads insert.
 *
 * Returns null when band is null, slot_answers is degenerate (no slots / slot_meta),
 * or any unexpected error in the scoring port. A null return signals that
 * these columns should be skipped at insert time.
 * Called on every insert regardless of the read flag.
 */
export function buildScoringDeltaForInsert(
  slotAnswers: unknown,
  matterType: string,
  band: string | null,
): ScoringDeltaColumns | null {
  if (!band) return null;
  try {
    const state = rehydrateScoredState(slotAnswers, matterType);
    return scorePortToColumns(computeScorePort(state, band as Band));
  } catch {
    return null;
  }
}

// Read path

/** The scoring-port subset surfaced to the lawyer UI when the flag is on. */
export interface ScoringPortReadResult {
  score_confidence: string | null;
  score_completeness: number | null;
  score_explanation: string | null;
  score_missing_fields: unknown;
  field_provenance: unknown;
  score_version: number | null;
}

/** Extract the scoring-port columns from a DB row. */
export function readScoringPort(row: {
  score_confidence?: string | null;
  score_completeness?: number | string | null;
  score_explanation?: string | null;
  score_missing_fields?: unknown;
  field_provenance?: unknown;
  score_version?: number | null;
}): ScoringPortReadResult {
  return {
    score_confidence: row.score_confidence ?? null,
    score_completeness:
      row.score_completeness !== null && row.score_completeness !== undefined
        ? Number(row.score_completeness)
        : null,
    score_explanation: row.score_explanation ?? null,
    score_missing_fields: row.score_missing_fields ?? null,
    field_provenance: row.field_provenance ?? null,
    score_version:
      row.score_version !== null && row.score_version !== undefined
        ? Number(row.score_version)
        : null,
  };
}

// Shadow comparator

/** Row shape needed for the shadow comparator. */
export interface ShadowComparatorRow {
  id?: string;
  matter_type: string;
  band: string | null;
  slot_answers: unknown;
  score_confidence?: string | null;
  score_completeness?: number | string | null;
  score_explanation?: string | null;
  score_missing_fields?: unknown;
  field_provenance?: unknown;
  score_version?: number | null;
}

/**
 * Log any drift between persisted scoring-delta columns and a fresh recompute.
 *
 * Never throws. Never mutates. Never exposes to the client. Designed for
 * console.warn so the logs surface in Vercel without affecting the response.
 * Only runs when values are populated (null persisted = pre-backfill, not drift).
 */
export function shadowCompareScoringPort(row: ShadowComparatorRow): void {
  if (!row.band) return;

  let expected: ScoringDeltaColumns;
  try {
    const state = rehydrateScoredState(row.slot_answers, row.matter_type);
    expected = scorePortToColumns(computeScorePort(state, row.band as Band));
  } catch {
    console.warn('[scoring-port-read] shadow: recompute failed', { id: row.id });
    return;
  }

  const drifts: string[] = [];

  if (
    row.score_confidence !== null &&
    row.score_confidence !== undefined &&
    row.score_confidence !== expected.score_confidence
  ) {
    drifts.push(
      `score_confidence: persisted=${row.score_confidence} expected=${expected.score_confidence}`,
    );
  }

  if (row.score_completeness !== null && row.score_completeness !== undefined) {
    const persisted = Number(row.score_completeness);
    if (Math.abs(persisted - expected.score_completeness) > 1e-9) {
      drifts.push(
        `score_completeness: persisted=${persisted} expected=${expected.score_completeness}`,
      );
    }
  }

  if (
    row.score_version !== null &&
    row.score_version !== undefined &&
    row.score_version !== expected.score_version
  ) {
    drifts.push(
      `score_version: persisted=${row.score_version} expected=${expected.score_version}`,
    );
  }

  if (
    row.score_explanation !== null &&
    row.score_explanation !== undefined &&
    row.score_explanation !== expected.score_explanation
  ) {
    drifts.push('score_explanation: drift');
  }

  if (drifts.length > 0) {
    console.warn('[scoring-port-read] shadow drift detected', { id: row.id, drifts });
  }
}

// Gated read

/**
 * Return persisted scoring-port columns when the firm flag is on, null otherwise.
 *
 * When flag is on: runs the shadow comparator (logs drift, never throws),
 * then returns the persisted columns for the caller to surface to the UI.
 *
 * When flag is off: returns null. The caller uses legacy brief_html only.
 * Setting read_scoring_port = false immediately restores legacy reads.
 */
export function getScoringPortForRead(
  row: ShadowComparatorRow,
  config: FirmScoringConfig,
): ScoringPortReadResult | null {
  if (!shouldUseScoringPortForFirm(config)) return null;
  shadowCompareScoringPort(row);
  return readScoringPort(row);
}
