/**
 * Read-shadow / parity for the screened_leads scoring-delta columns (C3 dual-run
 * runbook section 6). Pure: given the live rows (each row's slot_answers, band,
 * and persisted scoring-delta columns), it recomputes the expected columns via
 * computeScorePort + scorePortToColumns and reports drift, coverage, and the
 * computed distributions. No DB access, no writes.
 *
 * This is the evidence layer that must be green before any surface reads the new
 * columns. The script scripts/read-shadow-scoring-delta.ts wires it to prod and
 * prints; this module is what the fixture tests exercise.
 *
 * Pre-backfill the persisted columns are all null: that yields zero mismatches
 * (a null persisted field is "not yet populated", not a drift), full null counts
 * in columnPopulation, and the distributions still computed from the fresh port.
 */
import { computeScorePort } from '@/lib/scoring-port';
import { scorePortToColumns, type ScoringDeltaColumns } from '@/lib/scoring-port-persistence';
import type { EngineState, Band } from '@/lib/screen-engine/types';

export type ShadowSkipReason = 'null_firm_id' | 'out_of_scope' | 'null_band' | 'malformed_slot_answers';

export const SHADOW_COLUMNS = [
  'score_confidence',
  'score_completeness',
  'score_explanation',
  'score_missing_fields',
  'field_provenance',
  'score_version',
  'calibration_version',
] as const;
export type ShadowColumn = (typeof SHADOW_COLUMNS)[number];

/** The live DB row shape the parity pass reads (selected columns). */
export interface ShadowRow {
  id: string;
  firm_id: string | null;
  matter_type: string;
  band: string | null;
  slot_answers: unknown;
  score_confidence: string | null;
  score_completeness: number | string | null;
  score_explanation: string | null;
  score_missing_fields: unknown;
  field_provenance: unknown;
  score_version: number | null;
  calibration_version: number | null;
}

export interface ShadowMismatch {
  id: string;
  field: ShadowColumn;
  persisted: unknown;
  expected: unknown;
}

export interface ShadowReport {
  totalRows: number;
  scanned: number;
  skipped: { id: string; reason: ShadowSkipReason }[];
  skippedByReason: Record<ShadowSkipReason, number>;
  columnPopulation: Record<ShadowColumn, { populated: number; nulls: number }>;
  mismatches: ShadowMismatch[];
  confidenceDistribution: Record<'high' | 'medium' | 'low', number>;
  completeness: { min: number; max: number; avg: number } | null;
  missingFieldDistribution: Record<number, number>;
  versionAnomalies: { id: string; score_version: number | null; calibration_version: number | null }[];
}

const SKIP_MATTER_TYPES = new Set(['out_of_scope', 'unknown']);

/** Recursively key-sorted JSON, so jsonb columns compare by value not by order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

function isUsableState(slotAnswers: unknown): slotAnswers is EngineState {
  if (!slotAnswers || typeof slotAnswers !== 'object') return false;
  const slots = (slotAnswers as { slots?: unknown }).slots;
  return !!slots && typeof slots === 'object';
}

/** Classify a row as scannable (with a usable EngineState) or skipped with a reason. */
function classify(row: ShadowRow): { ok: true; state: EngineState } | { ok: false; reason: ShadowSkipReason } {
  if (!row.firm_id) return { ok: false, reason: 'null_firm_id' };
  if (SKIP_MATTER_TYPES.has(row.matter_type)) return { ok: false, reason: 'out_of_scope' };
  if (!row.band) return { ok: false, reason: 'null_band' };
  if (!isUsableState(row.slot_answers)) return { ok: false, reason: 'malformed_slot_answers' };
  return { ok: true, state: row.slot_answers };
}

/** Expected scoring-delta columns for a scannable row, or null if the port throws. */
export function expectedColumnsFor(row: ShadowRow): ScoringDeltaColumns | null {
  const c = classify(row);
  if (!c.ok) return null;
  try {
    return scorePortToColumns(computeScorePort(c.state, row.band as Band));
  } catch {
    return null;
  }
}

