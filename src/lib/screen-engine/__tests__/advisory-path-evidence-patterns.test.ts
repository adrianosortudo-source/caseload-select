/**
 * advisory_path evidence patterns (WP-2, 2026-08-13).
 *
 * Field case 2026-08-07: a lead typed "open a business" and still saw
 * advisory_path's full 4-option menu, including the irrelevant "Selling
 * or closing down a business" option. Root cause: the phrase "open a
 * business" was not in advisory_path's evidence_patterns['Starting a new
 * business'] list, so the regex evidence pass never filled the slot.
 *
 * This pins the new patterns and guards against a future edit silently
 * dropping one of them.
 */
import { describe, it, expect } from 'vitest';
import { extractSlotEvidence } from '../slotEvidence';
import { initialiseState } from '../extractor';
import type { EngineState } from '../types';

function advisoryState(): EngineState {
  return { ...initialiseState(''), matter_type: 'business_setup_advisory' };
}

const STARTING_A_NEW_BUSINESS_PHRASES = [
  'open a business',
  'opening a business',
  'open my own business',
  'open my business',
  'start my own business',
  'start my business',
  'open up a business',
  'launch a business',
  'launching a business',
  'register a business',
  'registering a business',
  'open a small business',
  // Pre-existing patterns, re-asserted so a future edit that removes
  // them (rather than only adding to them) fails loud.
  'start a business',
  'starting a company',
  'incorporating',
];

describe('advisory_path evidence patterns: "Starting a new business"', () => {
  it.each(STARTING_A_NEW_BUSINESS_PHRASES)('fills advisory_path from "%s"', (phrase) => {
    const state = extractSlotEvidence(`I want to ${phrase}`, advisoryState());
    expect(state.slots.advisory_path).toBe('Starting a new business');
    expect(state.slot_meta.advisory_path?.source).toBe('explicit');
  });

  it('does not fire on "open a business" when the matter type is not yet classified', () => {
    // extractSlotEvidence no-ops entirely when matter_type is 'unknown';
    // this is the gap channel-intake-processor.ts closes separately by
    // re-running the pass once the LLM classifies the turn (see
    // channel-intake-processor-unknown-lane-evidence.test.ts).
    const state = extractSlotEvidence('open a business', {
      ...initialiseState(''),
      matter_type: 'unknown',
    });
    expect(state.slots.advisory_path).toBeUndefined();
  });

  it('does not overwrite an already-answered advisory_path', () => {
    const answered: EngineState = {
      ...advisoryState(),
      slots: { advisory_path: 'Buying into an existing business' },
      slot_meta: { advisory_path: { source: 'answered', confidence: 1.0 } },
    };
    const state = extractSlotEvidence('open a business', answered);
    expect(state.slots.advisory_path).toBe('Buying into an existing business');
  });

  it('still classifies "buying into" phrasing to the other bucket (no regression)', () => {
    const state = extractSlotEvidence('I am buying into an existing company', advisoryState());
    expect(state.slots.advisory_path).toBe('Buying into an existing business');
  });
});
