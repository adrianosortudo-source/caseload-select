import { describe, expect, it } from 'vitest';
import { initialiseState } from '../extractor';
import { configureFirmPracticeAreas } from '../family';
import { applyAnswer, buildLeadSummary, getBridgeTextI18n } from '../control';
import { getI18n } from '../i18n/loader';
import type { EngineState } from '../types';

const inquiry = 'my ex wife does not allow me to see my kids';
const answers = { family_help_sought: 'Parenting or decision-making', family_children: 'Yes', family_existing_order: 'Written agreement', family_timing: 'no', family_jurisdiction: 'Ontario', hiring_timeline: 'Now (this week)', other_counsel: 'No, you are the first', decision_authority: 'Just me' };
function state(): EngineState {
  return { ...configureFirmPracticeAreas(initialiseState(inquiry), ['family']), matter_type: 'family_general', practice_area: 'family' };
}
function complete(): EngineState { return Object.entries(answers).reduce((s, [id, value]) => applyAnswer(s, id, value), state()); }
const recap = (s: EngineState) => buildLeadSummary(s, getI18n(s.language)).paragraphs!.join(' ');

describe('conversational family recap', () => {
  it('turns the supplied example into a connected account while retaining the structured facts', () => {
    const summary = buildLeadSummary(complete(), getI18n('en'));
    expect(summary.paragraphs).toHaveLength(3);
    expect(summary.points).toHaveLength(9);
    const prose = summary.paragraphs!.join(' ');
    for (const fact of [inquiry, 'parenting arrangements', 'involving the children', 'written agreement', 'no upcoming court date or deadline', 'Ontario', 'this week', "haven't spoken with another lawyer", "you'll decide whether to hire one"]) expect(prose).toContain(fact);
    expect(prose).not.toMatch(/Your description:|Children involved:|Hiring decision:|Help requested:/);
    expect(prose).not.toMatch(/will receive|contacted|legal merit|recommend/);
  });

  it('does not turn missing facts or AI guesses into claims', () => {
    const s = state();
    s.slots.family_existing_order = 'Neither';
    s.slot_meta.family_existing_order = { source: 'llm_inferred', confidence: 0.9 };
    s.slots.family_jurisdiction = 'Ontario';
    s.slot_meta.family_jurisdiction = { source: 'unknown', confidence: 0 };
    const prose = recap(s);
    expect(prose).toContain(inquiry);
    expect(prose).not.toMatch(/written agreement|court order|Ontario|this week|haven't spoken/);
  });

  it('keeps explicit uncertainty separate from negative answers', () => {
    let s = state();
    for (const id of Object.keys(answers)) s = applyAnswer(s, id, 'Not sure');
    const prose = recap(s);
    expect(prose).toContain("not sure whether there's an existing written agreement or court order");
    expect(prose).toContain('not sure about an upcoming court date or deadline');
    expect(prose).not.toContain("there's no written agreement");
    expect(prose).not.toContain("there's no upcoming court date");
  });

  it('preserves raw details such as ages and separate locations', () => {
    const s = complete();
    s.slot_meta.family_children.evidence = 'My daughter is 6 and my son is 9.';
    s.slot_meta.family_jurisdiction.evidence = 'I live in Toronto and my children are in Ottawa.';
    const prose = recap(s);
    expect(prose).toContain('My daughter is 6 and my son is 9.');
    expect(prose).toContain('I live in Toronto and my children are in Ottawa.');
    expect(s.slots.family_children).toBe('Yes');
    expect(s.slots.family_jurisdiction).toBe('Ontario');
  });

  it('does not replace an uncertain raw reply with a definite normalized claim', () => {
    const s = complete();
    s.slots.family_existing_order = 'Neither';
    s.slot_meta.family_existing_order.evidence = 'Not sure';
    const prose = recap(s);
    expect(prose).toContain('Not sure');
    expect(prose).not.toContain("there's no written agreement or court order");
  });

  it.each(['November 20, 2026', 'No court date yet, but I have a filing deadline on Friday.'])(
    'keeps the exact timing detail without reading no into %s', answer => {
      const prose = recap(applyAnswer(complete(), 'family_timing', answer));
      expect(prose).toContain(answer);
      expect(prose).not.toContain("there's no upcoming court date or deadline");
    },
  );

  it('uses the same conversational account in the channel bridge', () => {
    const s = complete();
    const summary = buildLeadSummary(s, getI18n('en'));
    for (const paragraph of summary.paragraphs!) expect(getBridgeTextI18n(s, getI18n('en'))).toContain(paragraph);
    expect(getBridgeTextI18n(s, getI18n('en'))).not.toContain('Existing order or agreement:');
  });

  it('uses the existing Portuguese bundle and retains the original description', () => {
    const s = { ...complete(), language: 'pt' as const, input: 'Minha ex-esposa não me deixa ver meus filhos.' };
    const prose = recap(s);
    expect(prose).toContain(s.input);
    expect(prose).toContain('Você tem um acordo por escrito.');
    expect(prose).toContain('ainda nesta semana');
    expect(prose).not.toContain('You told us');
  });

  it('adds a grounded recap for another practice area', () => {
    const s = { ...initialiseState('A customer owes my company an unpaid invoice.'), matter_type: 'unpaid_invoice' as const, practice_area: 'corporate' as const };
    expect(buildLeadSummary(s, getI18n('en')).paragraphs?.join(' ')).toContain(s.input);
  });
});
