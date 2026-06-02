/**
 * Tests for contact-extraction.ts.
 *
 * Covers the structural gap that was field-detected in the Messenger
 * multi-turn loop on 2026-05-24: the bot asked for contact, the lead
 * replied with bare contact info, and the engine had no path to capture
 * it (LLM excluded from contact slots, slot evidence registry has no
 * patterns for contact slots, extractContactName requires an intro
 * phrase). These tests pin the regex coverage and the safety guards
 * that keep bare-name extraction from over-firing on casual chat.
 */

import { describe, it, expect } from 'vitest';
import {
  extractContactFromTurn,
  applyContactExtractionToState,
} from '../contact-extraction';
import type { EngineState } from '../screen-engine/types';

function emptyState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    lead_id: 'L-TEST-001',
    input: '',
    matter_type: 'corporate_general',
    practice_area: 'corporate',
    intent_family: 'advisory',
    language: 'en',
    channel: 'facebook',
    slots: {},
    slot_meta: {},
    slot_evidence: {},
    submitted_at: new Date('2026-05-24T00:00:00Z').toISOString(),
    ...overrides,
  } as EngineState;
}

// ── Pure extractor ──────────────────────────────────────────────────────

describe('extractContactFromTurn — email', () => {
  it('extracts a standard email', () => {
    const r = extractContactFromTurn('reach me at sarah.patel.test@example.com');
    expect(r.email).toBe('sarah.patel.test@example.com');
  });

  it('extracts email with + tag', () => {
    const r = extractContactFromTurn('email me at adriano+legal@caseloadselect.ca');
    expect(r.email).toBe('adriano+legal@caseloadselect.ca');
  });

  it('returns undefined when no email', () => {
    const r = extractContactFromTurn('I was fired last week');
    expect(r.email).toBeUndefined();
  });
});

describe('extractContactFromTurn — phone', () => {
  it('extracts NA phone with spaces and normalises to E.164', () => {
    const r = extractContactFromTurn('call me at 647 555 9999');
    expect(r.phone).toBe('+16475559999');
  });

  it('extracts NA phone with dashes', () => {
    const r = extractContactFromTurn('647-555-9999 is best');
    expect(r.phone).toBe('+16475559999');
  });

  it('extracts NA phone with parens', () => {
    const r = extractContactFromTurn('reach me at (647) 555-9999');
    expect(r.phone).toBe('+16475559999');
  });

  it('extracts NA phone with +1 country code', () => {
    const r = extractContactFromTurn('+1 647-555-9999');
    expect(r.phone).toBe('+16475559999');
  });

  it('rejects 1XX area codes (NANP invariant)', () => {
    // 100 is not a valid NANP area code (must start 2-9). The number
    // 1005551234 should NOT be parsed as a phone.
    const r = extractContactFromTurn('account number 1005551234');
    expect(r.phone).toBeUndefined();
  });

  it('returns undefined for plain prose with no phone shape', () => {
    const r = extractContactFromTurn('I have a question about my employment situation');
    expect(r.phone).toBeUndefined();
  });
});

describe('extractContactFromTurn — bare name (gated)', () => {
  it('extracts bare name when email is present in same message', () => {
    const r = extractContactFromTurn('Sarah Patel\nsarah.patel.test@example.com');
    expect(r.name).toBe('Sarah Patel');
    expect(r.email).toBe('sarah.patel.test@example.com');
  });

  it('extracts bare name when phone is present in same message', () => {
    const r = extractContactFromTurn('Sarah Patel\n647-555-9999');
    expect(r.name).toBe('Sarah Patel');
    expect(r.phone).toBe('+16475559999');
  });

  it('extracts name from comma-separated reply (Sarah Patel, 647 555 9999, email)', () => {
    const r = extractContactFromTurn('Sarah Patel, 647 555 9999, sarah.patel.test@example.com');
    expect(r.name).toBe('Sarah Patel');
    expect(r.phone).toBe('+16475559999');
    expect(r.email).toBe('sarah.patel.test@example.com');
  });

  it('does NOT extract name when no email/phone is present (casual chat guard)', () => {
    // Even though "Sarah Patel" appears in a way that could match the
    // bare-name pattern, without an email or phone we treat it as casual
    // text — the lead might be talking ABOUT a third party.
    const r = extractContactFromTurn('My executor is Sarah Patel and we have a dispute');
    expect(r.name).toBeUndefined();
  });

  it('extracts handles hyphenated and apostrophe names with phone', () => {
    const r = extractContactFromTurn("Jean-Claude O'Brien, 416-555-0142");
    expect(r.name).toBe("Jean-Claude O'Brien");
    expect(r.phone).toBe('+14165550142');
  });

  it('rejects bare-name when first token is in the blocklist (Hi/Yes/etc)', () => {
    const r = extractContactFromTurn('Hi Sarah\n647-555-9999');
    // "Hi Sarah" first token is "hi" → blocklisted → no name capture.
    expect(r.name).toBeUndefined();
    expect(r.phone).toBe('+16475559999');
  });
});

