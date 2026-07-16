/**
 * Proves the Phase 1 backfill path end to end (the migration draft at
 * supabase/migrations-draft/20260625_screened_leads_scoring_delta.sql):
 *   slot_answers (serialized EngineState) + band -> computeScorePort ->
 *   scorePortToColumns -> the exact screened_leads scoring-delta column row.
 *
 * No DB access; persistence is gated by the C3 runbook. This is the "shape proof"
 * the migration draft references: the column row the backfill UPDATE would set.
 */
import { describe, it, expect } from 'vitest';
import { computeScorePort } from '@/lib/scoring-port';
import { scorePortToColumns } from '@/lib/scoring-port-persistence';
import type { EngineState, Band } from '@/lib/screen-engine/types';

// The 7 additive columns in the migration draft (calibration_version reserved).
const EXPECTED_COLUMNS = [
  'score_confidence',
  'score_completeness',
  'score_explanation',
  'score_missing_fields',
  'field_provenance',
  'score_version',
  'calibration_version',
].sort();

// slot_answers as stored on screened_leads IS the serialized EngineState.
const slotAnswers = {
  matter_type: 'commercial_real_estate',
  slots: {
    commercial_re_amount: '$2M–$10M',
    commercial_re_stage: 'Closing date set',
  },
  slot_meta: {
    commercial_re_amount: { source: 'answered' },     // deterministic -> confirmed
    commercial_re_stage: { source: 'llm_inferred' },  // inferred -> discounted
  },
  raw: {},
  advisory_subtrack: 'unknown',
};

describe('scoring-port backfill path: slot_answers -> computeScorePort -> columns', () => {
  const state = slotAnswers as unknown as EngineState;
  const band: Band = 'B';
  const cols = scorePortToColumns(computeScorePort(state, band));

  it('produces exactly the migration draft column set', () => {
    expect(Object.keys(cols).sort()).toEqual(EXPECTED_COLUMNS);
  });

  it('maps each column to the right type and bounds', () => {
    expect(['high', 'medium', 'low']).toContain(cols.score_confidence);
    expect(typeof cols.score_completeness).toBe('number');
    expect(cols.score_completeness).toBeGreaterThanOrEqual(0);
    expect(cols.score_completeness).toBeLessThanOrEqual(1);
    expect(typeof cols.score_explanation).toBe('string');
    expect(cols.score_explanation.length).toBeGreaterThan(0);
    expect(Array.isArray(cols.score_missing_fields)).toBe(true);
    expect(typeof cols.field_provenance).toBe('object');
    expect(cols.score_version).toBe(2); // CURRENT_SCORE_VERSION (DR-103 wording bump)
    expect(cols.calibration_version).toBeNull();
  });

  it('persists missing fields as snake_case { slot_id, label } (queryable jsonb)', () => {
    for (const f of cols.score_missing_fields) {
      expect(typeof f.slot_id).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(f).not.toHaveProperty('slotId');
    }
    // an unanswered scoring slot surfaces in the list
    expect(cols.score_missing_fields.map((f) => f.slot_id)).toContain('commercial_property_type');
  });

  it('carries provenance: confirmed for deterministic fills, inferred for llm fills', () => {
    expect(cols.field_provenance.commercial_re_amount).toBe('confirmed');
    expect(cols.field_provenance.commercial_re_stage).toBe('inferred');
  });
});
