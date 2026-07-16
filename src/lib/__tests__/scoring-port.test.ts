/**
 * Scoring port (C1-C3 + 8.2 + 7): confidence/completeness, provenance, the
 * signed-factor explanation with Einstein restraint, route-by-confidence, and
 * the bundled computeScorePort. Pure functions over a minimal EngineState.
 */
import { describe, it, expect } from 'vitest';
import {
  computeScoreConfidence,
  fieldProvenance,
  buildScoreExplanation,
  requiresHumanReviewBeforeAuto,
  computeScorePort,
  rehydrateScoredState,
} from '@/lib/scoring-port';
import type { EngineState, FourAxisScores, MatterType, SlotMetaSource } from '@/lib/screen-engine/types';

function makeState(
  matter_type: MatterType,
  slots: Record<string, string> = {},
  slotSources: Record<string, SlotMetaSource> = {},
): EngineState {
  const slot_meta: Record<string, { source: SlotMetaSource }> = {};
  for (const [id, source] of Object.entries(slotSources)) slot_meta[id] = { source };
  return { matter_type, slots, slot_meta, raw: {}, advisory_subtrack: 'unknown' } as unknown as EngineState;
}

function scores(p: Partial<FourAxisScores>): FourAxisScores {
  return { value: 0, complexity: 0, urgency: 0, readiness: 0, readinessAnswered: true, ...p };
}

// commercial_real_estate axis slots (from the H1 manifest):
//   value: commercial_re_amount (w 2.0)
//   complexity: commercial_property_type, commercial_re_concerns (w 0.4 each)
//   urgency: commercial_re_stage (w 1.5)
//   readiness: decision_authority, hiring_timeline, other_counsel (w 0.8 each)
// total weight = 6.7
const CRE = 'commercial_real_estate' as MatterType;

describe('computeScoreConfidence (C1)', () => {
  it('all axis slots populated reads as high', () => {
    const state = makeState(CRE, {
      commercial_re_amount: '$2M–$10M',
      commercial_property_type: 'Land / development site',
      commercial_re_concerns: 'Title or zoning concern',
      commercial_re_stage: 'Closing date set',
      decision_authority: 'Just me',
      hiring_timeline: 'Now (this week)',
      other_counsel: 'No, you are the first',
    });
    const r = computeScoreConfidence(state);
    expect(r.confidence).toBe('high');
    expect(r.completeness).toBe(1);
    expect(r.scoringGaps).toBe(0);
  });

  it('no axis slots populated reads as low with all gaps', () => {
    const r = computeScoreConfidence(makeState(CRE, {}));
    expect(r.confidence).toBe('low');
    expect(r.completeness).toBe(0);
    expect(r.scoringGaps).toBe(7);
  });

  it('partial high-weight fills read as medium', () => {
    // value 2.0 + urgency 1.5 + readiness 0.8 = 4.3 / 6.7 = 0.64
    const state = makeState(CRE, {
      commercial_re_amount: '$2M–$10M',
      commercial_re_stage: 'Closing date set',
      decision_authority: 'Just me',
    });
    const r = computeScoreConfidence(state);
    expect(r.confidence).toBe('medium');
    expect(r.completeness).toBeGreaterThanOrEqual(0.45);
    expect(r.completeness).toBeLessThan(0.75);
    expect(r.scoringGaps).toBe(4);
  });

  it('discounts an inferred fill vs a confirmed one', () => {
    const slots = { commercial_re_amount: '$2M–$10M' };
    const confirmed = computeScoreConfidence(makeState(CRE, slots, { commercial_re_amount: 'answered' }));
    const inferred = computeScoreConfidence(makeState(CRE, slots, { commercial_re_amount: 'llm_inferred' }));
    expect(inferred.completeness).toBeLessThan(confirmed.completeness);
  });

  it('treats whitespace-only answers as unanswered', () => {
    const r = computeScoreConfidence(makeState(CRE, { commercial_re_amount: '   ' }));
    expect(r.completeness).toBe(0);
    expect(r.scoringGaps).toBe(7);
  });
});

describe('fieldProvenance (8.2)', () => {
  it('marks confirmed, inferred, and unknown per axis slot', () => {
    const state = makeState(
      CRE,
      { commercial_re_amount: '$2M–$10M', commercial_re_stage: 'Closing date set' },
      { commercial_re_amount: 'answered', commercial_re_stage: 'llm_inferred' },
    );
    const prov = fieldProvenance(state);
    expect(prov.commercial_re_amount).toBe('confirmed');
    expect(prov.commercial_re_stage).toBe('inferred');
    expect(prov.commercial_property_type).toBe('unknown'); // not answered
  });
});

describe('buildScoreExplanation (C2 + 8.4)', () => {
  it('names the dominant factor when one axis leads', () => {
    const e = buildScoreExplanation(scores({ value: 9, urgency: 1, readiness: 2, complexity: 1 }), {
      confidence: 'high',
      scoringGaps: 0,
    });
    expect(e).toContain('Value is the dominant scoring factor.');
  });

  it('applies Einstein restraint when nothing dominates', () => {
    const e = buildScoreExplanation(scores({ value: 2, urgency: 2, readiness: 2, complexity: 1 }), {
      confidence: 'high',
      scoringGaps: 0,
    });
    expect(e).toContain('Scored evenly across the axes');
  });

  it('flags high complexity as a drag', () => {
    const e = buildScoreExplanation(scores({ value: 5, urgency: 2, readiness: 2, complexity: 8 }), {
      confidence: 'high',
      scoringGaps: 0,
    });
    expect(e).toContain('Low simplicity drags the weighted score down.');
  });

  it('adds the low-confidence note with the gap count', () => {
    const e = buildScoreExplanation(scores({ value: 9, urgency: 1, readiness: 2, complexity: 1 }), {
      confidence: 'low',
      scoringGaps: 5,
    });
    expect(e).toContain('Confidence is low: 5 scoring inputs not yet provided');
  });
});

