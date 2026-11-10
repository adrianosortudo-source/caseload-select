import { describe, expect, it } from 'vitest';
import { initialiseState } from '../extractor';
import { configureFirmPracticeAreas, groundFamilyConversationFacts } from '../family';
import { applyAnswer, buildLeadSummary, getBridgeTextI18n, getNextStep } from '../control';
import { getI18n } from '../i18n/loader';
import type { Channel, EngineState } from '../types';

const inquiry = 'my ex wife wont let me see the kids';
const answers = {
  family_help_sought: 'Parenting or decision-making',
  family_children: 'Yes',
  family_existing_order: 'Neither',
  family_timing: 'No upcoming court date',
  family_jurisdiction: 'Ontario',
  hiring_timeline: 'As soon as possible',
  other_counsel: 'No',
  decision_authority: 'Just me',
};
function familyState(): EngineState {
  return { ...configureFirmPracticeAreas(initialiseState(inquiry), ['family']),
    matter_type: 'family_general', practice_area: 'family' };
}
function completed(): EngineState {
  return Object.entries(answers).reduce((state, [id, value]) => applyAnswer(state, id, value), familyState());
}

describe('family case recap', () => {
  it('shows the original inquiry and every screening answer rather than a generic acknowledgement', () => {
    const summary = buildLeadSummary(completed(), getI18n('en'));
    expect(summary.intro).toBe('Family law case recap');
    expect(summary.points).toHaveLength(9);
    expect(summary.points[0]).toBe('Your description: ' + inquiry);
    for (const [id, value] of Object.entries(answers)) {
      const display = getI18n('en').slot_options[id]?.[value] || value;
      expect(summary.points.some(point => point.endsWith(': ' + display))).toBe(true);
    }
    expect(summary.closing).toMatch(/check.*accurate/i);
  });

  it.each<Channel>(['web', 'whatsapp', 'sms', 'instagram', 'facebook', 'gbp', 'voice'])(
    'delivers the same supplied case facts in the %s bridge',
    channel => {
      const state = { ...completed(), channel };
      const step = getNextStep(state);
      expect(step.type).toBe('present_insight');
      expect(step.bridgeText).toContain(inquiry);
      expect(step.bridgeText).toContain('no written agreement or court order');
      expect(step.bridgeText).toContain('No upcoming court date');
      expect(step.bridgeText).toContain('Ontario');
    },
  );

  it('does not invent facts from missing answers or present AI guesses as confirmed', () => {
    const state = familyState();
    state.slots.family_existing_order = 'Neither';
    state.slot_meta.family_existing_order = { source: 'llm_inferred', confidence: 0.5 };
    expect(buildLeadSummary(state, getI18n('en')).points).toEqual(['Your description: ' + inquiry]);
  });

  it('preserves explicit uncertainty instead of converting it to a negative', () => {
    const state = applyAnswer(familyState(), 'family_existing_order', 'Not sure');
    expect(buildLeadSummary(state, getI18n('en')).points).toContain('Existing order or agreement: Not sure');
  });

  it('preserves additional free-text answer details alongside the canonical screening value', () => {
    const state = applyAnswer(completed(), 'family_jurisdiction', 'Ontario');
    state.slot_meta.family_jurisdiction.evidence = 'I live in Toronto and my children are in Ottawa.';
    expect(buildLeadSummary(state, getI18n('en')).points).toContain(
      'Location: I live in Toronto and my children are in Ottawa.',
    );
    expect(state.slots.family_jurisdiction).toBe('Ontario');
  });

  it('reflects a new date without losing the original description or earlier answers', () => {
    const state = completed();
    const addendum = 'Our case conference is scheduled for December 9, 2026.';
    const updated = groundFamilyConversationFacts({ ...state, input: state.input + ' ' + addendum }, addendum);
    const points = buildLeadSummary(updated, getI18n('en')).points;
    expect(points[0]).toContain(inquiry);
    expect(points[0]).toContain(addendum);
    expect(points.find(point => point.startsWith('Court date or deadline:'))).toContain('December 9, 2026');
    expect(points.find(point => point.startsWith('Court date or deadline:'))).not.toContain('No upcoming');
    expect(points).toContain('Existing order or agreement: Neither');
    expect(points).toContain('Location: Ontario');
    expect(updated.questionHistory).toEqual(state.questionHistory);
  });

  it('uses the same full recap in the internationalized bridge path', () => {
    const state = completed();
    const text = getBridgeTextI18n(state, getI18n('en'));
    for (const paragraph of buildLeadSummary(state, getI18n('en')).paragraphs!) expect(text).toContain(paragraph);
  });
});
