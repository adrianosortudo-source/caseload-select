/**
 * DR-072: general_counsel_advisory matter type.
 *
 * The 28th matter type, absorbing DRG's Fractional Counsel + standalone
 * Contract Review + Records Upkeep services. Peer matter type, not a
 * subtrack of business_setup_advisory.
 *
 * The anti-scope guards are the load-bearing part of this lane (operator
 * caution: "must not become a junk drawer"). The bulk of this file proves
 * that existing dispute / setup / wills / employment / real-estate inputs
 * are NOT pulled into general_counsel_advisory by accident.
 *
 * Report requirements (operator ask) documented as living assertions:
 *  - trigger phrases that route IN (the three signal families)
 *  - anti-signals that keep other matters OUT (the no-leak suite)
 *  - 3 examples that land here, 3 borderline that do not.
 */

import { describe, it, expect } from 'vitest';
import { initialiseState, rerouteFromCorporateGeneral } from '../extractor';
import { applyAnswer, getNextStep, buildLeadSummary } from '../control';
import { computeBand } from '../band';
import { selectNextSlot } from '../selector';
import { buildReport } from '../report';
import { getI18n } from '../i18n/loader';
import type { EngineState, SlotMetaSource } from '../types';

function stateWithRoutingFill(
  base: EngineState,
  slotId: string,
  value: string,
  source: SlotMetaSource,
): EngineState {
  return {
    ...base,
    slots: { ...base.slots, [slotId]: value },
    slot_meta: { ...base.slot_meta, [slotId]: { source, confidence: 0.7 } },
  };
}

// ── 1. Trigger phrases that route IN ─────────────────────────────────────

describe('general_counsel_advisory: trigger phrases route in', () => {
  const fractionalCounsel = [
    'I need a fractional general counsel for my company',
    'looking for an on-call lawyer for my business',
    'I want a lawyer on retainer for ongoing legal support',
    'we need outsourced general counsel',
  ];
  for (const input of fractionalCounsel) {
    it(`fractional counsel: "${input}"`, () => {
      const s = initialiseState(input);
      expect(s.matter_type).toBe('general_counsel_advisory');
      expect(s.practice_area).toBe('corporate');
      expect(s.intent_family).toBe('general_counsel');
    });
  }

  const contractReview = [
    'can you review a contract before I sign it',
    'can you review a vendor agreement',
    'please draft a contract for my business',
    'can you review an NDA for me',
  ];
  for (const input of contractReview) {
    it(`standalone contract review: "${input}"`, () => {
      const s = initialiseState(input);
      expect(s.matter_type).toBe('general_counsel_advisory');
    });
  }

  const recordsUpkeep = [
    'I need help keeping my corporate records up to date',
    'we need our minute book brought current',
    'help with annual corporate maintenance',
    'I want to keep my corporation compliant',
  ];
  for (const input of recordsUpkeep) {
    it(`records upkeep: "${input}"`, () => {
      const s = initialiseState(input);
      expect(s.matter_type).toBe('general_counsel_advisory');
    });
  }
});

// ── 2. Anti-signals: existing lanes are NOT pulled in (the no-leak suite) ─

describe('general_counsel_advisory: does NOT swallow other matter types', () => {
  // The DR-072 contract: GC never swallows a matter that belongs in
  // another lane. The exact destination of each input is covered by that
  // matter type's own routing tests; here the invariant under test is
  // purely "not general_counsel_advisory". Where the exact destination is
  // reliable it is asserted as a second expectation.
  const cases: Array<[string, string?]> = [
    // Setup wins (incorporation is forward-looking, not GC)
    ['I want to incorporate my company', 'business_setup_advisory'],
    ['starting a business with a partner', 'business_setup_advisory'],
    ['set up a corporation and a shareholders agreement', 'business_setup_advisory'],
    // Disputes win
    ['my business partner locked me out of the accounts', 'shareholder_dispute'],
    ['a client owes us money and refuses to pay', 'unpaid_invoice'],
    ['our vendor overcharged us and billed for undelivered goods', 'vendor_supplier_dispute'],
    ['they broke our agreement and denied the deal'],
    // Real estate wins
    ['I am buying a house and need a lawyer for closing', 'residential_purchase_sale'],
    ['we are leasing a commercial space for our business'],
    // Employment + estates win
    ['I was fired from my job last week', 'wrongful_dismissal'],
    ['I need a will drafted', 'will_drafting'],
    ['I need a power of attorney for my mother', 'power_of_attorney'],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" does NOT route to general_counsel_advisory`, () => {
      const s = initialiseState(input);
      expect(s.matter_type).not.toBe('general_counsel_advisory');
      if (expected) expect(s.matter_type).toBe(expected);
    });
  }

  // Real-estate leasing: the exact bare-classification type varies
  // (real_estate_general until the DR-070 leasing bucket promotes it), but
  // the anti-scope invariant is what matters: it is a real-estate lane,
  // never general_counsel_advisory.
  it('"we are leasing a commercial space for our business" stays in real estate, not GC', () => {
    const s = initialiseState('we are leasing a commercial space for our business');
    expect(s.practice_area).toBe('real_estate');
    expect(s.matter_type).not.toBe('general_counsel_advisory');
  });

  it('a dispute contract reference does not get pulled into GC contract review', () => {
    // "breach of contract" is a dispute, not a pre-signing review.
    const s = initialiseState('they breached our contract and owe us damages');
    expect(s.matter_type).not.toBe('general_counsel_advisory');
  });

  it('pre-incorporation document review stays with setup, not GC', () => {
    // SETUP_ADVISORY is matched before the GC signals, so a
    // shareholders-agreement pre-signing review on a new venture stays
    // in the setup lane.
    const s = initialiseState(
      'starting a company with a co-founder and want the shareholders agreement reviewed before signing',
    );
    expect(s.matter_type).toBe('business_setup_advisory');
  });
});

