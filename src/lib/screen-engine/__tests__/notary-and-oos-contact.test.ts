/**
 * DR-073: two coupled fixes triggered by a notary widget test.
 *
 * 1. notary_services matter type. A real DRG service (administrative, not
 *    legal advice). In-scope LOW-priority lane at Band C, NOT out_of_scope.
 *    Tight intake (one document-type question), then contact capture, then
 *    triaging at Band C, visible to the lawyer.
 *
 * 2. out_of_scope now captures contact BEFORE stopping. Previously the OOS
 *    branch returned `stop` immediately, so a web/SMS/GBP OOS lead with no
 *    pre-seeded contact persisted with no contact, got rejected to
 *    `unconfirmed_inquiries` (no_contact_provided), and the done screen
 *    falsely promised a callback. Now OOS drives present_insight ->
 *    capture_contact -> stop, landing the lead as Band D triaging.
 */

import { describe, it, expect } from 'vitest';
import { initialiseState } from '../extractor';
import { getNextStep, applyAnswer, markInsightShown, startContactCapture } from '../control';
import { computeBand } from '../band';
import { selectNextSlot } from '../selector';
import { buildReport } from '../report';
import type { EngineState } from '../types';

// ── 1. notary classification + Band C ────────────────────────────────────

describe('notary_services: classification', () => {
  const inputs = [
    'i need a document notarized',
    'I need a document notarised',
    'can you notarize this for me',
    'I need a commissioner of oaths',
    'I need a certified copy of my passport',
    'can someone witness my signature',
  ];
  for (const input of inputs) {
    it(`"${input}" classifies to notary_services`, () => {
      const s = initialiseState(input);
      expect(s.matter_type).toBe('notary_services');
      expect(s.practice_area).toBe('corporate');
    });
  }

  it('bands at C (operator decision for Damaris), never D', () => {
    const s = initialiseState('i need a document notarized');
    const result = computeBand(s);
    expect(result.band).toBe('C');
    expect(result.reasoning.toLowerCase()).toContain('notary');
  });

  it('Band C holds regardless of the document-type answer', () => {
    let s = initialiseState('i need a document notarized');
    s = applyAnswer(s, 'notary_document_type', 'Real estate or mortgage document');
    expect(computeBand(s).band).toBe('C');
  });
});

describe('notary_services: tight intake (one slot, then contact)', () => {
  it('asks only notary_document_type, never the universal readiness slots', () => {
    let s = initialiseState('i need a document notarized');
    const first = selectNextSlot(s);
    expect(first?.id).toBe('notary_document_type');
    s = applyAnswer(s, 'notary_document_type', 'Affidavit or statutory declaration');
    // After the one slot, no further matter/readiness slot should be asked.
    const second = selectNextSlot(s);
    expect(second).toBeNull();
  });

  it('after the doc-type answer, the next step is present_insight (drives to contact)', () => {
    let s = initialiseState('i need a document notarized');
    s = applyAnswer(s, 'notary_document_type', 'Travel or consent letter');
    expect(getNextStep(s).type).toBe('present_insight');
  });

  it('captures contact and reaches stop (lands in the queue)', () => {
    let s = initialiseState('i need a document notarized');
    s = applyAnswer(s, 'notary_document_type', 'Other');
    s = startContactCapture(markInsightShown(s));
    s = applyAnswer(s, 'client_name', 'Jordan Reyes');
    s = applyAnswer(s, 'client_email', 'jordan@example.com');
    expect(getNextStep(s).type).toBe('stop');
  });
});

describe('notary_services: brief matter pack', () => {
  function notaryReport(): ReturnType<typeof buildReport> {
    let s = initialiseState('i need a document notarized');
    s = applyAnswer(s, 'notary_document_type', 'Real estate or mortgage document');
    return buildReport(s);
  }
  it('snapshot is notary-specific, not the unclassified default', () => {
    const r = notaryReport();
    expect(r.matter_snapshot.toLowerCase()).toContain('notary');
    expect(r.matter_snapshot).not.toBe('Matter type not classified.');
  });
  it('fee framing marks it administrative, not a legal-services engagement', () => {
    expect(notaryReport().fee_estimate.toLowerCase()).toContain('notary');
  });
  it('services, openers, and what-to-confirm are populated', () => {
    const r = notaryReport();
    expect(r.likely_legal_services.length).toBeGreaterThan(0);
    expect(r.call_openers.length).toBeGreaterThan(0);
    expect(r.what_to_confirm.length).toBeGreaterThan(0);
  });
});

describe('notary_services: anti-scope (does not swallow real matters)', () => {
  const cases: Array<[string, string]> = [
    // A legal matter that merely mentions notarization stays a legal matter.
    ['I need to incorporate my company and notarize the resolutions', 'business_setup_advisory'],
    ['I am buying a house and need the closing documents notarized', 'residential_purchase_sale'],
    ['I need a will drafted', 'will_drafting'],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" routes to ${expected}, not notary_services`, () => {
      const s = initialiseState(input);
      expect(s.matter_type).toBe(expected);
      expect(s.matter_type).not.toBe('notary_services');
    });
  }
});

// ── 2. out_of_scope captures contact before stopping ─────────────────────

describe('out_of_scope: captures contact before stop (DR-073)', () => {
  function oosState(): EngineState {
    const s = initialiseState('I need help with my divorce and custody of my kids');
    if (s.matter_type !== 'out_of_scope') {
      throw new Error(`premise: expected out_of_scope, got ${s.matter_type}`);
    }
    return s;
  }

  it('does NOT stop immediately on the first turn (no contact yet)', () => {
    const step = getNextStep(oosState());
    expect(step.type).not.toBe('stop');
    // It presents the routing-note insight first.
    expect(step.type).toBe('present_insight');
  });

  it('drives contact capture after the insight', () => {
    let s = oosState();
    s = startContactCapture(markInsightShown(s));
    const step = getNextStep(s);
    expect(step.type).toBe('capture_contact');
  });

  it('reaches stop only once name + reachability are captured', () => {
    let s = oosState();
    s = startContactCapture(markInsightShown(s));
    s = applyAnswer(s, 'client_name', 'Alex Kim');
    s = applyAnswer(s, 'client_phone', '+1 416 555 0143');
    expect(getNextStep(s).type).toBe('stop');
  });

  it('a contact-pre-seeded OOS lead (voice/Meta shape) stops on the first pass', () => {
    // Voice seeds caller-ID phone + name; the gate is satisfied immediately,
    // so the legacy stop-immediately behaviour is preserved for those channels.
    let s = oosState();
    s = {
      ...s,
      slots: { ...s.slots, client_name: 'Alex Kim', client_phone: '+14165550143' },
      slot_meta: {
        ...s.slot_meta,
        client_name: { source: 'profile_metadata', confidence: 1 },
        client_phone: { source: 'system_metadata', confidence: 1 },
      },
    };
    expect(getNextStep(s).type).toBe('stop');
  });
});
