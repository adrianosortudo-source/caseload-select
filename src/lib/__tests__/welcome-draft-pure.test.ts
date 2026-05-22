import { describe, it, expect } from 'vitest';
import { buildWelcomeDraft } from '../welcome-draft-pure';

const baseInput = {
  primary_name: 'Adriano Dominguez',
  matter_type: 'wrongful_dismissal',
  practice_area: 'employment',
  firm_name: 'DRG Law',
  lead_lawyer_display_name: 'Damaris Guimaraes',
  lead_lawyer_title: 'Principal',
  portal_url: null,
};

describe('buildWelcomeDraft', () => {
  it('returns html, plain_text, and subject', () => {
    const draft = buildWelcomeDraft(baseInput);
    expect(draft.html).toBeTruthy();
    expect(draft.plain_text).toBeTruthy();
    expect(draft.subject).toBeTruthy();
  });

  it('uses first name from primary_name in the greeting', () => {
    const draft = buildWelcomeDraft(baseInput);
    expect(draft.html).toContain('Hi Adriano,');
    expect(draft.plain_text).toContain('Hi Adriano,');
  });

  it('falls back to "there" if primary_name is empty', () => {
    const draft = buildWelcomeDraft({ ...baseInput, primary_name: '' });
    expect(draft.html).toContain('Hi there,');
  });

  it('includes firm name in body', () => {
    const draft = buildWelcomeDraft(baseInput);
    expect(draft.html).toContain('DRG Law');
  });

  it('uses lead lawyer display_name + title for signature when both provided', () => {
    const draft = buildWelcomeDraft(baseInput);
    expect(draft.html).toContain('Damaris Guimaraes, Principal');
    expect(draft.plain_text).toContain('Damaris Guimaraes, Principal');
  });

  it('falls back to firm-team signature when no lead lawyer name', () => {
    const draft = buildWelcomeDraft({
      ...baseInput,
      lead_lawyer_display_name: null,
      lead_lawyer_title: null,
    });
    expect(draft.html).toContain('the DRG Law team');
  });

  it('omits title when only display_name is provided', () => {
    const draft = buildWelcomeDraft({
      ...baseInput,
      lead_lawyer_title: null,
    });
    expect(draft.html).toContain('Damaris Guimaraes');
    expect(draft.html).not.toContain(', null');
  });

  it('produces deterministic output for the same input', () => {
    const a = buildWelcomeDraft(baseInput);
    const b = buildWelcomeDraft(baseInput);
    expect(a.html).toBe(b.html);
    expect(a.plain_text).toBe(b.plain_text);
    expect(a.subject).toBe(b.subject);
  });

  it('matter-specific subject for wrongful_dismissal', () => {
    const draft = buildWelcomeDraft(baseInput);
    expect(draft.subject).toContain('employment matter');
  });

  it('matter-specific subject for will_drafting', () => {
    const draft = buildWelcomeDraft({ ...baseInput, matter_type: 'will_drafting' });
    expect(draft.subject).toContain('estates matter');
  });

  it('matter-specific subject for residential_purchase_sale', () => {
    const draft = buildWelcomeDraft({ ...baseInput, matter_type: 'residential_purchase_sale' });
    expect(draft.subject).toContain('real estate');
  });

  it('includes portal URL when provided', () => {
    const draft = buildWelcomeDraft({
      ...baseInput,
      portal_url: 'https://app.caseloadselect.ca/portal/123/m/456',
    });
    expect(draft.html).toContain('secure portal');
    expect(draft.html).toContain('app.caseloadselect.ca');
  });

  it('omits portal URL when not provided', () => {
    const draft = buildWelcomeDraft({ ...baseInput, portal_url: null });
    expect(draft.html).not.toContain('secure portal');
  });

  it('LSO 4.2-1: never uses banned superlatives', () => {
    const draft = buildWelcomeDraft(baseInput);
    const banned = ['specialist', 'expert', 'best', 'leading', 'premier', 'top', 'guarantee'];
    for (const word of banned) {
      expect(draft.html.toLowerCase()).not.toContain(word);
      expect(draft.plain_text.toLowerCase()).not.toContain(word);
    }
  });

  it('LSO 4.2-1: never asserts outcome', () => {
    const draft = buildWelcomeDraft(baseInput);
    const outcomeAssertions = ['we will win', 'guaranteed', 'you will get', 'certain to'];
    for (const phrase of outcomeAssertions) {
      expect(draft.html.toLowerCase()).not.toContain(phrase);
    }
  });

  it('escapes HTML in primary_name to prevent injection', () => {
    const draft = buildWelcomeDraft({
      ...baseInput,
      primary_name: '<script>alert("xss")</script>',
    });
    expect(draft.html).not.toContain('<script>');
    expect(draft.html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in firm_name', () => {
    const draft = buildWelcomeDraft({
      ...baseInput,
      firm_name: 'Evil <img onerror=alert(1)> Firm',
    });
    expect(draft.html).not.toContain('<img');
    expect(draft.html).toContain('&lt;img');
  });
});
