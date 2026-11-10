import { describe, it, expect } from 'vitest';
import { initialiseState } from '../extractor';
import { configureFirmPracticeAreas, groundFamilyConversationFacts } from '../family';
import { getExtractableSlots } from '../llm/schema';
import { mergeLlmResults } from '../llm/extractor';
import { applyAnswer, getNextStep, markInsightShown, startContactCapture } from '../control';
import { computeBand } from '../band';
import { buildReport } from '../report';

describe('opt-in family intake', () => {
  const phrase = 'my ex wife is not allowing me to see my kids';
  it('classifies semantically through the provider result only for the configured profile', () => {
    const baseline = initialiseState(phrase);
    expect(getExtractableSlots(baseline.matter_type, true).some(s => s.id === '__family_area')).toBe(true);
    expect(mergeLlmResults(baseline, { __family_area: 'family' })).toMatchObject({ matter_type: 'out_of_scope', practice_area: 'family' });
    expect(getExtractableSlots(baseline.matter_type).some(s => s.id === 'family_children')).toBe(false);
    const enabled = configureFirmPracticeAreas(baseline, ['family']);
    const classified = mergeLlmResults(enabled, { __family_area: 'family', family_help_sought: 'Parenting or decision-making', family_children: 'Yes', family_existing_order: 'Neither' });
    expect(classified.matter_type).toBe('family_general');
    expect(classified.slots.family_existing_order).toBeFalsy();
    const grounded = groundFamilyConversationFacts(classified, phrase);
    expect(grounded.slot_meta.family_children.source).toBe('explicit');
    expect(grounded.slot_meta.family_help_sought.source).toBe('explicit');
    expect(getNextStep(grounded).slot?.id).not.toBe('family_children');
    expect(computeBand(grounded).reasoning).toContain('no suitability score');
    const report = buildReport(grounded);
    expect(report).toMatchObject({ intake_only: true, lawyer_time_priority: 'Firm review required', fee_estimate: 'Not assessed', risk_flags: [], cross_sell_opportunities: [] });
  });
  it('grounds two facts from one follow-up without inventing absence from silence', () => {
    const state = configureFirmPracticeAreas(initialiseState('I need a family lawyer for custody.'), ['family']);
    const updated = groundFamilyConversationFacts(state, 'There is no court order or written agreement. There is no upcoming court date.');
    expect(updated.slots.family_existing_order).toBe('Neither');
    expect(updated.slots.family_timing).toMatch(/no upcoming court date/i);
    expect(updated.slot_meta.family_timing.source).toBe('explicit');
  });
  it('updates an earlier explicit fact when the person corrects it', () => {
    let state = configureFirmPracticeAreas(initialiseState('I need a family lawyer for custody.'), ['family']);
    state = groundFamilyConversationFacts(state, 'I have no children.');
    state = groundFamilyConversationFacts(state, 'Actually my son is involved.');
    expect(state.slots.family_children).toBe('Yes');
    expect(state.slot_meta.family_children.evidence).toContain('Actually');
  });
  for (const [channel, limit] of [['sms', 3], ['gbp', 5]] as const) {
    it(`${channel} reaches insight at its substantive budget and proceeds to contact`, () => {
      let state: ReturnType<typeof initialiseState> = { ...configureFirmPracticeAreas(initialiseState('I need a family lawyer for custody.'), ['family']), channel };
      for (let i = 0; i < limit; i++) {
        const step = getNextStep(state);
        expect(step.type).toBe('continue');
        state = applyAnswer(state, step.slot!.id, step.slot!.options?.[0]?.value ?? 'No date scheduled');
      }
      expect(getNextStep(state).type).toBe('present_insight');
      state = startContactCapture(markInsightShown(state));
      expect(getNextStep(state).type).toBe('capture_contact');
    });
  }
  it('sends clearly unrelated business matters to referral while leaving default behavior unchanged', () => {
    const state = initialiseState('A customer has not paid my business invoice.');
    expect(configureFirmPracticeAreas(state, [])).toBe(state);
    expect(configureFirmPracticeAreas(state, ['family']).matter_type).toBe('out_of_scope');
    expect(configureFirmPracticeAreas(state, ['family', 'corporate']).matter_type).toBe(state.matter_type);
  });
});
