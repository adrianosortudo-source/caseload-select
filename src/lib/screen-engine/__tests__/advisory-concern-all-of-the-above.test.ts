/**
 * advisory_concern "All of the above" (WP-4, 2026-08-13).
 *
 * Field case 2026-08-07: the lead answered "1 and 2 and 3" to "What are
 * you most concerned about right now?", a genuine multi-concern answer
 * the four listed options could not represent individually. This pins
 * the new option and its three downstream readers:
 *   - buildLikelyServices: services for the ownership-terms concern AND
 *     the document-review concern both fire (the option spans both).
 *   - buildFeeEstimate: the ownership/exit-terms fee driver fires.
 *   - deriveAdvisorySpecificTask: deliberately does NOT auto-derive a
 *     single specific_task from "All of the above" (see slotEvidence.ts
 *     comment for why fabricating one would misrepresent the lead).
 */
import { describe, it, expect } from 'vitest';
import { buildReport } from '../report';
import { deriveAdvisorySpecificTask } from '../slotEvidence';
import type { EngineState } from '../types';

function partnerSetupState(overrides: Partial<EngineState['slots']> = {}): EngineState {
  const slots: Record<string, string> = {
    client_name: 'Adriano Domingues',
    client_phone: '+14165550100',
    client_email: 'adriano@example.com',
    advisory_concern: 'All of the above',
    ...overrides,
  };
  const slot_meta: EngineState['slot_meta'] = {};
  for (const id of Object.keys(slots)) slot_meta[id] = { source: 'answered' };

  return {
    input: '',
    practice_area: 'corporate',
    matter_type: 'business_setup_advisory',
    intent_family: 'setup_advisory',
    dispute_family: 'general_business',
    advisory_subtrack: 'partner_setup',
    slots,
    slot_meta,
    slot_evidence: {},
    raw: {
      mentions_urgency: false, mentions_money: false, mentions_access: false,
      mentions_ownership: false, mentions_documents: false, mentions_payment: false,
      mentions_agreement: false, mentions_vendor: false, mentions_fraud: false,
      mentions_property: false, mentions_closing: false, mentions_lease: false,
      mentions_construction: false, mentions_mortgage: false,
      mentions_preconstruction: false, input_length: 0,
    },
    confidence: 0,
    coreCompleteness: 0,
    answeredQuestionGroups: [],
    questionHistory: [],
    insightShown: false,
    contactCaptureStarted: true,
    lead_id: 'test-lead',
    submitted_at: new Date(0).toISOString(),
    channel: 'whatsapp',
    language: 'en',
  };
}

describe('advisory_concern: All of the above', () => {
  it('buildLikelyServices includes both the ownership-terms and document-review services', () => {
    const report = buildReport(partnerSetupState());
    expect(report.likely_legal_services).toContain('Shareholder agreement drafting');
    expect(report.likely_legal_services).toContain('Ownership and equity structuring advice');
    expect(report.likely_legal_services).toContain('Document review and advice before signing');
  });

  it('buildFeeEstimate includes the detailed ownership and exit terms driver', () => {
    const report = buildReport(partnerSetupState());
    expect(report.fee_estimate).toContain('detailed ownership and exit terms');
  });

  it('does not add the ownership-terms driver for solo_setup even with All of the above', () => {
    // advisory_concern does not apply to solo_setup at all (excluded by
    // its own applies_to_subtrack), but the fee-estimate branch's own
    // sub !== 'solo_setup' guard is asserted directly for defense in
    // depth in case a future reconstruction path ever sets both.
    const state = { ...partnerSetupState(), advisory_subtrack: 'solo_setup' as const };
    const report = buildReport(state);
    expect(report.fee_estimate).not.toContain('detailed ownership and exit terms');
  });

  it('deriveAdvisorySpecificTask leaves advisory_specific_task unfilled', () => {
    const state = deriveAdvisorySpecificTask(partnerSetupState());
    expect(state.slots.advisory_specific_task).toBeUndefined();
  });
});
