import { describe, expect, it } from 'vitest';
import { classify, initialiseState } from '../extractor';
import { configureFirmPracticeAreas } from '../family';

describe('estates plural descriptions', () => {
  it('routes wills and powers of attorney despite home ownership context', () => {
    const text = 'My partner and I want to prepare wills and powers of attorney. We own a home in Ontario and have two young children. We have not made wills before.';
    expect(classify(text)).toMatchObject({ practice_area: 'estates', matter_type: 'power_of_attorney' });
  });
  it('recognizes plural wills and powers of attorney independently', () => {
    expect(classify('We want to prepare wills.').practice_area).toBe('estates');
    expect(classify('We need powers of attorney.').practice_area).toBe('estates');
  });
  it('keeps a home purchase in real estate', () => {
    expect(classify('I signed an agreement to buy a condo in Ottawa and need help closing.').practice_area).toBe('real_estate');
    expect(classify('I need a lawyer for closing on a house on Willson Avenue.').practice_area).toBe('real_estate');
    expect(classify('My business operates a goodwill shop.').practice_area).not.toBe('estates');
  });
  it('keeps family intake in the family pack', () => {
    const state = configureFirmPracticeAreas(initialiseState('I need a family lawyer about custody.'), ['family']);
    expect(state).toMatchObject({ practice_area: 'family', matter_type: 'family_general' });
  });
});
