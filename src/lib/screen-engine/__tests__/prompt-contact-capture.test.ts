/**
 * Engine system prompt — contact-capture rule (rule 9, doctrine 2026-05-15).
 *
 * This is a guard test: the prompt MUST tell the model to never finalise
 * an intake without name + (email | phone). If a future refactor strips
 * the rule, this test fails loudly.
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../llm/prompt';

describe('buildSystemPrompt — CONTACT-CAPTURE DOCTRINE', () => {
  const prompt = buildSystemPrompt();

  it('mentions the doctrine label explicitly', () => {
    expect(prompt).toMatch(/CONTACT-CAPTURE DOCTRINE/i);
  });

  it('names the three contact slots', () => {
    expect(prompt).toMatch(/client_name/);
    expect(prompt).toMatch(/client_email/);
    expect(prompt).toMatch(/client_phone/);
  });

  it('instructs the model to ask for name AND (email or phone)', () => {
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/at least one way to reach them/);
    expect(lower).toMatch(/email/);
    expect(lower).toMatch(/phone/);
  });

  it('forbids asking for opposing parties or documents', () => {
    expect(prompt.toLowerCase()).toMatch(/do not ask for documents/i);
    expect(prompt.toLowerCase()).toMatch(/opposing parties/i);
  });

  it('forbids finalising without contact', () => {
    expect(prompt.toLowerCase()).toMatch(/never finalise.*without these fields captured/i);
  });
});
