/**
 * WP-6 (2026-08-13, field case 2026-08-07): NAP block honesty for
 * channel-satisfied contact.
 *
 * A WhatsApp lead's phone is channel-verified (wa_id, system_metadata
 * provenance) the moment the contact gate passes. Email and postal code
 * were never part of the WhatsApp question flow. Before this fix, the
 * NAP block's "Not captured" cells for Email and Postal code carried the
 * same "Confirm on follow-up" sub-label used for a field the lead was
 * actually asked and did not answer, reading as though two of nine
 * fields had failed rather than never having been asked. This pins the
 * corrected, channel-honest sub-label.
 *
 * New file (not extending the pre-existing screen-brief-html.test.ts,
 * which carries unrelated in-flight changes on this branch).
 */
import { describe, it, expect } from 'vitest';
import { renderBriefHtmlServer } from '../screen-brief-html';
import type { LawyerReport } from '../screen-engine/types';

function buildFakeReport(overrides: Partial<LawyerReport> = {}): LawyerReport {
  const base: LawyerReport = {
    lead_id: 'L-FAKE-WP6',
    submitted_at: new Date('2026-08-07T12:00:00Z').toISOString(),
    matter_snapshot: 'Test matter snapshot.',
    lawyer_time_priority: 'Standard follow-up cadence',
    band: 'B',
    confidence_calibration: 'Test confidence.',
    matter_type: 'business_setup_advisory',
    practice_area: 'corporate',
    four_axis: { value: 4, complexity: 2, urgency: 1, readiness: 6, readinessAnswered: true },
    axis_reasoning: {
      value: { score: 4, reasons: [] },
      complexity: { score: 2, reasons: [] },
      urgency: { score: 1, reasons: [] },
      readiness: { score: 6, reasons: [] },
      readinessAnswered: true,
    },
    truth_warnings: [],
    likely_legal_services: [],
    fee_estimate: 'Test fee estimate.',
    why_it_matters: 'Test why it matters.',
    cross_sell_opportunities: [],
    strategic_considerations: [],
    what_to_confirm: [],
    call_openers: [],
    best_next_question: 'Test question.',
    resolved_facts_v2: [],
    resolved_facts: {},
    inferred_signals: [],
    open_questions: [],
    risk_flags: [],
    band_reasoning_bullets: [],
    contact_complete: true,
    advisory_subtrack: 'solo_setup',
    matter_type_provenance: 'deterministic',
    lead_intent: 'case_description',
  } as LawyerReport;
  return { ...base, ...overrides };
}

describe('NAP block: channel-verified phone reframes Email/Postal-code as "not asked", not "confirm"', () => {
  it('WhatsApp phone (system_metadata) + missing email/postal: both read "Not asked in chat"', () => {
    const report = buildFakeReport({
      resolved_facts_v2: [
        { label: 'Name', value: 'Adriano', source: 'explicit_from_caller' },
        { label: 'Phone', value: '+16475492106', source: 'system_metadata' },
      ],
    });
    const html = renderBriefHtmlServer(report, 'whatsapp', 'en');

    // Both missing cells carry the honest label...
    const notAskedCount = (html.match(/Not asked in chat/g) ?? []).length;
    expect(notAskedCount).toBe(2);
    // ...and neither missing cell reads "Confirm on follow-up" (Name and
    // Phone are both present here, so that phrase should not appear at
    // all for this fixture).
    expect(html).not.toContain('Confirm on follow-up');
  });

  it('a genuinely missing Name still reads "Confirm on follow-up" even with a verified phone', () => {
    const report = buildFakeReport({
      resolved_facts_v2: [
        { label: 'Phone', value: '+16475492106', source: 'system_metadata' },
      ],
    });
    const html = renderBriefHtmlServer(report, 'whatsapp', 'en');

    // Name missing: real gap, keeps the original phrasing.
    expect(html).toContain('Confirm on follow-up');
    // Email + Postal code missing: reachability already established.
    const notAskedCount = (html.match(/Not asked in chat/g) ?? []).length;
    expect(notAskedCount).toBe(2);
  });

  it('web channel with no channel-verified phone: missing email/postal keep "Confirm on follow-up" (no regression)', () => {
    const report = buildFakeReport({
      resolved_facts_v2: [
        { label: 'Name', value: 'Adriano', source: 'explicit_from_caller' },
        { label: 'Phone', value: '+16475492106', source: 'explicit_from_caller' },
      ],
    });
    const html = renderBriefHtmlServer(report, 'web', 'en');

    expect(html).not.toContain('Not asked in chat');
    const confirmCount = (html.match(/Confirm on follow-up/g) ?? []).length;
    expect(confirmCount).toBe(2); // Email + Postal code, both genuinely unasked-and-unanswered on web
  });
});