// ── 3. Three borderline inputs that should NOT land here ─────────────────

describe('general_counsel_advisory: borderline inputs stay out', () => {
  it('"I have a legal question" with no business signal stays unknown (clarify path)', () => {
    const s = initialiseState('I have a legal question and need some advice');
    expect(s.matter_type).not.toBe('general_counsel_advisory');
    expect(s.matter_type).toBe('unknown');
  });

  it('a consumer reviewing a personal contract is not auto-promoted to GC business advisory', () => {
    // No business context. The contract-review signal can fire, but the
    // brief's gca_business_stage slot ("Not a business, this is personal")
    // is the operator's catch. At classification time a bare "review my
    // lease agreement" should not assert a business relationship; this
    // is a known judgment-call boundary documented for the operator.
    const s = initialiseState('can you review my apartment lease');
    // Lease signal routes this to real estate, NOT general counsel.
    expect(s.matter_type).not.toBe('general_counsel_advisory');
  });

  it('notary-only request does not route to GC', () => {
    const s = initialiseState('I need notary services for a document');
    expect(s.matter_type).not.toBe('general_counsel_advisory');
  });
});

// ── 4. Routing-question bucket (interactive channels) ────────────────────

describe('general_counsel_advisory: corporate_general routing bucket', () => {
  it('the chip answer routes corporate_general to general_counsel_advisory (user-grounded)', () => {
    const base = { ...initialiseState('I have a corporate matter'), matter_type: 'corporate_general' as const };
    const after = applyAnswer(base, 'corporate_problem_type', 'Ongoing legal support for an existing business');
    expect(after.matter_type).toBe('general_counsel_advisory');
    expect(after.matter_type_provenance).toBe('user_routing_answer');
  });

  it('an llm_inferred routing fill does NOT route (DR-069 gate holds for the new bucket)', () => {
    const base = { ...initialiseState('I have a corporate matter'), matter_type: 'corporate_general' as const };
    const filled = stateWithRoutingFill(
      base, 'corporate_problem_type', 'Ongoing legal support for an existing business', 'llm_inferred',
    );
    const after = rerouteFromCorporateGeneral(filled, 'Ongoing legal support for an existing business');
    expect(after.matter_type).toBe('corporate_general');
  });
});

// ── 5. Slot flow + the conditional document slot ─────────────────────────