function isPopulated(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Compare a row's populated persisted columns against the freshly computed ones. */
function diffRow(row: ShadowRow, expected: ScoringDeltaColumns): ShadowMismatch[] {
  const out: ShadowMismatch[] = [];
  const push = (field: ShadowColumn, persisted: unknown, exp: unknown) =>
    out.push({ id: row.id, field, persisted, expected: exp });

  if (isPopulated(row.score_confidence) && row.score_confidence !== expected.score_confidence) {
    push('score_confidence', row.score_confidence, expected.score_confidence);
  }
  if (isPopulated(row.score_completeness)) {
    const persisted = Number(row.score_completeness);
    if (Math.abs(persisted - expected.score_completeness) > 1e-9) {
      push('score_completeness', persisted, expected.score_completeness);
    }
  }
  if (isPopulated(row.score_explanation) && row.score_explanation !== expected.score_explanation) {
    push('score_explanation', row.score_explanation, expected.score_explanation);
  }
  if (isPopulated(row.score_missing_fields) && stable(row.score_missing_fields) !== stable(expected.score_missing_fields)) {
    push('score_missing_fields', row.score_missing_fields, expected.score_missing_fields);
  }
  if (isPopulated(row.field_provenance) && stable(row.field_provenance) !== stable(expected.field_provenance)) {
    push('field_provenance', row.field_provenance, expected.field_provenance);
  }
  if (isPopulated(row.score_version) && row.score_version !== expected.score_version) {
    push('score_version', row.score_version, expected.score_version);
  }
  return out;
}

export function buildShadowReport(rows: ShadowRow[]): ShadowReport {
  const skipped: { id: string; reason: ShadowSkipReason }[] = [];
  const skippedByReason: Record<ShadowSkipReason, number> = {
    null_firm_id: 0,
    out_of_scope: 0,
    null_band: 0,
    malformed_slot_answers: 0,
  };
  const mismatches: ShadowMismatch[] = [];
  const confidenceDistribution: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 0, low: 0 };
  const missingFieldDistribution: Record<number, number> = {};
  const completenessValues: number[] = [];
  const versionAnomalies: { id: string; score_version: number | null; calibration_version: number | null }[] = [];

  const columnPopulation = Object.fromEntries(
    SHADOW_COLUMNS.map((c) => [c, { populated: 0, nulls: 0 }]),
  ) as Record<ShadowColumn, { populated: number; nulls: number }>;

  let scanned = 0;

  for (const row of rows) {
    // Column population + version anomalies are over ALL rows (the raw live state).
    for (const col of SHADOW_COLUMNS) {
      if (isPopulated(row[col])) columnPopulation[col].populated += 1;
      else columnPopulation[col].nulls += 1;
    }
    // score_version must be null or 1; calibration_version must be null (C5 reserved).
    if ((row.score_version !== null && row.score_version !== 1) || row.calibration_version !== null) {
      versionAnomalies.push({
        id: row.id,
        score_version: row.score_version,
        calibration_version: row.calibration_version,
      });
    }

    const c = classify(row);
    if (!c.ok) {
      skipped.push({ id: row.id, reason: c.reason });
      skippedByReason[c.reason] += 1;
      continue;
    }

    let expected: ScoringDeltaColumns;
    try {
      expected = scorePortToColumns(computeScorePort(c.state, row.band as Band));
    } catch {
      skipped.push({ id: row.id, reason: 'malformed_slot_answers' });
      skippedByReason.malformed_slot_answers += 1;
      continue;
    }

    scanned += 1;
    mismatches.push(...diffRow(row, expected));

    confidenceDistribution[expected.score_confidence] += 1;
    completenessValues.push(expected.score_completeness);
    const m = expected.score_missing_fields.length;
    missingFieldDistribution[m] = (missingFieldDistribution[m] ?? 0) + 1;
  }

  const completeness = completenessValues.length
    ? {
        min: Math.min(...completenessValues),
        max: Math.max(...completenessValues),
        avg: Math.round((completenessValues.reduce((a, b) => a + b, 0) / completenessValues.length) * 1000) / 1000,
      }
    : null;

  return {
    totalRows: rows.length,
    scanned,
    skipped,
    skippedByReason,
    columnPopulation,
    mismatches,
    confidenceDistribution,
    completeness,
    missingFieldDistribution,
    versionAnomalies,
  };
}
