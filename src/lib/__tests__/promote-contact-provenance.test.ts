/**
 * Tests for promote-contact-provenance.ts (#137 phase 2 wiring, #139).
 *
 * Covers the operator's required phase-2 cases:
 *   - bot readback + caller "yes" confirms corrected name -> "Confirmed by caller"
 *   - bot asks to spell surname + caller spells -> "Spelled by caller"
 *   - later explicit correction without affirmation upgrades value but does
 *     NOT overclaim confirmation (detector 'none' -> unchanged)
 *   - caller-ID / system-metadata phone does NOT become "Confirmed by caller"
 *     unless explicitly read back and affirmed
 *   - unchanged repeated value does not churn provenance
 *   - non-contact facts are untouched
 */

import { describe, it, expect } from 'vitest';
import { promoteContactProvenance } from '../promote-contact-provenance';
import type { ResolvedFact } from '../screen-engine/types';

function facts(...f: ResolvedFact[]): ResolvedFact[] {
  return f;
}

describe('promoteContactProvenance', () => {
  it('promotes a name to confirmed_by_caller_after_readback on bot readback + affirmative', () => {
    const transcript = [
      'bot: Can I get your full name?',
      'human: Adriano Domingues.',
      'bot: Let me make sure I have your name right: Adriano Domingues. Is that correct?',
      'human: Yes, that is correct.',
    ].join('\n');

    const input = facts({ label: 'Name', value: 'Adriano Domingues', source: 'explicit_from_caller' });
    const out = promoteContactProvenance(input, transcript);

    expect(out[0].source).toBe('confirmed_by_caller_after_readback');
  });

  it('promotes a name to spelled_by_caller when the caller spells the surname', () => {
    const transcript = [
      'bot: Could you spell the surname for me?',
      'human: D O M I N G U E S',
    ].join('\n');

    const input = facts({ label: 'Name', value: 'Adriano Domingues', source: 'explicit_from_caller' });
    const out = promoteContactProvenance(input, transcript);

    expect(out[0].source).toBe('spelled_by_caller');
  });

  it('does NOT promote when there is a later correction but no clean affirmation (no overclaim)', () => {
    const transcript = [
      'bot: Let me make sure I have your name right: Adriano Dominguez. Is that correct?',
      'human: No, actually it is Domingues with an S.',
    ].join('\n');

    // The captured (corrected) value is the right one, but the transcript
    // shows a correction, not a confirmation. Must stay at the floor.
    const input = facts({ label: 'Name', value: 'Adriano Domingues', source: 'explicit_from_caller' });
    const out = promoteContactProvenance(input, transcript);

    expect(out[0].source).toBe('explicit_from_caller');
  });

  it('does NOT promote a caller-ID phone to confirmed unless it was read back and affirmed', () => {
    // Phone present in the call but the bot never reads it back + caller
    // never affirms. This is the caller-ID / system-metadata case.
    const transcript = [
      'bot: Are you calling about a new legal matter?',
      'human: Yes, I need help with a will.',
    ].join('\n');

    const input = facts({ label: 'Phone', value: '+16475492106', source: 'explicit_from_caller' });
    const out = promoteContactProvenance(input, transcript);

    expect(out[0].source).toBe('explicit_from_caller'); // floor, NOT confirmed
  });

  it('DOES promote a phone when it is read back digit-by-digit and affirmed', () => {
    const transcript = [
      "bot: I don't see your callback number. What's the best number to reach you?",
      'human: 6 4 7 5 4 9 2 1 0 6',
      'bot: Let me read that back: 647-549-2106. Is that correct?',
      'human: Correct.',
    ].join('\n');

    const input = facts({ label: 'Phone', value: '647-549-2106', source: 'explicit_from_caller' });
    const out = promoteContactProvenance(input, transcript);

    expect(out[0].source).toBe('confirmed_by_caller_after_readback');
  });

  it('leaves non-contact facts untouched even if the transcript has readback cues', () => {
    const transcript = [
      'bot: Just to make sure I have this right, you are looking for help with a will. Is that correct?',
      'human: Yes.',
    ].join('\n');

    const input = facts({
      label: 'Matter area',
      value: 'will and estate planning',
      source: 'inferred_from_transcript',
    });
    const out = promoteContactProvenance(input, transcript);

    // Matter area is not a contact fact; provenance is unchanged.
    expect(out[0].source).toBe('inferred_from_transcript');
  });

  it('never downgrades an already-confirmed fact', () => {
    const transcript = [
      'bot: Could you spell the surname?',
      'human: D O M I N G U E S',
    ].join('\n');

    // Fact is already at rank 5; detector only finds spelling (rank 4).
    // Must not downgrade.
    const input = facts({
      label: 'Name',
      value: 'Adriano Domingues',
      source: 'confirmed_by_caller_after_readback',
    });
    const out = promoteContactProvenance(input, transcript);

    expect(out[0].source).toBe('confirmed_by_caller_after_readback');
    // No change => same array reference returned (idempotent / no churn).
    expect(out).toBe(input);
  });

  it('returns the same array reference when nothing is promoted (no churn)', () => {
    const transcript = 'bot: Hello.\nhuman: I need a lawyer.';
    const input = facts({ label: 'Name', value: 'Adriano Domingues', source: 'explicit_from_caller' });
    const out = promoteContactProvenance(input, transcript);
    expect(out).toBe(input);
  });

  it('handles empty facts / empty transcript gracefully', () => {
    expect(promoteContactProvenance([], 'bot: hi')).toEqual([]);
    const input = facts({ label: 'Name', value: 'X Y', source: 'explicit_from_caller' });
    expect(promoteContactProvenance(input, '')).toBe(input);
    expect(promoteContactProvenance(null, 'bot: hi')).toEqual([]);
  });

  it('promotes multiple contact facts independently in one pass', () => {
    const transcript = [
      'bot: Let me make sure I have your name right: Maria Silva. Is that correct?',
      'human: Yes.',
      'bot: Let me read that back: 416-555-0143. Is that the best number?',
      'human: That is right.',
    ].join('\n');

    const input = facts(
      { label: 'Name', value: 'Maria Silva', source: 'explicit_from_caller' },
      { label: 'Phone', value: '416-555-0143', source: 'explicit_from_caller' },
      { label: 'Email', value: 'maria@example.com', source: 'explicit_from_caller' },
    );
    const out = promoteContactProvenance(input, transcript);

    expect(out[0].source).toBe('confirmed_by_caller_after_readback'); // name
    expect(out[1].source).toBe('confirmed_by_caller_after_readback'); // phone
    expect(out[2].source).toBe('explicit_from_caller'); // email never read back -> floor
  });
});
