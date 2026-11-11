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

const firstWillInquiry = 'I live in Kingston, Ontario and want to prepare my first will. I am married with two adult children, own our family home and have Canadian bank accounts. I have no existing will and no assets or business outside Canada.';

describe('will preparation lexical routing', () => {
  it.each(['auto', 'estates'] as const)('routes the first-will request to will drafting with %s practice area selection', selection => {
    const initial = initialiseState(firstWillInquiry);
    const state = selection === 'estates'
      ? configureFirmPracticeAreas(initial, ['estates'])
      : initial;

    expect(state).toMatchObject({ practice_area: 'estates', matter_type: 'will_drafting' });
    expect(state.input).toBe(firstWillInquiry);
    expect(state.raw.mentions_property).toBe(true);
    expect(state.raw.mentions_money).toBe(true);
  });

  it('does not let a selected estates profile override an ordinary home purchase', () => {
    const purchase = 'I am buying my first home in Kingston and need a lawyer for the closing.';
    const state = configureFirmPracticeAreas(initialiseState(purchase), ['estates']);
    expect(state).toMatchObject({ practice_area: 'real_estate', matter_type: 'residential_purchase_sale' });
  });

  it('does not treat modal will as a will-planning request', () => {
    const result = classify('The bank will send the account documents next week.');
    expect(result.practice_area).not.toBe('estates');
    expect(result.matter_type).not.toBe('will_drafting');
    expect(classify('I need to prepare a willingness statement for my employer.').practice_area).not.toBe('estates');
  });

  it('does not turn a negated will request into will drafting', () => {
    const result = classify('I do not want to prepare my first will.');
    expect(result.practice_area).not.toBe('estates');
    expect(result.matter_type).not.toBe('will_drafting');
  });

  it('keeps process uncertainty as a will-planning request', () => {
    const result = classify('I am not sure how to prepare my first will, and I own our family home.');
    expect(result).toMatchObject({ practice_area: 'estates', matter_type: 'will_drafting' });
  });

  it('keeps parenting matters in family when the firm has the family pack enabled', () => {
    const text = 'I need a family lawyer about custody and parenting arrangements. We own a family home.';
    const state = configureFirmPracticeAreas(initialiseState(text), ['family', 'real_estate', 'estates']);
    expect(state).toMatchObject({ practice_area: 'family', matter_type: 'family_general' });
  });
});
