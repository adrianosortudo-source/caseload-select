import { describe, expect, it } from 'vitest';
import { initialiseState } from '../extractor';
import { configureFirmPracticeAreas, groundFamilyConversationFacts } from '../family';
import { applyAnswer, buildLeadSummary } from '../control';
import { getI18n } from '../i18n/loader';
import type { EngineState } from '../types';

const opening = 'My ex-wife is not allowing me to see our son. We both live in Ontario. I need help with parenting time.';
function initial(): EngineState {
  const base = configureFirmPracticeAreas(initialiseState(opening), ['family']);
  return { ...base, matter_type: 'family_general', practice_area: 'family',
    slots: { ...base.slots, family_help_sought: 'Parenting or decision-making' },
    slot_meta: { ...base.slot_meta, family_help_sought: { source: 'llm_inferred', confidence: 0.9 } } };
}

describe('family request evidence across follow-up answers', () => {
  it.each(['explicit', 'answered'] as const)('retains %s request evidence when an agreement reply also mentions parenting', source => {
    const base = groundFamilyConversationFacts(initial(), opening);
    base.slot_meta.family_help_sought = { ...base.slot_meta.family_help_sought, source };
    const answered = applyAnswer(base, 'family_existing_order', 'Written agreement');
    const next = groundFamilyConversationFacts(answered, 'We have a written parenting agreement, but no court order.');
    expect(next.slots.family_help_sought).toBe('Parenting or decision-making');
    expect(next.slot_meta.family_help_sought.evidence).toBe(opening);
    expect(next.slots.family_existing_order).toBe('Written agreement');
    const recap = buildLeadSummary(next, getI18n('en')).paragraphs!.join(' ');
    expect(recap).toContain(opening);
    expect(recap).toContain('written agreement');
    expect(recap).not.toContain('About the help you need, you told us:');
  });

  it('still grounds a proposed request from the original description', () => {
    const next = groundFamilyConversationFacts(initial(), opening);
    expect(next.slot_meta.family_help_sought).toMatchObject({ source: 'explicit', evidence: opening });
  });

  it('continues recording a literal court date without changing the request quote', () => {
    const base = groundFamilyConversationFacts(initial(), opening);
    const next = groundFamilyConversationFacts(base, 'My case conference is on December 15, 2026.');
    expect(next.slot_meta.family_help_sought.evidence).toBe(opening);
    expect(next.slots.family_timing).toContain('December 15, 2026');
  });
});

it('quotes the original opener once after details are appended while keeping its structured facts', () => {
  const grounded = groundFamilyConversationFacts(initial(), opening);
  const next = { ...grounded, input: opening + ' I would also like to discuss holiday parenting arrangements.' };
  const summary = buildLeadSummary(next, getI18n('en'));
  const prose = summary.paragraphs!.join(' ');
  expect(prose.split(opening)).toHaveLength(2);
  expect(prose).toContain('holiday parenting arrangements');
  expect(prose).not.toContain('About the help you need, you told us:');
  expect(summary.points!.some(point => /Help requested:/i.test(point))).toBe(true);
  expect(summary.points!.join(' ')).toContain(opening);
});