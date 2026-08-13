/**
 * Direct unit coverage for channel-intake-intro.ts (2026-08-07).
 *
 * Added alongside the PT localisation pass: the C2/C3 build shipped
 * these four functions with English-only fallbacks and no direct test
 * of the i18n lookup path itself (only indirect coverage via mocked
 * processChannelInbound tests, which never exercise a non-English
 * language). This file proves both halves for every function: the
 * English fallback (no widget_strings entry in en.json, so the literal
 * IS the canonical English text) and the real PT lookup.
 */

import { describe, it, expect } from 'vitest';
import {
  firstAskIntro,
  describeSituationFirstAsk,
  contactCaptureFirstAsk,
  withFirstAskIntro,
} from '../channel-intake-intro';

describe('firstAskIntro', () => {
  it('English: returns the literal fallback', () => {
    expect(firstAskIntro('en')).toBe(
      'Thanks for reaching out. So a lawyer can review your situation, I will ask a few short questions. You can reply with the number of an option or answer in your own words.',
    );
  });

  it('Portuguese: returns the real pt.json translation, not the English fallback', () => {
    const text = firstAskIntro('pt');
    expect(text).not.toBe(firstAskIntro('en'));
    expect(text).toContain('Obrigado por entrar em contato');
    expect(text).toMatch(/advogado/);
  });
});

describe('describeSituationFirstAsk', () => {
  it('English: returns the literal fallback', () => {
    expect(describeSituationFirstAsk('en')).toBe(
      'To start, could you describe in a sentence or two what your situation is about?',
    );
  });

  it('Portuguese: returns the real pt.json translation', () => {
    const text = describeSituationFirstAsk('pt');
    expect(text).not.toBe(describeSituationFirstAsk('en'));
    expect(text).toContain('Para começar');
    expect(text).toMatch(/\?$/);
  });
});

describe('contactCaptureFirstAsk', () => {
  it('English: all three variants return their literal fallback', () => {
    expect(contactCaptureFirstAsk('name', 'en')).toBe(
      'First, what name should the firm use when they reach out?',
    );
    expect(contactCaptureFirstAsk('reachability', 'en')).toBe(
      "First, what's the best phone or email for the firm to reach you?",
    );
    expect(contactCaptureFirstAsk('both', 'en')).toBe(
      'First, could you share your name and the best phone or email for the firm to reach you?',
    );
  });

  it('Portuguese: all three variants return real translations, distinct from each other and from English', () => {
    const name = contactCaptureFirstAsk('name', 'pt');
    const reachability = contactCaptureFirstAsk('reachability', 'pt');
    const both = contactCaptureFirstAsk('both', 'pt');

    expect(name).toContain('Primeiro');
    expect(reachability).toContain('Primeiro');
    expect(both).toContain('Primeiro');

    expect(name).not.toBe(contactCaptureFirstAsk('name', 'en'));
    expect(reachability).not.toBe(contactCaptureFirstAsk('reachability', 'en'));
    expect(both).not.toBe(contactCaptureFirstAsk('both', 'en'));

    // The three variants are not identical to each other (each asks for
    // something different — a real risk with template-composed copy).
    expect(new Set([name, reachability, both]).size).toBe(3);
  });
});

describe('withFirstAskIntro', () => {
  it('composes intro + blank line + body, in the requested language', () => {
    const composed = withFirstAskIntro('en', 'What is your name?');
    expect(composed).toBe(
      'Thanks for reaching out. So a lawyer can review your situation, I will ask a few short questions. You can reply with the number of an option or answer in your own words.\n\nWhat is your name?',
    );
  });

  it('Portuguese: composes the PT intro with a PT body', () => {
    const body = describeSituationFirstAsk('pt');
    const composed = withFirstAskIntro('pt', body);
    expect(composed.startsWith('Obrigado por entrar em contato')).toBe(true);
    expect(composed).toContain(body);
    // Exactly one blank-line separator, matching the EN composition shape.
    expect(composed.split('\n\n').length).toBe(2);
  });
});
