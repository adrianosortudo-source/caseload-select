import { describe, it, expect } from 'vitest';
import { initialiseState } from '../extractor';
import { configureFirmPracticeAreas, groundFamilyConversationFacts, groundFamilyOrderReplies } from '../family';
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
  it('grounds explicitly requested family help without treating uncertainty or silence as confirmation', () => {
    const cases = [
      ['I need help collecting unpaid child support.', 'Child or spousal support'],
      ['I want a divorce.', 'Separation or divorce'],
      ['I need help drafting a separation agreement.', 'Agreement or court order'],
    ];
    for (const [text, category] of cases) {
      const initial = configureFirmPracticeAreas(initialiseState(text), ['family']);
      const proposed = mergeLlmResults({ ...initial, matter_type: 'family_general', practice_area: 'family' }, { family_help_sought: category });
      const grounded = groundFamilyConversationFacts(proposed, text);
      expect(grounded.slot_meta.family_help_sought).toMatchObject({ source: 'explicit', evidence: text });
      expect(getNextStep(grounded).slot?.id).not.toBe('family_help_sought');
      expect(buildReport(grounded).matter_snapshot).toContain(`Person's original description: ${text}`);
    }
    for (const text of ['Maybe I need help with child support.', 'I do not want help with child support.', 'Child support has not been paid.']) {
      const initial = configureFirmPracticeAreas(initialiseState(text), ['family']);
      const proposed = mergeLlmResults({ ...initial, matter_type: 'family_general', practice_area: 'family' }, { family_help_sought: 'Child or spousal support' });
      const grounded = groundFamilyConversationFacts(proposed, text);
      expect(grounded.slot_meta.family_help_sought?.source).toBe('llm_inferred');
      expect(getNextStep(grounded).slot?.id).toBe('family_help_sought');
    }
  });
  it('grounds two facts from one follow-up without inventing absence from silence', () => {
    const state = configureFirmPracticeAreas(initialiseState('I need a family lawyer for custody.'), ['family']);
    const updated = groundFamilyConversationFacts(state, 'There is no court order or written agreement. There is no upcoming court date.');
    expect(updated.slots.family_existing_order).toBe('Neither');
    expect(updated.slots.family_timing).toMatch(/no upcoming court date/i);
    expect(updated.slot_meta.family_timing.source).toBe('explicit');
  });
  it('grounds only a consistent two-reply order answer', () => {
    const state = configureFirmPracticeAreas(initialiseState('I need a family lawyer for custody.'), ['family']);
    const partials = ['There is no court order that I know of.', 'There is no written agreement either.'];
    const grounded = groundFamilyOrderReplies(state, partials);
    expect(grounded.slots.family_existing_order).toBe('Neither');
    expect(grounded.slot_meta.family_existing_order).toMatchObject({ source: 'explicit', evidence: partials.join('\n') });
    expect(groundFamilyOrderReplies(state, [partials[0], 'There is a court order and no written agreement.']).slots.family_existing_order).toBeFalsy();
    expect(groundFamilyOrderReplies(state, [partials[0]]).slots.family_existing_order).toBeFalsy();
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
