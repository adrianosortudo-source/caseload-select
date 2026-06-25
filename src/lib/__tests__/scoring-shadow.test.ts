/**
 * Read-shadow / parity logic (C3 runbook section 6) over fixtures: matching rows,
 * drifted rows, pre-backfill null rows, each quarantine reason, the computed
 * distributions, and version anomalies. Pure; no DB.
 */
import { describe, it, expect } from 'vitest';
import { buildShadowReport, expectedColumnsFor, SHADOW_COLUMNS, type ShadowRow } from '@/lib/scoring-shadow';
import { computeScorePort } from '@/lib/scoring-port';
import { scorePortToColumns } from '@/lib/scoring-port-persistence';
import type { EngineState, MatterType, SlotMetaSource } from '@/lib/screen-engine/types';

const CRE = 'commercial_real_estate' as MatterType;
const ALL_CRE_SLOTS: Record<string, string> = {
  commercial_re_amount: '$2M–$10M',
  commercial_property_type: 'Land / development site',
  commercial_re_concerns: 'Title or zoning concern',
  commercial_re_stage: 'Closing date set',
  decision_authority: 'Just me',
  hiring_timeline: 'Now (this week)',
  other_counsel: 'No, you are the first',
};

function slotAnswers(slots: Record<string, string>, sources: Record<string, SlotMetaSource> = {}): unknown {
  const slot_meta: Record<string, { source: SlotMetaSource }> = {};
  for (const [id, source] of Object.entries(sources)) slot_meta[id] = { source };
  return { matter_type: CRE, slots, slot_meta, raw: {}, advisory_subtrack: 'unknown' };
}

/** A row whose persisted columns equal the freshly computed expected (a match). */
function populatedRow(id: string, slots: Record<string, string>): ShadowRow {
  const sa = slotAnswers(slots);
  const exp = scorePortToColumns(computeScorePort(sa as EngineState, 'B'));
  return {
    id,
    firm_id: 'firm-1',
    matter_type: CRE,
    band: 'B',
    slot_answers: sa,
    score_confidence: exp.score_confidence,
    score_completeness: exp.score_completeness,
    score_explanation: exp.score_explanation,
    score_missing_fields: exp.score_missing_fields,
    field_provenance: exp.field_provenance,
    score_version: exp.score_version,
    calibration_version: null,
  };
}

function emptyRow(id: string, slots: Record<string, string>): ShadowRow {
  return {
    id,
    firm_id: 'firm-1',
    matter_type: CRE,
    band: 'B',
    slot_answers: slotAnswers(slots),
    score_confidence: null,
    score_completeness: null,
    score_explanation: null,
    score_missing_fields: null,
    field_provenance: null,
    score_version: null,
    calibration_version: null,
  };
}

describe('buildShadowReport parity', () => {
  it('a matching populated row has no mismatches', () => {
    const r = buildShadowReport([populatedRow('m1', { commercial_re_amount: '$2M–$10M' })]);
    expect(r.scanned).toBe(1);
    expect(r.mismatches).toEqual([]);
    expect(r.columnPopulation.score_confidence.populated).toBe(1);
  });

  it('detects a drifted persisted field by row id and field', () => {
    const row = populatedRow('d1', { commercial_re_amount: '$2M–$10M' });
    row.score_confidence = row.score_confidence === 'high' ? 'low' : 'high'; // force drift
    const r = buildShadowReport([row]);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({ id: 'd1', field: 'score_confidence' });
  });

  it('treats pre-backfill null columns as not-populated, not drift', () => {
    const r = buildShadowReport([emptyRow('e1', { commercial_re_amount: '$2M–$10M' })]);
    expect(r.scanned).toBe(1);
    expect(r.mismatches).toEqual([]);
    expect(r.columnPopulation.score_confidence.nulls).toBe(1);
    expect(r.columnPopulation.score_confidence.populated).toBe(0);
  });
});

describe('buildShadowReport quarantine', () => {
  it('skips and categorizes each reason', () => {
    const base = emptyRow('base', { commercial_re_amount: '$2M–$10M' });
    const nullFirm: ShadowRow = { ...base, id: 'q-firm', firm_id: null };
    const oos: ShadowRow = { ...base, id: 'q-oos', matter_type: 'out_of_scope' as MatterType };
    const nullBand: ShadowRow = { ...base, id: 'q-band', band: null };
    const malformed: ShadowRow = { ...base, id: 'q-bad', slot_answers: null };

    const r = buildShadowReport([nullFirm, oos, nullBand, malformed]);
    expect(r.scanned).toBe(0);
    expect(r.skipped).toHaveLength(4);
    expect(r.skippedByReason).toEqual({
      null_firm_id: 1,
      out_of_scope: 1,
      null_band: 1,
      malformed_slot_answers: 1,
    });
  });

  it('expectedColumnsFor returns null for a malformed row', () => {
    const bad = { ...emptyRow('bad', {}), slot_answers: { not: 'a state' } };
    expect(expectedColumnsFor(bad)).toBeNull();
  });
});

describe('buildShadowReport distributions and anomalies', () => {
  it('computes confidence distribution and completeness stats over scannable rows', () => {
    const low = emptyRow('low', { commercial_re_amount: '$2M–$10M' }); // ~0.30 completeness => low
    const high = emptyRow('high', ALL_CRE_SLOTS); // 1.0 completeness => high
    const r = buildShadowReport([low, high]);
    expect(r.scanned).toBe(2);
    expect(r.confidenceDistribution).toEqual({ high: 1, medium: 0, low: 1 });
    expect(r.completeness).toEqual({ min: 0.3, max: 1, avg: 0.65 });
    // missing-field histogram entries sum to the scanned count
    const histSum = Object.values(r.missingFieldDistribution).reduce((a, b) => a + b, 0);
    expect(histSum).toBe(2);
  });

  it('flags rows whose score_version or calibration_version is unexpected', () => {
    const anomaly = { ...emptyRow('v1', { commercial_re_amount: '$2M–$10M' }), calibration_version: 5 };
    const r = buildShadowReport([anomaly]);
    expect(r.versionAnomalies).toHaveLength(1);
    expect(r.versionAnomalies[0]).toMatchObject({ id: 'v1', calibration_version: 5 });
  });

  it('covers every scoring-delta column in the population map', () => {
    const r = buildShadowReport([emptyRow('p', { commercial_re_amount: '$2M–$10M' })]);
    for (const col of SHADOW_COLUMNS) expect(r.columnPopulation[col]).toBeDefined();
  });
});