describe('requiresHumanReviewBeforeAuto (7)', () => {
  it('flags a low-confidence Band A, not other combinations', () => {
    expect(requiresHumanReviewBeforeAuto('A', 'low')).toBe(true);
    expect(requiresHumanReviewBeforeAuto('A', 'high')).toBe(false);
    expect(requiresHumanReviewBeforeAuto('B', 'low')).toBe(false);
  });
});

describe('computeScorePort (bundle)', () => {
  it('bundles confidence, missing-fields (incl. contact), explanation, provenance, and routing', () => {
    const state = makeState(CRE, { commercial_re_amount: '$2M–$10M' }, { commercial_re_amount: 'answered' });
    const port = computeScorePort(state, 'A');

    expect(['high', 'medium', 'low']).toContain(port.confidence);
    expect(typeof port.completeness).toBe('number');
    expect(typeof port.explanation).toBe('string');
    expect(port.explanation.length).toBeGreaterThan(0);
    expect(port.field_provenance.commercial_re_amount).toBe('confirmed');

    // C3 missing-fields includes the universal contact slots that are unanswered.
    const missingIds = port.missing_fields.map((r) => r.slotId);
    expect(missingIds).toContain('client_email');
    expect(missingIds).not.toContain('commercial_re_amount'); // answered

    // Only one low-weight axis slot answered: low confidence + Band A => human review.
    expect(port.confidence).toBe('low');
    expect(port.requires_human_review).toBe(true);
  });
});

describe('computeScorePort tolerates serialized states missing raw (regression)', () => {
  // 31 of 44 live screened_leads rows had slot_answers with no `raw` (no
  // mention-flags serialized). scoreUrgency reads state.raw.mentions_*, so a
  // missing raw crashed the backfill mid-run. It must score, treating mentions
  // as absent.
  it('scores a state with no raw field instead of throwing', () => {
    const base = makeState(CRE, { commercial_re_amount: '$2M–$10M' }, { commercial_re_amount: 'answered' });
    const noRaw = { ...base } as Record<string, unknown>;
    delete noRaw.raw;
    const port = computeScorePort(noRaw as unknown as EngineState, 'B');
    expect(['high', 'medium', 'low']).toContain(port.confidence);
    expect(typeof port.completeness).toBe('number');
    expect(port.explanation.length).toBeGreaterThan(0);
    expect(port.field_provenance.commercial_re_amount).toBe('confirmed');
  });

  // The boundary is deliberate: a state with no slots at all is genuinely
  // degenerate and must surface as malformed upstream (the backfill and
  // read-shadow quarantine it), not be silently scored as an empty intake.
  it('still throws on a degenerate state with no slots / slot_meta', () => {
    const base = makeState(CRE, { commercial_re_amount: '$2M–$10M' });
    const degenerate = { ...base } as Record<string, unknown>;
    delete degenerate.slots;
    delete degenerate.slot_meta;
    expect(() => computeScorePort(degenerate as unknown as EngineState, 'B')).toThrow();
  });
});

describe('rehydrateScoredState: live slot_answers omits matter_type (regression)', () => {
  // Real screened_leads store matter_type as a column, NOT inside slot_answers
  // (0 of 44 live rows carried it). Without rehydration the port keys off an
  // undefined matter_type, axisSlotWeights returns an empty map, and completeness
  // collapses to 0 for fully-answered rows. This is the shape the dry-run hit.
  const liveSlotAnswers = {
    slots: {
      commercial_re_amount: 'Under $500,000',
      commercial_property_type: 'Retail / storefront',
      commercial_re_concerns: 'Reviewing the agreement',
      commercial_re_stage: 'Talking with the other side',
      decision_authority: 'Multiple owners or directors',
      hiring_timeline: 'Within the next 30 days',
      other_counsel: 'Yes, I am comparing options',
    },
    slot_meta: Object.fromEntries(
      [
        'commercial_re_amount', 'commercial_property_type', 'commercial_re_concerns',
        'commercial_re_stage', 'decision_authority', 'hiring_timeline', 'other_counsel',
      ].map((k) => [k, { source: 'answered' }]),
    ),
    advisory_subtrack: 'unknown',
    // deliberately NO matter_type and NO raw, matching the live row shape
  };

  it('without rehydration the port collapses to completeness 0 (the bug)', () => {
    const naive = computeScorePort(liveSlotAnswers as unknown as EngineState, 'B');
    expect(naive.completeness).toBe(0);
  });

  it('rehydrated with the column matter_type, the same row reads complete + high', () => {
    const state = rehydrateScoredState(liveSlotAnswers, CRE);
    const port = computeScorePort(state, 'B');
    expect(port.completeness).toBe(1);
    expect(port.confidence).toBe('high');
  });
});
