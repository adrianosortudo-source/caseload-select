/**
 * Tests for readback-detection.ts (#137 phase 2 core).
 *
 * Fixtures use the real transcript shapes from the 2026-06-02 DRG voice
 * smoke calls: bot reads a value back, caller affirms (or corrects), and
 * the caller spells a surname. The detector must distinguish:
 *   - a clean readback + affirmative   -> confirmed_after_readback (rank 5)
 *   - a caller spelling the value out  -> spelled_by_caller        (rank 4)
 *   - a "yes, but actually..." trap    -> none (it's a correction)
 *   - the value merely appearing once  -> none
 */

import { describe, it, expect } from 'vitest';
import {
  detectReadbackConfirmation,
  parseTranscriptTurns,
  extractReadbackConfirmedName,
  recoverNameIfMissing,
} from '../readback-detection';

describe('parseTranscriptTurns', () => {
  it('splits bot/human turns and attaches continuation lines', () => {
    const t = 'bot: Thanks for calling.\nbot: How can I help?\nhuman: I need a will.';
    const turns = parseTranscriptTurns(t);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({ speaker: 'bot', text: 'Thanks for calling.' });
    expect(turns[2]).toEqual({ speaker: 'human', text: 'I need a will.' });
  });

  it('maps assistant/agent->bot and user/caller->human', () => {
    const t = 'assistant: Hi.\nuser: Hello.\nagent: Ok.\ncaller: Sure.';
    const turns = parseTranscriptTurns(t);
    expect(turns.map((x) => x.speaker)).toEqual(['bot', 'human', 'bot', 'human']);
  });

  it('returns empty array for empty / non-string input', () => {
    expect(parseTranscriptTurns('')).toEqual([]);
    // @ts-expect-error testing runtime guard
    expect(parseTranscriptTurns(null)).toEqual([]);
  });
});

describe('detectReadbackConfirmation - confirmed_after_readback (rank 5)', () => {
  it('detects bot name readback + clean caller affirmative', () => {
    const transcript = [
      'bot: Can I get your full name?',
      'human: Adriano Domingues.',
      'bot: Let me make sure I have your name right: Adriano Domingues. Is that correct?',
      'human: Yes, that is correct.',
    ].join('\n');
    const result = detectReadbackConfirmation(transcript, 'Adriano Domingues');
    expect(result.kind).toBe('confirmed_after_readback');
    expect(result.evidence).toContain('Adriano Domingues');
  });

  it('detects a digit-by-digit phone readback + affirmative', () => {
    const transcript = [
      "bot: I don't see your callback number on this call. What's the best number to reach you?",
      'human: 6 4 7 5 4 9 2 1 0 6',
      'bot: Let me read that back: 647-549-2106. Is that correct?',
      'human: Correct.',
    ].join('\n');
    const result = detectReadbackConfirmation(transcript, '647-549-2106');
    expect(result.kind).toBe('confirmed_after_readback');
  });

  it('accepts "perfect" / "exactly" as affirmatives', () => {
    const transcript = [
      'bot: Have your name right: Maria Silva. Is that right?',
      'human: Exactly.',
    ].join('\n');
    expect(detectReadbackConfirmation(transcript, 'Maria Silva').kind).toBe(
      'confirmed_after_readback',
    );
  });
});

describe('detectReadbackConfirmation - spelled_by_caller (rank 4)', () => {
  it('detects letter-by-letter spelling (spaces)', () => {
    const transcript = [
      'bot: Could you spell the surname for me?',
      'human: D O M I N G U E S',
    ].join('\n');
    const result = detectReadbackConfirmation(transcript, 'Domingues');
    expect(result.kind).toBe('spelled_by_caller');
    expect(result.evidence).toContain('D O M I N G U E S');
  });

  it('detects hyphenated spelling', () => {
    const transcript = [
      'bot: Could you spell that?',
      'human: D-O-M-I-N-G-U-E-S',
    ].join('\n');
    expect(detectReadbackConfirmation(transcript, 'Domingues').kind).toBe(
      'spelled_by_caller',
    );
  });

  it('detects phonetic spelling ("D as in David, ...")', () => {
    const transcript = [
      'bot: Could you spell the surname?',
      'human: D as in David, O as in Oscar, E as in Echo, S as in Sierra',
    ].join('\n');
    expect(detectReadbackConfirmation(transcript, 'Does').kind).toBe(
      'spelled_by_caller',
    );
  });

  it('does not treat a 3-letter incidental run as spelling', () => {
    const transcript = [
      'bot: What is your name?',
      'human: I work at the U S A office downtown.',
    ].join('\n');
    expect(detectReadbackConfirmation(transcript, 'Domingues').kind).toBe('none');
  });
});

describe('detectReadbackConfirmation - correction traps return none', () => {
  it('"Yes, but actually it is Domingues" is a correction, not a confirmation', () => {
    const transcript = [
      'bot: Let me make sure I have your name right: Adriano Dominguez. Is that correct?',
      'human: Yes, but actually it is Domingues with an S.',
    ].join('\n');
    // The bot read back the WRONG value (Dominguez); the caller corrected it.
    // Must NOT report Dominguez as confirmed.
    const result = detectReadbackConfirmation(transcript, 'Adriano Dominguez');
    expect(result.kind).toBe('none');
  });

  it('"the last letter is s" disqualifies the affirmative', () => {
    const transcript = [
      'bot: So that is D O M I N G U E Z. Is that correct?',
      'human: No, the last letter is s.',
    ].join('\n');
    expect(detectReadbackConfirmation(transcript, 'Dominguez').kind).toBe('none');
  });
});

