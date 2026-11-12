import { getI18n } from './i18n/loader';
import type { EngineState, SlotDefinition, LeadSummary } from './types';

/** Firm-configured disability-insurance intake. No medical or eligibility assessment. */
const choices = (values: string[]) => values.map(value => ({ value, label: value }));
const slot = (id: string, question: string, options?: string[], priority = 10): SlotDefinition => ({
  id, question, input_type: options ? 'single_select' : 'free_text', ...(options ? { options: choices(options) } : {}),
  applies_to: ['disability_benefits'], tier: 'core', question_group: 'generic', resolves: 'none',
  decision_value: 0, abstraction_level: 'concrete', required: true, priority,
});
export const DISABILITY_SLOTS: SlotDefinition[] = [
  slot('disability_benefit', 'Which benefit is your enquiry about?', ['Long-term disability insurance','Short-term disability insurance','An individual disability policy','A government benefit or another program','Not sure'], 10),
  slot('disability_status', 'What has happened with the disability-insurance claim?', ['Claim denied','Payments stopped','A decision is delayed','No decision yet','Not sure'], 11),
  slot('disability_dates', 'What date is on the insurer’s decision, and has the insurer mentioned any other date? Say if you do not know. Please leave out medical details.', undefined, 12),
  slot('disability_letter', 'Do you have a written decision from the insurer? Please do not upload it or paste its contents here.', ['Yes','No','Not sure'], 13),
  slot('disability_location', 'Where do you live?', ['Ontario','Outside Ontario','Not sure'], 14),
  slot('disability_counsel', 'Is a lawyer already representing you on this benefits matter?', ['No','Yes','Not sure'], 15),
  slot('disability_readiness', 'When would you like to speak with our team?', ['This week','Within the next month','Just exploring','Not sure'], 16),
  {...slot('disability_other_benefit', 'Which benefit or program is involved? Please leave out medical details.', undefined, 11), required: false},
];
export const DISABILITY_SLOT_ORDER = ['disability_benefit','disability_other_benefit',...DISABILITY_SLOTS.map(item=>item.id).filter(id=>!['disability_benefit','disability_other_benefit'].includes(id))];
export function disabilitySlotApplies(state: EngineState, id: string): boolean {
  if (state.matter_type !== 'disability_benefits') return true;
  const other = state.slots.disability_benefit === 'A government benefit or another program';
  if (id === 'disability_other_benefit') return other;
  if (other && ['disability_status','disability_dates','disability_letter'].includes(id)) return false;
  if (id === 'disability_dates' && ['A decision is delayed','No decision yet'].includes(state.slots.disability_status ?? '')) return false;
  return true;
}
export function configureDisabilityDemo(state: EngineState): EngineState {
  const enabled = {...state, disability_enabled: true, disability_only: true};
  // A health condition alone is not an insurance claim. An employment dispute
  // is not rerouted merely because its narrative mentions a disability.
  const signal = /\b(?:(?:long[ -]term|short[ -]term)\s+disability|disability\s+(?:benefits?|insurance|claim|payments?|policy)|(?:my|our)\s+(?:LTD|STD)\s+(?:claim|benefits?|payments?|insurance))\b/i.test(state.input);
  if (!signal) return enabled;
  return groundDisabilityFacts({...enabled, practice_area:'personal_injury', matter_type:'disability_benefits', intent_family:'unknown', dispute_family:'unknown', advisory_subtrack:'unknown'}, state.input);
}
/** Literal grounded observations only. Existing confirmed answers keep their evidence. */
export function groundDisabilityFacts(state: EngineState, text: string): EngineState {
  if (state.matter_type !== 'disability_benefits') return state;
  const facts: Record<string,string> = {};
  const clauses = text.split(/[.!?;\n]+/).map(part=>part.trim());
  const positive = (pattern: RegExp) => clauses.some(part=>pattern.test(part) && !/\b(?:not|no|never|without|unsure|maybe|might|whether)\b/i.test(part));
  if (positive(/\b(?:long[ -]term disability|LTD (?:benefit|claim|payment))/i)) facts.disability_benefit='Long-term disability insurance';
  else if (positive(/\b(?:short[ -]term disability|STD (?:benefit|claim|payment))/i)) facts.disability_benefit='Short-term disability insurance';
  else if (positive(/\bindividual disability (?:insurance |)policy\b/i)) facts.disability_benefit='An individual disability policy';
  if (positive(/\b(?:benefits?|payments?)\s+(?:(?:have|were|been|are)\s+)*(?:stopped|terminated|cut off)|\bstopped\s+(?:my |the |our )?(?:disability |benefit )?payments?\b/i)) facts.disability_status='Payments stopped';
  else if (positive(/\b(?:denied|refused|rejected)\b/i)) facts.disability_status='Claim denied';
  if (positive(/\b(?:i have|i received|i've received|we have|we received)\s+(?:a |the |an? insurer.s |written )*(?:decision|denial|letter)\b/i)) facts.disability_letter='Yes';
  if (positive(/\b(?:i|we) (?:live|reside|am based|are based) in (?:[a-z .'-]{0,35}, )?ontario\b/i)) facts.disability_location='Ontario';
  const slots={...state.slots}, slot_meta={...state.slot_meta};
  for (const [id,value] of Object.entries(facts)) {
    if (['answered','explicit'].includes(slot_meta[id]?.source ?? '')) continue;
    slots[id]=value;slot_meta[id]={source:'explicit',confidence:1,evidence:text.trim()};
  }
  return {...state,slots,slot_meta};
}
export function buildDisabilityRecap(state: EngineState): LeadSummary {
  const i18n=getI18n(state.language),copy=i18n.summary.disability_benefits;
  const paragraphs = state.input.trim() ? [copy.description.replace('{answer}',state.input.trim())] : [];
  const points: string[]=[];
  const templates: Record<string,string>={
    disability_benefit:'Your enquiry concerns {answer}.',disability_status:'You described the claim’s position as: {answer}.',
    disability_dates:'The dates you mentioned are: {answer}.',disability_letter:'When asked whether you have a written decision, you said: {answer}.',
    disability_location:'You gave your location as: {answer}.',disability_counsel:'When asked about current legal representation, you said: {answer}.',
    disability_readiness:'For a conversation with the team, you chose: {answer}.',disability_other_benefit:'You described the benefit or program as: {answer}.',
  };
  const details:string[]=[];
  for (const item of DISABILITY_SLOTS) {
    const value=state.slots[item.id];const meta=state.slot_meta[item.id];
    if (!value || !meta || !['answered','explicit'].includes(meta.source) || !disabilitySlotApplies(state,item.id)) continue;
    const answer=meta.evidence?.trim() || value;
    points.push(`${item.question} ${answer}`);
    if(answer!==state.input.trim()) details.push((i18n.recap_templates?.[item.id] || templates[item.id]).replace('{answer}',answer.replace(/[.!?]+$/,'')));
  }
  for(let i=0;i<details.length;i+=3) paragraphs.push(details.slice(i,i+3).join(' '));
  return {intro:copy.intro,points,paragraphs,closing:copy.closing};
}
