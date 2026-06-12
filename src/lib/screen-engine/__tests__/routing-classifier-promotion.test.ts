/**
 * Routing classifier promotion — locks the schema + merge fix that
 * brings Meta channel briefs to parity with the chip-UI web widget.
 *
 * Problem (field-detected 2026-05-24, DRG Messenger): when regex
 * classifier landed at corporate_general (a routing catch-all), the
 * LLM schema did NOT inject the __matter_type classifier slot — so
 * Gemini had no path to promote to a specific sub-type (e.g.
 * shareholder_dispute) from turn-1 free text. Engine asked
 * corporate_problem_type as a follow-up question; reviewer hit
 * redundant routing question.
 *
 * Fix: getExtractableSlots now injects a scoped routing classifier
 * for *_general matter types (schema.ts), and mergeLlmResults applies
 * classificationForMatterType when the LLM picks a different sub-type
 * (extractor.ts), mirroring what applyAnswer does for chip clicks.
 */

import { describe, it, expect } from 'vitest';
import {
  getExtractableSlots,
  MATTER_TYPE_CLASSIFIER_FIELD,
} from '../llm/schema';
import { mergeLlmResults } from '../llm/extractor';
import { initialiseState } from '../extractor';
import type { EngineState } from '../types';

// ── Schema injection ────────────────────────────────────────────────────

describe('getExtractableSlots — routing catch-all classifier injection', () => {
  it('injects scoped __matter_type classifier for corporate_general', () => {
    const slots = getExtractableSlots('corporate_general');
    const classifier = slots.find((s) => s.id === MATTER_TYPE_CLASSIFIER_FIELD);
    expect(classifier).toBeDefined();
    expect(classifier?.input_type).toBe('single_select');
    expect(classifier?.options).toContain('shareholder_dispute');
    expect(classifier?.options).toContain('unpaid_invoice');
    expect(classifier?.options).toContain('vendor_supplier_dispute');
    expect(classifier?.options).toContain('contract_dispute');
    expect(classifier?.options).toContain('corporate_money_control');
    // Stays-at-catch-all option included so the LLM can confidently
    // not promote when the description is ambiguous.
    expect(classifier?.options).toContain('corporate_general');
    // Critical: NOT cross-practice-area. Gemini cannot hijack a
    // corporate matter into employment / family / etc.
    expect(classifier?.options).not.toContain('wrongful_dismissal');
    expect(classifier?.options).not.toContain('residential_purchase_sale');
  });

  it('injects scoped __matter_type classifier for real_estate_general', () => {
    const slots = getExtractableSlots('real_estate_general');
    const classifier = slots.find((s) => s.id === MATTER_TYPE_CLASSIFIER_FIELD);
    expect(classifier).toBeDefined();
    expect(classifier?.options).toContain('residential_purchase_sale');
    expect(classifier?.options).toContain('commercial_real_estate');
    expect(classifier?.options).toContain('real_estate_litigation');
    expect(classifier?.options).toContain('landlord_tenant');
    expect(classifier?.options).toContain('mortgage_dispute');
    expect(classifier?.options).toContain('real_estate_general');
    expect(classifier?.options).not.toContain('shareholder_dispute');
  });

  it('does NOT inject the routing classifier for already-specific matter types', () => {
    // Once the engine has landed at a specific sub-type, no further
    // promotion is offered — the LLM should focus on extracting slots
    // for that sub-type, not re-classifying.
    const slots = getExtractableSlots('shareholder_dispute');
    const classifier = slots.find((s) => s.id === MATTER_TYPE_CLASSIFIER_FIELD);
    expect(classifier).toBeUndefined();
  });

  it('does NOT inject the routing classifier for out-of-scope matters', () => {
    const slots = getExtractableSlots('out_of_scope');
    const classifier = slots.find((s) => s.id === MATTER_TYPE_CLASSIFIER_FIELD);
    expect(classifier).toBeUndefined();
  });

  it('still injects the FULL classifier for unknown matter type', () => {
    // The unknown path retains the full-catalogue classifier (no peer
    // restriction) so Gemini can pick any matter type. This is the
    // original DR-029 behaviour, preserved.
    const slots = getExtractableSlots('unknown');
    const classifier = slots.find((s) => s.id === MATTER_TYPE_CLASSIFIER_FIELD);
    expect(classifier).toBeDefined();
    // Full classifier includes cross-practice options (it's the
    // top-level routing decision).
    expect(classifier?.options).toContain('shareholder_dispute');
    expect(classifier?.options).toContain('residential_purchase_sale');
    expect(classifier?.options).toContain('wrongful_dismissal');
  });
});

