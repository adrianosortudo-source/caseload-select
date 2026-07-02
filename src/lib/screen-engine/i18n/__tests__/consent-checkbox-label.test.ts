/**
 * Covers the CASL consent checkbox label on ScreenEnginePublicWidget's
 * contact-capture screen: this was the only remaining hardcoded-English
 * string in that component, found while verifying the widget's i18n
 * wiring is complete. The component reads this key via ws() and
 * substitutes {firmName} the same way done_body_template does.
 */

import { describe, it, expect } from 'vitest';
import ptBundle from '../pt.json';

describe('widget_strings.consent_checkbox_label (pt.json)', () => {
  const label = (ptBundle as { widget_strings: Record<string, string> }).widget_strings
    .consent_checkbox_label;

  it('exists and is a non-empty string', () => {
    expect(typeof label).toBe('string');
    expect(label.trim().length).toBeGreaterThan(0);
  });

  it('contains exactly one {firmName} placeholder', () => {
    const matches = label.match(/\{firmName\}/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('substitutes cleanly, matching the component replace pattern', () => {
    const substituted = label.replace(/\{firmName\}/g, 'DRG Law');
    expect(substituted).toContain('DRG Law');
    expect(substituted).not.toMatch(/\{firmName\}/);
    expect(substituted).not.toMatch(/[{}]/);
  });
});
