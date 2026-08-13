/**
 * SlotOption.description + getOptionDescription (WP-5, 2026-08-13).
 *
 * Field case 2026-08-07: "What kind of business are you planning to
 * start?" offered "Professional services" / "Retail or storefront" /
 * etc with no examples. A lead formalising a home-cleaning business
 * could not map their own situation onto a category label. This pins
 * the descriptions on business_activity_type and the i18n fallback
 * cascade getOptionDescription uses (mirrors getOptionDisplayLabel's
 * existing cascade).
 */
import { describe, it, expect } from 'vitest';
import { SLOT_REGISTRY } from '../slotRegistry';
import { getOptionDescription } from '../i18n/display';
import { getI18n } from '../i18n/loader';

describe('business_activity_type option descriptions', () => {
  const slot = SLOT_REGISTRY.find((s) => s.id === 'business_activity_type')!;

  it('every non-"Not sure" option has a short description', () => {
    for (const opt of slot.options ?? []) {
      if (opt.value === 'Not sure') continue;
      expect(opt.description, `missing description for "${opt.value}"`).toBeTruthy();
      expect(opt.description!.length).toBeLessThan(60);
    }
  });

  it('"Not sure" deliberately has no description (nothing to exemplify)', () => {
    const notSure = slot.options!.find((o) => o.value === 'Not sure')!;
    expect(notSure.description).toBeUndefined();
  });

  it('getOptionDescription returns the English description verbatim for language=en', () => {
    const opt = slot.options!.find((o) => o.value === 'Professional services')!;
    const result = getOptionDescription(opt, slot.id, 'en', getI18n('en'));
    expect(result).toBe(opt.description);
  });

  it('getOptionDescription falls back to the English description when no PT translation exists', () => {
    const opt = slot.options!.find((o) => o.value === 'Professional services')!;
    const result = getOptionDescription(opt, slot.id, 'pt', getI18n('pt'));
    expect(result).toBe(opt.description);
  });

  it('getOptionDescription returns undefined for an option with no description at all', () => {
    const notSure = slot.options!.find((o) => o.value === 'Not sure')!;
    expect(getOptionDescription(notSure, slot.id, 'en', getI18n('en'))).toBeUndefined();
  });
});
