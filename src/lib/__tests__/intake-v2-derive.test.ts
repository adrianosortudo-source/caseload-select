import { describe, it, expect } from 'vitest';
import {
  computeDecisionDeadline,
  computeWhaleNurture,
  computeInitialStatus,
  clampAxis,
  TIMER_HOURS_DEFAULT,
  TIMER_HOURS_URGENCY_6,
  TIMER_HOURS_URGENCY_8,
  TIMER_HOURS_OUT_OF_SCOPE,
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

  it('extends to 96h for out_of_scope matters (Band D doctrine, 2026-05-15)', () => {
    expect(TIMER_HOURS_OUT_OF_SCOPE).toBe(96);
    const d = computeDecisionDeadline(0, REF, 'out_of_scope');
    expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_OUT_OF_SCOPE * HOUR_MS);
  });

  it('out_of_scope still defers to urgency >= 8 (crisis overrides)', () => {
    // A Band D matter with high urgency can still be time-critical for
    // the lead even if outside the firm's practice. Urgency wins.
    const d = computeDecisionDeadline(8, REF, 'out_of_scope');
    expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_URGENCY_8 * HOUR_MS);
  });

  it('out_of_scope defers to urgency >= 6 too', () => {
    const d = computeDecisionDeadline(6, REF, 'out_of_scope');
    expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_URGENCY_6 * HOUR_MS);
  });

  it('in-scope matter type with low urgency stays at the 48h default', () => {
    const d = computeDecisionDeadline(0, REF, 'shareholder_dispute');
    expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_DEFAULT * HOUR_MS);
  });

  it('no matter type arg falls back to the urgency tiers only (back-compat)', () => {
    const d = computeDecisionDeadline(0, REF);
    expect(d.getTime() - REF.getTime()).toBe(TIMER_HOURS_DEFAULT * HOUR_MS);
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

describe('computeInitialStatus — every lead lands as triaging (Band D doctrine)', () => {
  it('marks out_of_scope as triaging (NOT declined) with system signature', () => {
    // Doctrine flip (2026-05-15): auto-decline removed from intake. OOS
    // matters get band='D' (computed elsewhere) but status='triaging' so
    // the lawyer sees them and can Refer / Take / Pass.
    const result = computeInitialStatus('out_of_scope');
    expect(result.status).toBe('triaging');
    expect(result.changedBy).toBe('system');
  });

  it('marks every in-scope matter as triaging with system signature', () => {
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
      expect(result.changedBy).toBe('system');
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