// ── State mutator ───────────────────────────────────────────────────────

describe('applyContactExtractionToState', () => {
  it('fills empty contact slots from a contact-reply turn', () => {
    const before = emptyState();
    const after = applyContactExtractionToState(
      'Sarah Patel, 647 555 9999, sarah.patel.test@example.com',
      before,
    );
    expect(after.slots['client_name']).toBe('Sarah Patel');
    expect(after.slots['client_phone']).toBe('+16475559999');
    expect(after.slots['client_email']).toBe('sarah.patel.test@example.com');
    expect(after.slot_meta['client_name']?.source).toBe('explicit');
    expect(after.slot_meta['client_email']?.confidence).toBe(0.95);
  });

  it('does NOT overwrite already-filled slots (channel pre-fill wins)', () => {
    const before = emptyState({
      slots: { client_name: 'Adriano Domingues' },
      slot_meta: {
        client_name: { source: 'answered', confidence: 1.0 },
      },
    });
    const after = applyContactExtractionToState(
      'Sarah Patel, sarah.patel.test@example.com',
      before,
    );
    // Channel pre-fill of "Adriano Domingues" must not be replaced by
    // the bare-name extraction.
    expect(after.slots['client_name']).toBe('Adriano Domingues');
    // But the new email IS captured because client_email was empty.
    expect(after.slots['client_email']).toBe('sarah.patel.test@example.com');
  });

  it('returns the same state reference when nothing was extracted', () => {
    const before = emptyState();
    const after = applyContactExtractionToState(
      'I have a question about my employment situation',
      before,
    );
    expect(after).toBe(before);
  });

  it('returns the same state reference when extracted fields are identical to already-filled slots', () => {
    // #137 contract change (2026-06-02): when an existing slot value equals
    // the newly extracted value, the state object is preserved (no rewrite).
    // The "all-three-already-filled-blocks-overwrite" contract was REMOVED
    // by #137 — see the precedence-aware merge tests below. Identical-value
    // collisions still short-circuit so we don't churn the state object on
    // repeated turns of the same contact info.
    const before = emptyState({
      slots: {
        client_name: 'Sarah Patel',
        client_email: 'sarah.patel.test@example.com',
        client_phone: '+16475559999',
      },
    });
    const after = applyContactExtractionToState(
      'Sarah Patel, 647-555-9999, sarah.patel.test@example.com',
      before,
    );
    // All three extracted values match what's already in slots, so no
    // promotion fires for any of them and the state object is unchanged.
    expect(after).toBe(before);
  });

  it('handles the exact field-detected failure case (2026-05-24)', () => {
    // The reply that Adriano sent during the Messenger test that
    // triggered the infinite-loop bug:
    //   "Sarah Patel
    //    647 555 9999
    //    sarah.patel.test@example.com"
    const reply = 'Sarah Patel\n647 555 9999\nsarah.patel.test@example.com';
    const before = emptyState({ matter_type: 'wrongful_dismissal' });
    const after = applyContactExtractionToState(reply, before);

    // All three slots filled — the contact-doctrine gate (name + (email
    // OR phone)) will now pass on the next gate evaluation.
    expect(after.slots['client_name']).toBe('Sarah Patel');
    expect(after.slots['client_email']).toBe('sarah.patel.test@example.com');
    expect(after.slots['client_phone']).toBe('+16475559999');
  });
});

