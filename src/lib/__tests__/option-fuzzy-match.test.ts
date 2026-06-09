/**
 * Typo-tolerant single_select option matcher (#174, 2026-06-09).
 *
 * Operator directive after the WhatsApp retest: "we must be able to
 * understand answers with minor typos." This locks the matcher's
 * behavior: it maps obvious answers (digit with junk, word-number,
 * sentinel, token-subset, near-miss spelling) and returns null on
 * ambiguity or genuine free-form text so the caller re-asks.
 */

import { describe, it, expect } from 'vitest';
import { fuzzyMatchOption } from '../option-fuzzy-match';
import type { SlotOption } from '../screen-engine/types';

const ADVISORY_PATH: SlotOption[] = [
  { value: 'Starting a new business', label: 'Starting a new business' },
  { value: 'Buying into an existing business', label: 'Buying into an existing business' },
  { value: 'Not sure', label: 'Not sure' },
];

const YES_NO: SlotOption[] = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
  { value: 'Not sure', label: 'Not sure' },
];

const CHILDREN: SlotOption[] = [
  { value: 'None', label: 'None' },
  { value: 'One', label: 'One' },
  { value: 'Two or three', label: 'Two or three' },
  { value: 'Four or more', label: 'Four or more' },
];

describe('fuzzyMatchOption: digit layer (leading-junk tolerant)', () => {
  it('maps a clean digit', () => {
    expect(fuzzyMatchOption('1', ADVISORY_PATH)).toBe('Starting a new business');
  });
  it('maps a backtick-prefixed digit', () => {
    expect(fuzzyMatchOption('`1', ADVISORY_PATH)).toBe('Starting a new business');
  });
  it('maps a quoted / spaced / dotted digit', () => {
    expect(fuzzyMatchOption(' 2. ', ADVISORY_PATH)).toBe('Buying into an existing business');
    expect(fuzzyMatchOption('Option 3', ADVISORY_PATH)).toBe('Not sure');
  });
  it('returns null for an out-of-range digit (caller re-asks)', () => {
    expect(fuzzyMatchOption('9', ADVISORY_PATH)).toBeNull();
    expect(fuzzyMatchOption('0', ADVISORY_PATH)).toBeNull();
  });
  it('does NOT map a digit buried in a sentence', () => {
    expect(fuzzyMatchOption('I pick 1 of them', ADVISORY_PATH)).toBeNull();
  });
});

describe('fuzzyMatchOption: word-number layer', () => {
  it('maps "one" / "two" / "three"', () => {
    expect(fuzzyMatchOption('one', ADVISORY_PATH)).toBe('Starting a new business');
    expect(fuzzyMatchOption('two', ADVISORY_PATH)).toBe('Buying into an existing business');
    expect(fuzzyMatchOption('three', ADVISORY_PATH)).toBe('Not sure');
  });
  it('maps ordinals "first" / "second"', () => {
    expect(fuzzyMatchOption('first', ADVISORY_PATH)).toBe('Starting a new business');
    expect(fuzzyMatchOption('Second', ADVISORY_PATH)).toBe('Buying into an existing business');
  });
  it('does not confuse a word-number with a label word ("One" option exists)', () => {
    // CHILDREN has an "One" option; "two" should still resolve by position-free
    // word match to the value "One"? No: word-number maps by POSITION. "one"
    // -> option index 1 -> "None". The label "One" is index 2. Position wins.
    expect(fuzzyMatchOption('1', CHILDREN)).toBe('None');
    expect(fuzzyMatchOption('2', CHILDREN)).toBe('One');
  });
});

describe('fuzzyMatchOption: sentinel layer', () => {
  it('maps yes / yeah / yep / sure to the Yes option', () => {
    expect(fuzzyMatchOption('yes', YES_NO)).toBe('Yes');
    expect(fuzzyMatchOption('yeah', YES_NO)).toBe('Yes');
    expect(fuzzyMatchOption('yep', YES_NO)).toBe('Yes');
    expect(fuzzyMatchOption('sure', YES_NO)).toBe('Yes');
  });
  it('maps no / nope / nah to the No option', () => {
    expect(fuzzyMatchOption('no', YES_NO)).toBe('No');
    expect(fuzzyMatchOption('nope', YES_NO)).toBe('No');
    expect(fuzzyMatchOption('nah', YES_NO)).toBe('No');
  });
  it('maps dont know / idk / not sure / maybe to the Not sure option', () => {
    expect(fuzzyMatchOption('dont know', YES_NO)).toBe('Not sure');
    expect(fuzzyMatchOption('idk', YES_NO)).toBe('Not sure');
    expect(fuzzyMatchOption('not sure', YES_NO)).toBe('Not sure');
    expect(fuzzyMatchOption('maybe', YES_NO)).toBe('Not sure');
  });
  it('does not invent a Yes option when none exists', () => {
    // ADVISORY_PATH has no Yes/No option; "yes" should not map.
    expect(fuzzyMatchOption('yes', ADVISORY_PATH)).toBeNull();
  });
});

describe('fuzzyMatchOption: token-subset layer', () => {
  it('maps "buying" to the Buying option', () => {
    expect(fuzzyMatchOption('buying', ADVISORY_PATH)).toBe('Buying into an existing business');
  });
  it('maps "new business" to the Starting option', () => {
    expect(fuzzyMatchOption('new business', ADVISORY_PATH)).toBe('Starting a new business');
  });
  it('maps "starting" to the Starting option', () => {
    expect(fuzzyMatchOption('starting', ADVISORY_PATH)).toBe('Starting a new business');
  });
});

describe('fuzzyMatchOption: edit-distance layer', () => {
  it('maps a misspelled full label', () => {
    expect(fuzzyMatchOption('startign a new busines', ADVISORY_PATH)).toBe('Starting a new business');
  });
  it('maps a lightly misspelled short label', () => {
    expect(fuzzyMatchOption('Buyin into an existing busines', ADVISORY_PATH)).toBe(
      'Buying into an existing business',
    );
  });
});

describe('fuzzyMatchOption: bails (caller re-asks) when unsure', () => {
  it('returns null on genuine free-form text', () => {
    expect(fuzzyMatchOption('what do you mean exactly', ADVISORY_PATH)).toBeNull();
    expect(fuzzyMatchOption('can you explain the options', ADVISORY_PATH)).toBeNull();
  });
  it('returns null on empty / whitespace', () => {
    expect(fuzzyMatchOption('', ADVISORY_PATH)).toBeNull();
    expect(fuzzyMatchOption('   ', ADVISORY_PATH)).toBeNull();
  });
  it('returns null when option set is empty', () => {
    expect(fuzzyMatchOption('1', [])).toBeNull();
  });
});