// ── Merge promotion (mergeLlmResults) ───────────────────────────────────

function corporateGeneralState(): EngineState {
  const s = initialiseState(
    'my business partner and I are in a dispute about a buyout offer',
  );
  // Verify the regex landed at corporate_general (the routing catch-
  // all). If extractor doctrine ever changes this, the test premise
  // breaks and we'll know.
  if (s.matter_type !== 'corporate_general') {
    throw new Error(
      `Test premise violation: expected initialiseState to land at corporate_general but got ${s.matter_type}`,
    );
  }
  return s;
}

describe('mergeLlmResults: routing catch-all promotion', () => {
  // DR-069 (2026-06-11): *_general promotion now requires
  // allowGeneralPromotion (single-pass flows: voice webhook, operator
  // replay, admin reclassify). On interactive channels the default is
  // gated: the selector asks the routing question and the lead's own
  // answer routes via rerouteFrom*General. The promotion cases below
  // pass the option, documenting the single-pass contract; the gated
  // default has its own block further down.
  it('promotes corporate_general → shareholder_dispute when LLM picks sub-type (single-pass)', () => {
    const before = corporateGeneralState();
    const merged = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'shareholder_dispute',
    }, { allowGeneralPromotion: true });
    expect(merged.matter_type).toBe('shareholder_dispute');
    // intent_family + dispute_family should also update via
    // classificationForMatterType: that's how the brief loads the
    // right matter pack.
    expect(merged.intent_family).toBe('business_dispute');
    // DR-069: the promotion is an AI decision the lead never confirmed.
    expect(merged.matter_type_provenance).toBe('llm_inferred');
  });

  it('promotes corporate_general → unpaid_invoice when LLM picks that (single-pass)', () => {
    const before = corporateGeneralState();
    const merged = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'unpaid_invoice',
    }, { allowGeneralPromotion: true });
    expect(merged.matter_type).toBe('unpaid_invoice');
    expect(merged.intent_family).toBe('business_dispute');
  });

  it('does NOT change matter_type when LLM picks the same catch-all', () => {
    const before = corporateGeneralState();
    const merged = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'corporate_general',
    }, { allowGeneralPromotion: true });
    // No-op: ambiguous description, engine stays at routing catch-all.
    expect(merged.matter_type).toBe('corporate_general');
  });

  it('does NOT change matter_type when LLM returns null', () => {
    const before = corporateGeneralState();
    const merged = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: null,
    }, { allowGeneralPromotion: true });
    expect(merged.matter_type).toBe('corporate_general');
  });

  it('does NOT change matter_type when LLM returns a non-answer literal', () => {
    const before = corporateGeneralState();
    const merged = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'unknown',
    }, { allowGeneralPromotion: true });
    expect(merged.matter_type).toBe('corporate_general');
  });

  it('does NOT promote when matter_type is already a specific sub-type', () => {
    // If the engine already classified the matter (e.g. via earlier
    // turn), the LLM's classifier should not be allowed to re-write.
    // Idempotency invariant.
    const before = corporateGeneralState();
    const promoted = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'shareholder_dispute',
    }, { allowGeneralPromotion: true });
    expect(promoted.matter_type).toBe('shareholder_dispute');
    // Now try to re-promote: should be a no-op (gate condition is
    // state.matter_type must be a routing catch-all).
    const second = mergeLlmResults(promoted, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'unpaid_invoice',
    }, { allowGeneralPromotion: true });
    expect(second.matter_type).toBe('shareholder_dispute');
  });
});

// ── DR-069: gated default on interactive channels ───────────────────────

describe('mergeLlmResults: DR-069 promotion gate (interactive default)', () => {
  it('does NOT promote a *_general catch-all without allowGeneralPromotion', () => {
    const before = corporateGeneralState();
    const merged = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'shareholder_dispute',
    });
    // Interactive default: the routing question stays askable; the
    // lead's own answer routes via rerouteFromCorporateGeneral.
    expect(merged.matter_type).toBe('corporate_general');
    expect(merged.matter_type_provenance).toBe('deterministic');
  });

  it("still promotes the 'unknown' lane without the option (DR-039 multilingual dependency)", () => {
    const before = initialiseState('preciso de ajuda com um problema na minha empresa');
    if (before.matter_type !== 'unknown') {
      throw new Error(
        `Test premise violation: expected non-English text to land at unknown but got ${before.matter_type}`,
      );
    }
    const merged = mergeLlmResults(before, {
      [MATTER_TYPE_CLASSIFIER_FIELD]: 'corporate_general',
    });
    expect(merged.matter_type).toBe('corporate_general');
    expect(merged.matter_type_provenance).toBe('llm_inferred');
  });
});
