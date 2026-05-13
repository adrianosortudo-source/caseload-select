/**
 * Tests for src/lib/screen-to-screened.ts (the dual-write helper that
 * lets /api/screen finalize land a screened_leads row alongside the
 * legacy intake_sessions update). Covers the pure mapping helpers
 * inline; writeScreenedLeadFromScreen is exercised indirectly via the
 * inputs we'd pass it.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveLeadIdFromSession,
  deriveMatterType,
  deriveFourAxis,
  computeDecisionDeadline,
  computeWhaleNurture,
  renderBriefHtml,
  type ScreenCpiSnapshot,
} from '../screen-to-screened';

const REF = new Date('2026-05-13T18:00:00.000Z');
const HOUR_MS = 3600 * 1000;

describe('deriveLeadIdFromSession', () => {
  it('prefixes with L-S1- so legacy widget rows are visually distinguishable', () => {
    expect(deriveLeadIdFromSession('abc-123')).toBe('L-S1-abc-123');
  });
  it('passes the uuid through unchanged in the suffix', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    expect(deriveLeadIdFromSession(uuid)).toBe(`L-S1-${uuid}`);
  });
});

describe('deriveMatterType', () => {
  it('prefers practice_sub_type when present', () => {
    expect(deriveMatterType('Personal Injury', 'pi_mva')).toBe('pi_mva');
  });
  it('lowercases the practice_sub_type', () => {
    expect(deriveMatterType('Personal Injury', 'PI_MVA')).toBe('pi_mva');
  });
  it('falls back to lowercased practice_area with underscores when sub-type missing', () => {
    expect(deriveMatterType('Personal Injury', null)).toBe('personal_injury');
    expect(deriveMatterType('Employment Law', '')).toBe('employment_law');
  });
  it('returns "unknown" when both are missing', () => {
    expect(deriveMatterType(null, null)).toBe('unknown');
    expect(deriveMatterType('', null)).toBe('unknown');
  });
});

describe('deriveFourAxis — CPI → four-axis mapping', () => {
  it('value = fee_score + multi_practice_score, clamped to 0-10', () => {
    const cpi: ScreenCpiSnapshot = { fee_score: 7, multi_practice_score: 2 };
    expect(deriveFourAxis(cpi).value).toBe(9);
  });
  it('clamps value to 10 when sum exceeds 10', () => {
    const cpi: ScreenCpiSnapshot = { fee_score: 8, multi_practice_score: 8 };
    expect(deriveFourAxis(cpi).value).toBe(10);
  });
  it('complexity maps directly from complexity_score, clamped to 0-10', () => {
    expect(deriveFourAxis({ complexity_score: 5 }).complexity).toBe(5);
    expect(deriveFourAxis({ complexity_score: 25 }).complexity).toBe(10);
    expect(deriveFourAxis({ complexity_score: -5 }).complexity).toBe(0);
  });
  it('urgency maps directly from urgency_score', () => {
    expect(deriveFourAxis({ urgency_score: 8 }).urgency).toBe(8);
  });
  it('readiness is the average of legitimacy + referral, clamped to 0-10', () => {
    expect(deriveFourAxis({ legitimacy_score: 8, referral_score: 4 }).readiness).toBe(6);
  });
  it('returns zeros for an empty CPI snapshot', () => {
    const a = deriveFourAxis({});
    expect(a.value).toBe(0);
    expect(a.complexity).toBe(0);
    expect(a.urgency).toBe(0);
    expect(a.readiness).toBe(0);
  });
  it('handles null and undefined fields without throwing', () => {
    const a = deriveFourAxis({
      fee_score: null,
      multi_practice_score: undefined,
      complexity_score: null,
      urgency_score: undefined,
      legitimacy_score: null,
      referral_score: undefined,
    });
    expect(a.value).toBe(0);
    expect(a.complexity).toBe(0);
    expect(a.urgency).toBe(0);
    expect(a.readiness).toBe(0);
  });
});

describe('computeDecisionDeadline (screen path)', () => {
  it('default 48 hours when urgency < 6', () => {
    const d = computeDecisionDeadline(3, REF);
    expect(d.getTime() - REF.getTime()).toBe(48 * HOUR_MS);
  });
  it('24 hours at urgency >= 6', () => {
    const d = computeDecisionDeadline(6, REF);
    expect(d.getTime() - REF.getTime()).toBe(24 * HOUR_MS);
  });
  it('12 hours at urgency >= 8', () => {
    const d = computeDecisionDeadline(9, REF);
    expect(d.getTime() - REF.getTime()).toBe(12 * HOUR_MS);
  });
});

describe('computeWhaleNurture (screen path)', () => {
  it('true when value >= 7 AND readiness <= 4', () => {
    expect(computeWhaleNurture(8, 3)).toBe(true);
    expect(computeWhaleNurture(7, 4)).toBe(true);
  });
  it('false at the boundary on value (just below 7)', () => {
    expect(computeWhaleNurture(6, 3)).toBe(false);
  });
  it('false at the boundary on readiness (just above 4)', () => {
    expect(computeWhaleNurture(9, 5)).toBe(false);
  });
});

describe('renderBriefHtml — output shape + escaping', () => {
  const baseCtx = {
    situationSummary: 'Client was rear-ended on the 401.',
    confirmedAnswers: { incident_date: '2026-04-22', police_report: 'yes' },
    practiceArea: 'Personal Injury',
    practiceSubType: 'pi_mva',
    caseValueLabel: '$50k - $150k',
    caseValueRationale: 'Highway collision with documented injuries.',
    cpi: {} as ScreenCpiSnapshot,
  };

  it('produces a single .brief container wrapper', () => {
    const html = renderBriefHtml(baseCtx);
    expect(html.startsWith('<div class="brief">')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
  });

  it('renders the situation summary in a labelled section', () => {
    const html = renderBriefHtml(baseCtx);
    expect(html).toContain('Situation summary');
    expect(html).toContain('Client was rear-ended on the 401.');
  });

  it('prefers practice_sub_type in the matter-type section', () => {
    const html = renderBriefHtml(baseCtx);
    expect(html).toContain('pi_mva');
  });

  it('escapes HTML entities in situation summary to block stored XSS', () => {
    const html = renderBriefHtml({
      ...baseCtx,
      situationSummary: '<script>alert(1)</script> Bob & "Alice"',
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Bob &amp; &quot;Alice&quot;');
    expect(html).not.toContain('<script>');
  });

  it('escapes HTML in confirmed answer values', () => {
    const html = renderBriefHtml({
      ...baseCtx,
      confirmedAnswers: { what: '<img src=x onerror=alert(1)>' },
    });
    expect(html).not.toContain('<img src=x onerror=');
    expect(html).toContain('&lt;img');
  });

  it('renders the case value section when label or rationale is provided', () => {
    const html = renderBriefHtml(baseCtx);
    expect(html).toContain('Case value indication');
    expect(html).toContain('$50k - $150k');
    expect(html).toContain('Highway collision');
  });

  it('omits the case value section when both label and rationale are null', () => {
    const html = renderBriefHtml({ ...baseCtx, caseValueLabel: null, caseValueRationale: null });
    expect(html).not.toContain('Case value indication');
  });

  it('omits the confirmed-facts section when there are no answers', () => {
    const html = renderBriefHtml({ ...baseCtx, confirmedAnswers: {} });
    expect(html).not.toContain('Confirmed facts');
  });

  it('handles a null situation summary without crashing or rendering "null"', () => {
    const html = renderBriefHtml({ ...baseCtx, situationSummary: null });
    expect(html).not.toContain('Situation summary');
    expect(html).not.toContain('null');
  });

  it('caps the confirmed facts list at 30 entries (prevents unbounded growth in DOM)', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 50; i++) many[`field_${i}`] = `value_${i}`;
    const html = renderBriefHtml({ ...baseCtx, confirmedAnswers: many });
    const count = (html.match(/brief-fact-key/g) ?? []).length;
    expect(count).toBeLessThanOrEqual(30);
  });
});
