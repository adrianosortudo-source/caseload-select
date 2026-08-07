import { describe, it, expect } from 'vitest';
import {
  buildOptionMapSystemPrompt,
  buildOptionMapUserPrompt,
  parseOptionMapResponse,
  isValidOptionValue,
  type OptionMapOption,
} from '../llm-option-map-pure';

const OPTIONS: OptionMapOption[] = [
  { value: 'Starting a new business', label: 'Starting a new business' },
  { value: 'Buying into an existing business', label: 'Buying into an existing business' },
  { value: 'Not sure', label: 'Not sure' },
];

describe('buildOptionMapSystemPrompt', () => {
  it('instructs the model to return null on ambiguity, never invent a value', () => {
    const prompt = buildOptionMapSystemPrompt();
    expect(prompt).toMatch(/return null/i);
    expect(prompt).toMatch(/never invent/i);
    expect(prompt).toMatch(/strict JSON/i);
  });
});

describe('buildOptionMapUserPrompt', () => {
  it('includes the question, every option, and the reply', () => {
    const prompt = buildOptionMapUserPrompt({
      questionLabel: 'Are you starting something new, or buying into an existing business?',
      options: OPTIONS,
      reply: 'just getting it off the ground from scratch',
      language: 'en',
    });
    expect(prompt).toContain('Are you starting something new');
    for (const o of OPTIONS) {
      expect(prompt).toContain(o.label);
      expect(prompt).toContain(o.value);
    }
    expect(prompt).toContain('just getting it off the ground from scratch');
  });
});

describe('parseOptionMapResponse', () => {
  it('parses a valid value', () => {
    expect(parseOptionMapResponse('{"value":"Starting a new business"}')).toEqual({
      value: 'Starting a new business',
    });
  });

  it('parses an explicit null', () => {
    expect(parseOptionMapResponse('{"value":null}')).toEqual({ value: null });
  });

  it('returns null on malformed JSON', () => {
    expect(parseOptionMapResponse('not json at all')).toEqual({ value: null });
  });

  it('returns null when the shape is missing the value key', () => {
    expect(parseOptionMapResponse('{"foo":"bar"}')).toEqual({ value: null });
  });

  it('returns null when value is present but not a string', () => {
    expect(parseOptionMapResponse('{"value":42}')).toEqual({ value: null });
  });

  it('returns null for an empty string value', () => {
    expect(parseOptionMapResponse('{"value":""}')).toEqual({ value: null });
  });
});

describe('isValidOptionValue', () => {
  it('accepts a value present in the option list', () => {
    expect(isValidOptionValue('Not sure', OPTIONS)).toBe(true);
  });

  it('rejects a value not present in the option list (the membership guard)', () => {
    expect(isValidOptionValue('Something invented', OPTIONS)).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidOptionValue(null, OPTIONS)).toBe(false);
  });
});
