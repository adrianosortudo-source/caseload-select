import { describe, expect, it } from 'vitest';
import { initialiseState } from '../extractor';
import {
  applyAnswer,
  applyClarifyChoice,
  getNextStep,
  WEB_DISCOVERY_HARD_CAP,
  WEB_DISCOVERY_TARGET_MAX,
  WEB_DISCOVERY_TARGET_MIN,
} from '../control';
import type { EngineState, MatterType } from '../types';
import { buildReport } from '../report';

function corporateRoutingState(): EngineState {
  return applyClarifyChoice(
    initialiseState('i want to speak to a lawyer'),
    'corporate_general',
  );
}

describe('web discovery question policy', () => {
  it('publishes the 5–7 target and absolute maximum of 8', () => {
    expect(WEB_DISCOVERY_TARGET_MIN).toBe(5);
    expect(WEB_DISCOVERY_TARGET_MAX).toBe(7);
    expect(WEB_DISCOVERY_HARD_CAP).toBe(8);
  });

  it.each(['web', undefined] as const)(
    'presents insight instead of asking a ninth question for channel %s',
    (channel) => {
      const state: EngineState = {
        ...corporateRoutingState(),
        channel,
        questionHistory: Array.from(
          { length: WEB_DISCOVERY_HARD_CAP },
          (_, index) => `answered_${index + 1}`,
        ),
      };

      expect(getNextStep(state).type).toBe('present_insight');
    },
  );
});

describe('progressive corporate routing policy', () => {
  it('shows four primary categories, then only the relevant detail choices', () => {
    const state = corporateRoutingState();
    const categoryStep = getNextStep(state);

    expect(categoryStep.slot?.id).toBe('corporate_help_category');
    expect(categoryStep.slot?.options).toHaveLength(4);
    expect(categoryStep.slot?.options?.some(option => option.value === 'Something else')).toBe(false);

    const dispute = applyAnswer(
      state,
      'corporate_help_category',
      'Money owed, supplier billing, or a broken agreement',
    );
    const disputeStep = getNextStep(dispute);
    expect(disputeStep.slot?.id).toBe('corporate_dispute_problem_type');
    expect(disputeStep.slot?.options).toHaveLength(3);

    const internal = applyAnswer(
      state,
      'corporate_help_category',
      'A partner, co-owner, or internal company concern',
    );
    const internalStep = getNextStep(internal);
    expect(internalStep.slot?.id).toBe('corporate_internal_problem_type');
    expect(internalStep.slot?.options).toHaveLength(2);

    const support = applyAnswer(
      state,
      'corporate_help_category',
      'Contracts or ongoing legal support',
    );
    const supportStep = getNextStep(support);
    expect(supportStep.slot?.id).toBe('corporate_support_problem_type');
    expect(supportStep.slot?.options).toHaveLength(2);
  });

  it.each([
    ['Money owed, supplier billing, or a broken agreement', 'Someone owes my company money', 'unpaid_invoice'],
    ['Money owed, supplier billing, or a broken agreement', 'A vendor or supplier has billed us incorrectly', 'vendor_supplier_dispute'],
    ['Money owed, supplier billing, or a broken agreement', 'A contract or agreement was not honoured', 'contract_dispute'],
    ['A partner, co-owner, or internal company concern', 'I have a dispute with a business partner or co-owner', 'shareholder_dispute'],
    ['A partner, co-owner, or internal company concern', 'I am concerned about financial irregularities in the company', 'corporate_money_control'],
    ['Contracts or ongoing legal support', 'A contract I need drafted or reviewed before signing', 'business_setup_advisory'],
    ['Contracts or ongoing legal support', 'Ongoing legal support for an existing business', 'general_counsel_advisory'],
  ] as const)(
    'preserves the canonical route for %s → %s',
    (category, detail, expectedMatter) => {
      const categorized = applyAnswer(
        corporateRoutingState(),
        'corporate_help_category',
        category,
      );
      const detailSlot = getNextStep(categorized).slot;
      expect(detailSlot).toBeDefined();

      const routed = applyAnswer(categorized, detailSlot!.id, detail);
      expect(routed.slots.corporate_problem_type).toBe(detail);
      expect(routed.matter_type).toBe(expectedMatter as MatterType);
      expect(routed.matter_type_provenance).toBe('user_routing_answer');
    },
  );

  it('routes business formation directly after one category screen', () => {
    const routed = applyAnswer(
      corporateRoutingState(),
      'corporate_help_category',
      'Starting, buying, or restructuring a business',
    );

    expect(routed.matter_type).toBe('business_setup_advisory');
    expect(routed.slots.corporate_problem_type).toBe(
      'Starting, buying, or restructuring a business',
    );
  });

  it('accepts the one free-text escape without looping back to the category menu', () => {
    const routed = applyAnswer(
      corporateRoutingState(),
      'corporate_help_category',
      'other:I need help with corporate minute books',
    );

    expect(routed.slots.corporate_problem_type).toBe(
      'other:I need help with corporate minute books',
    );
    expect(getNextStep(routed).slot?.id).not.toBe('corporate_help_category');
  });

  it('reports one canonical routing fact instead of counting routing scaffolding', () => {
    const categorized = applyAnswer(
      corporateRoutingState(),
      'corporate_help_category',
      'Money owed, supplier billing, or a broken agreement',
    );
    const routed = applyAnswer(
      categorized,
      'corporate_dispute_problem_type',
      'Someone owes my company money',
    );
    const report = buildReport(routed);

    expect(report.resolved_facts['Problem type']).toBe('Someone owes my company money');
    expect(report.resolved_facts_v2.filter(fact => fact.label === 'Problem type')).toHaveLength(1);
    expect(report.confidence_calibration).toContain('Brief built from 1 fact:');
  });
});
