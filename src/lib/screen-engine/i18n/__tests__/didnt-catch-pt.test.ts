/**
 * PT localisation of the sticky-clarifier copy (2026-08-07). The English
 * source was softened as part of C3 (LLM option-mapping fallback) — the
 * clarifier now fires only after BOTH the deterministic adapters AND the
 * LLM fallback have failed, so the old "Sorry, I didn't get your last
 * reply" apology no longer matches what actually happened. pt.json's
 * value had to be updated too: without this, a PT lookup would always
 * win over the (now-changed) English fallback, so a Portuguese-speaking
 * lead would keep seeing the OLD tone forever while English speakers got
 * the new one. See docs/BUILD_PLAN_channel_intake_intro_optionmap_v1.md.
 */

import { describe, it, expect } from 'vitest';
import ptBundle from '../pt.json';

describe('widget_strings.didnt_catch (pt.json)', () => {
  const label = (ptBundle as { widget_strings: Record<string, string> }).widget_strings
    .didnt_catch;

  it('exists and is a non-empty string', () => {
    expect(typeof label).toBe('string');
    expect(label.trim().length).toBeGreaterThan(0);
  });

  it('matches the softened tone (confirmation-framed, not an apology)', () => {
    expect(label.toLowerCase()).not.toContain('desculpe');
    expect(label.toLowerCase()).not.toContain('não consegui entender');
  });

  it('still asks for a numbered reply, matching the English source\'s intent', () => {
    expect(label.toLowerCase()).toMatch(/número/);
  });

  it('contains no em dashes (brand rule)', () => {
    expect(label).not.toContain('—');
  });
});