/**
 * Bug #137 regression coverage (2026-06-02 voice smoke 1).
 *
 * Field-detected pattern: operator called the live DRG Voice AI line, the
 * agent extracted "Adriano Dominguez" from the first turn, the operator
 * verbally corrected to "Adriano Domingues" later in the call, but the
 * lawyer brief showed the misspelled version with provenance label "Stated
 * in description". Root cause: contact-extraction.ts checked
 * `!slots['client_name']` and skipped any later extraction once the slot
 * was filled. Fix (option a per operator direction): if a later extracted
 * value differs from the current value, promote the later one. Tag the
 * new value as source 'explicit' (renders as "Stated during call" in the
 * brief). Do NOT overclaim provenance as readback-confirmed; that label
 * is reserved for future readback-detection logic.
 */
describe('precedence-aware merge (#137 option-a slice)', () => {
  // Note: bare-name extraction is gated on the same message containing an
  // email or phone match (the contact-reply context). So test turns include
  // a phone alongside the name. The phone correction case can drop the name
  // since phone extraction has no gate.

  it('later differing client_name overrides earlier extraction', () => {
    // Initial state: nothing captured yet.
    let state = emptyState();

    // First turn: caller gives wrong-spelling name + phone (contact-reply
    // context). Name chunk must be its own comma-split segment.
    const firstTurn = 'Adriano Dominguez, 416-555-1212';
    state = applyContactExtractionToState(firstTurn, state);
    expect(state.slots['client_name']).toBe('Adriano Dominguez');
    expect(state.slot_meta['client_name']?.source).toBe('explicit');

    // Later turn: caller spells the surname correctly. Phone present again
    // to keep the bare-name gate satisfied.
    const correctionTurn = 'Adriano Domingues, 416-555-1212';
    state = applyContactExtractionToState(correctionTurn, state);

    // The corrected value MUST win, not the original.
    expect(state.slots['client_name']).toBe('Adriano Domingues');

    // Provenance stays as 'explicit' (renders as "Stated during call").
    // It must NOT be promoted to 'confirmed_by_caller_after_readback'
    // because the extraction layer has not actually detected readback.
    expect(state.slot_meta['client_name']?.source).toBe('explicit');

    // Evidence string should note the correction, not just "bare-name regex".
    const evidence = state.slot_meta['client_name']?.evidence ?? '';
    expect(evidence).toContain('corrected from');
    expect(evidence).toContain('Adriano Dominguez');
  });

  it('identical re-extraction preserves the existing slot_meta object', () => {
    let state = emptyState();
    state = applyContactExtractionToState(
      'Sarah Patel, 416-555-9999',
      state,
    );
    expect(state.slots['client_name']).toBe('Sarah Patel');
    const firstMeta = state.slot_meta['client_name'];

    // Same name extracted again. Should not rewrite slot_meta.
    const after = applyContactExtractionToState(
      'Sarah Patel, 416-555-9999',
      state,
    );

    expect(after.slots['client_name']).toBe('Sarah Patel');
    // shouldPromote = (current !== extracted) = false for the name slot,
    // so slot_meta['client_name'] is preserved verbatim (no rewrite to
    // "corrected from" evidence).
    expect(after.slot_meta['client_name']).toBe(firstMeta);
  });

  it('later differing client_phone overrides earlier extraction', () => {
    let state = emptyState();

    // First turn: phone captured (no name gate for phone extraction).
    state = applyContactExtractionToState(
      'You can reach me at 416-555-1212.',
      state,
    );
    expect(state.slots['client_phone']).toBe('+14165551212');

    // Later turn: caller gives a different (corrected) number.
    state = applyContactExtractionToState(
      'Actually, use 647-549-2106 instead.',
      state,
    );

    // The corrected number MUST win.
    expect(state.slots['client_phone']).toBe('+16475492106');
    expect(state.slot_meta['client_phone']?.source).toBe('explicit');
    expect(state.slot_meta['client_phone']?.evidence ?? '').toContain(
      'corrected from',
    );
  });

  it('later differing client_email overrides earlier extraction', () => {
    let state = emptyState();

    state = applyContactExtractionToState(
      'My email is adriano@example.com.',
      state,
    );
    expect(state.slots['client_email']).toBe('adriano@example.com');

    state = applyContactExtractionToState(
      'Actually, please use adriano@caseloadselect.ca.',
      state,
    );

    expect(state.slots['client_email']).toBe('adriano@caseloadselect.ca');
    expect(state.slot_meta['client_email']?.source).toBe('explicit');
    expect(state.slot_meta['client_email']?.evidence ?? '').toContain(
      'corrected from',
    );
  });
});