describe('detectReadbackConfirmation - none cases', () => {
  it('value appearing once with no readback cue is not confirmed', () => {
    const transcript = [
      'bot: Can I get your full name?',
      'human: Adriano Domingues.',
      'bot: Thanks. What is going on?',
    ].join('\n');
    expect(detectReadbackConfirmation(transcript, 'Adriano Domingues').kind).toBe(
      'none',
    );
  });

  it('readback cue present but value absent is not confirmed', () => {
    const transcript = [
      'bot: Let me make sure I have your postal code right: M5T 1B3. Is that correct?',
      'human: Yes.',
    ].join('\n');
    // Asking about a name value the bot never read back.
    expect(detectReadbackConfirmation(transcript, 'Adriano Domingues').kind).toBe(
      'none',
    );
  });

  it('readback cue + value, but caller never answers, is not confirmed', () => {
    const transcript = [
      'bot: Have your name right: Adriano Domingues. Is that correct?',
      'bot: Hello? Are you still there?',
    ].join('\n');
    expect(detectReadbackConfirmation(transcript, 'Adriano Domingues').kind).toBe(
      'none',
    );
  });

  it('empty value or transcript returns none', () => {
    expect(detectReadbackConfirmation('', 'x').kind).toBe('none');
    expect(detectReadbackConfirmation('bot: hi', '').kind).toBe('none');
  });
});

describe('detectReadbackConfirmation - precedence', () => {
  it('returns confirmed_after_readback when BOTH readback-confirm and spelling are present', () => {
    const transcript = [
      'bot: Could you spell the surname?',
      'human: D O M I N G U E S',
      'bot: Let me make sure I have your name right: Adriano Domingues. Is that correct?',
      'human: Yes.',
    ].join('\n');
    // Rank 5 (confirmed) beats rank 4 (spelled).
    expect(detectReadbackConfirmation(transcript, 'Adriano Domingues').kind).toBe(
      'confirmed_after_readback',
    );
  });
});

describe('extractReadbackConfirmedName (#122 name recovery)', () => {
  it('recovers a name from "name as X ... is that correct?" + clean affirmative', () => {
    const transcript = [
      'bot: I have your name as Adriano Domingues, is that correct?',
      'human: Yes.',
    ].join('\n');
    const out = extractReadbackConfirmedName(transcript);
    expect(out?.value).toBe('Adriano Domingues');
  });

  it('recovers from "your name is X. did I get that right?"', () => {
    const transcript = [
      'bot: So your name is Sarah Chen. Did I get that right?',
      'human: Correct.',
    ].join('\n');
    expect(extractReadbackConfirmedName(transcript)?.value).toBe('Sarah Chen');
  });

  it('stops the name span at the readback cue / trailing clause', () => {
    const transcript = [
      'bot: Let me confirm, I have your name as John Smith and you are calling about a will. Is that correct?',
      'human: Yes that is right.',
    ].join('\n');
    // "and you are calling about a will" must not be absorbed into the name.
    expect(extractReadbackConfirmedName(transcript)?.value).toBe('John Smith');
  });

  it('returns null when the caller corrects instead of confirming', () => {
    const transcript = [
      'bot: I have your name as John Smith, is that correct?',
      'human: No, it is actually John Smithe.',
    ].join('\n');
    expect(extractReadbackConfirmedName(transcript)).toBeNull();
  });

  it('returns null when the bot states the name without a readback cue', () => {
    const transcript = [
      'bot: Thanks, your name is John Smith.',
      'human: Yes.',
    ].join('\n');
    expect(extractReadbackConfirmedName(transcript)).toBeNull();
  });

  it('returns null when there is no clean affirmative after the readback', () => {
    const transcript = [
      'bot: I have your name as John Smith, is that correct?',
      'human: Well, I have a question about fees first.',
    ].join('\n');
    expect(extractReadbackConfirmedName(transcript)).toBeNull();
  });

  it('does not mistake a matter readback for a name', () => {
    const transcript = [
      'bot: So your matter is about a wrongful dismissal, is that correct?',
      'human: Yes.',
    ].join('\n');
    expect(extractReadbackConfirmedName(transcript)).toBeNull();
  });

  it('returns null for an empty or speakerless transcript', () => {
    expect(extractReadbackConfirmedName('')).toBeNull();
    expect(extractReadbackConfirmedName('just some text with no turns')).toBeNull();
  });

  it('caps the recovered name at four tokens', () => {
    const transcript = [
      'bot: I have your name as Maria Isabel De La Cruz Rodriguez Garcia, is that correct?',
      'human: Yes.',
    ].join('\n');
    const out = extractReadbackConfirmedName(transcript);
    expect(out).not.toBeNull();
    expect(out!.value.split(' ').length).toBeLessThanOrEqual(4);
  });
});

describe('recoverNameIfMissing (#122 wiring invariant)', () => {
  const transcript = [
    'bot: I have your name as Priya Venkatesan, is that correct?',
    'human: Yes.',
  ].join('\n');

  it('recovers the confirmed readback name when the slot is empty', () => {
    expect(recoverNameIfMissing(null, transcript)).toBe('Priya Venkatesan');
    expect(recoverNameIfMissing('', transcript)).toBe('Priya Venkatesan');
    expect(recoverNameIfMissing('   ', transcript)).toBe('Priya Venkatesan');
  });

  it('NEVER overwrites a name the engine already captured', () => {
    // Even with a different confirmed name in the transcript, a present slot
    // wins. This is the safety invariant: the fallback must not clobber.
    expect(recoverNameIfMissing('Existing Name', transcript)).toBeNull();
  });

  it('returns null when the slot is empty but there is no confirmed readback', () => {
    expect(recoverNameIfMissing(null, 'human: I need help with a will.')).toBeNull();
  });
});
