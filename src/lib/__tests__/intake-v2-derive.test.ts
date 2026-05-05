import { describe, it, expect } from 'vitest';
import {
  computeDecisionDeadline,
  computeWhaleNurture,
  computeInitialStatus,
  clampAxis,
  TIMER_HOURS_DEFAULT,
  TIMER_HOURS_URGENCY_6,
  TIMER_HOURS_URGENCY_8,
  WHALE_VALUE_FLOOR,
  WHALE_READINESS_CEILING,
} from '../intake-v2-derive';

const REF = new Date('2026-05-05T12:00:00.000Z');
const HOUR_MS = 3600 * 1000;

describe('computeDecisionDeadline — urgency-tiered timer compression', () => {
  it('default 48 hours when urgency is below 6', () => {
    for (const u of [0, 1, 2, 3, 4, 5]) {
      const d = computeDecisionDeadline(u, REF);
      expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_DEFAULT * HOUR_MS);
    }
  });

  it('compresses to 24 hours at the urgency >= 6 boundary', () => {
    const d = computeDecisionDeadline(6, REF);
    expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_URGENCY_6 * HOUR_MS);
  });

  it('stays at 24 hours through urgency 7', () => {
    const d = computeDecisionDeadline(7, REF);
    expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_URGENCY_6 * HOUR_MS);
  });

  it('compresses to 12 hours at the urgency >= 8 boundary', () => {
    const d = computeDecisionDeadline(8, REF);
    expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_URGENCY_8 * HOUR_MS);
  });

  it('stays at 12 hours through urgency 10', () => {
    for (const u of [8, 9, 10]) {
      const d = computeDecisionDeadline(u, REF);
      expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_URGENCY_8 * HOUR_MS);
    }
  });

  it('preserves the constants pinned in CRM Bible v5 DR-003', () => {
    expect(TIMER_HOURS_DEFAULT).toBe(48);
    expect(TIMER_HOURS_URGENCY_6).toBe(24);
    expect(TIMER_HOURS_URGENCY_8).toBe(12);
  });
});

describe('computeWhaleNurture — value high, readiness low', () => {
  it('preserves the thresholds pinned in CRM Bible v5 DR-004', () => {
    expect(WHALE_VALUE_FLOOR).toBe(7);
    expect(WHALE_READINESS_CEILING).toBe(4);
  });

  it('triggers when value >= 7 AND readiness <= 4', () => {
    expect(computeWhaleNurture(7, 4)).toBe(true);
    expect(computeWhaleNurture(8, 0)).toBe(true);
    expect(computeWhaleNurture(10, 4)).toBe(true);
  });

  it('does not trigger when value is below the floor', () => {
    expect(computeWhaleNurture(6, 0)).toBe(false);
    expect(computeWhaleNurture(0, 0)).toBe(false);
  });

  it('does not trigger when readiness is above the ceiling', () => {
    expect(computeWhaleNurture(8, 5)).toBe(false);
    expect(computeWhaleNurture(10, 10)).toBe(false);
  });

  it('handles boundary case: value=7 AND readiness=4 inclusive', () => {
    expect(computeWhaleNurture(7, 4)).toBe(true);
  });

  it('handles boundary case: value=6 OR readiness=5 fails', () => {
    expect(computeWhaleNurture(6, 4)).toBe(false);
    expect(computeWhaleNurture(7, 5)).toBe(false);
  });
});

describe('computeInitialStatus — OOS auto-declines, in-scope triages', () => {
  it('marks out_of_scope as declined with system:oos signature', () => {
    const result = computeInitialStatus('out_of_scope');
    expect(result.status).toBe('declined');
    expect(result.changedBy).toBe('system:oos');
  });

  it('marks every in-scope matter as triaging with no signature', () => {
    const inScope = [
      'shareholder_dispute',
      'unpaid_invoice',
      'business_setup_advisory',
      'commercial_real_estate',
      'construction_lien',
      'corporate_general',
    ];
    for (const matter of inScope) {
      const result = computeInitialStatus(matter);
      expect(result.status).toBe('triaging');
      expect(result.changedBy).toBeNull();
    }
  });
});

describe('clampAxis — axis sanitisation', () => {
  it('clamps to 0-10 inclusive', () => {
    expect(clampAxis(-5)).toBe(0);
    expect(clampAxis(0)).toBe(0);
    expect(clampAxis(5)).toBe(5);
    expect(clampAxis(10)).toBe(10);
    expect(clampAxis(15)).toBe(10);
  });

  it('rounds to integer', () => {
    expect(clampAxis(3.4)).toBe(3);
    expect(clampAxis(3.6)).toBe(4);
  });

  it('returns null for non-finite inputs', () => {
    expect(clampAxis(NaN)).toBeNull();
    expect(clampAxis(Infinity)).toBeNull();
    expect(clampAxis(undefined)).toBeNull();
    expect(clampAxis(null)).toBeNull();
    expect(clampAxis('not a number')).toBeNull();
  });

  it('coerces numeric strings', () => {
    expect(clampAxis('7')).toBe(7);
    expect(clampAxis('3.5')).toBe(4);
  });
});