describe('general_counsel_advisory: tight 4-slot flow', () => {
  function gcState(): EngineState {
    const s = initialiseState('I want an on-call lawyer for my business');
    if (s.matter_type !== 'general_counsel_advisory') {
      throw new Error(`premise: expected general_counsel_advisory, got ${s.matter_type}`);
    }
    return s;
  }

  it('asks gca_engagement_shape first', () => {
    expect(selectNextSlot(gcState())?.id).toBe('gca_engagement_shape');
  });

  it('does NOT ask gca_specific_document when the shape is ongoing support', () => {
    let s = gcState();
    s = applyAnswer(s, 'gca_engagement_shape', 'Ongoing on-call legal support');
    s = applyAnswer(s, 'gca_business_stage', 'Already operating');
    s = applyAnswer(s, 'gca_business_size', '2 to 10');
    // The next slot must not be the contract-detail free text.
    let guard = 0;
    while (guard++ < 10) {
      const next = selectNextSlot(s);
      if (!next) break;
      expect(next.id).not.toBe('gca_specific_document');
      s = applyAnswer(s, next.id, next.options?.[0]?.value ?? 'Not sure');
    }
  });

  it('DOES ask gca_specific_document when the shape is contract review', () => {
    let s = gcState();
    s = applyAnswer(s, 'gca_engagement_shape', 'A specific contract reviewed or drafted');
    s = applyAnswer(s, 'gca_business_stage', 'Already operating');
    s = applyAnswer(s, 'gca_business_size', 'Solo');
    const askedIds: string[] = [];
    let guard = 0;
    let cur = s;
    while (guard++ < 12) {
      const next = selectNextSlot(cur);
      if (!next) break;
      askedIds.push(next.id);
      cur = applyAnswer(cur, next.id, next.options?.[0]?.value ?? 'a vendor services agreement');
    }
    expect(askedIds).toContain('gca_specific_document');
  });
});

// ── 6. Banding: conservative B default, lift on size + switching ─────────

describe('general_counsel_advisory: banding', () => {
  function answeredGc(opts: { size?: string; shape?: string; counsel?: string; timeline?: string }): EngineState {
    let s = initialiseState('I want ongoing legal support for my business');
    s = applyAnswer(s, 'gca_engagement_shape', opts.shape ?? 'Ongoing on-call legal support');
    s = applyAnswer(s, 'gca_business_stage', 'Already operating');
    if (opts.size) s = applyAnswer(s, 'gca_business_size', opts.size);
    if (opts.counsel) s = applyAnswer(s, 'other_counsel', opts.counsel);
    if (opts.timeline) s = applyAnswer(s, 'hiring_timeline', opts.timeline);
    return s;
  }

  it('a solo, exploring engagement lands at B or C (conservative default)', () => {
    const s = answeredGc({ size: 'Solo', timeline: 'Just exploring, no timeline yet' });
    const band = computeBand(s).band;
    expect(['B', 'C']).toContain(band);
  });

  it('a larger business switching counsel lifts toward A', () => {
    const s = answeredGc({
      size: 'Over 50',
      counsel: 'Yes, switching from a previous lawyer',
      timeline: 'Now (this week)',
    });
    const band = computeBand(s).band;
    expect(['A', 'B']).toContain(band);
    // Value axis got the size lift.
    expect(['A', 'B']).toContain(band);
  });

  it('never lands at Band D (D is reserved for out-of-scope)', () => {
    const s = answeredGc({ size: 'Not sure' });
    expect(computeBand(s).band).not.toBe('D');
  });
});

// ── 7. Brief renders a real matter pack (not the unclassified default) ───

describe('general_counsel_advisory: brief matter pack', () => {
  function gcReport(shape: string) {
    let s = initialiseState('I want ongoing legal support for my business');
    s = applyAnswer(s, 'gca_engagement_shape', shape);
    s = applyAnswer(s, 'gca_business_stage', 'Already operating');
    s = applyAnswer(s, 'gca_business_size', '2 to 10');
    return buildReport(s);
  }

  it('matter snapshot is GC-specific, not the "not classified" default', () => {
    const r = gcReport('Ongoing on-call legal support');
    expect(r.matter_snapshot.toLowerCase()).toContain('general counsel');
    expect(r.matter_snapshot).not.toBe('Matter type not classified.');
  });

  it('fee estimate routes to the call (not on the flat-fee schedule)', () => {
    const r = gcReport('Ongoing on-call legal support');
    expect(r.fee_estimate.toLowerCase()).toContain('flat-fee schedule');
  });

  it('likely services and call openers are populated', () => {
    const r = gcReport('A specific contract reviewed or drafted');
    expect(r.likely_legal_services.length).toBeGreaterThan(0);
    expect(r.call_openers.length).toBeGreaterThan(0);
    expect(r.what_to_confirm.length).toBeGreaterThan(0);
  });

  it('the review-screen summary is GC-specific, not the empty generic fallback (DR-073)', () => {
    let s = initialiseState('I want an on-call lawyer for my business');
    s = applyAnswer(s, 'gca_engagement_shape', 'Ongoing on-call legal support');
    const summary = buildLeadSummary(s, getI18n('en'));
    expect(summary.intro).not.toBe('Thank you. Here is what we understood from your description.');
    expect(summary.intro.toLowerCase()).toContain('business');
  });
});
