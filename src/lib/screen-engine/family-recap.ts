import { getI18n, type I18nBundle } from './i18n/loader';

export interface FamilyRecapFact {
  id: string;
  value: string;
  answer: string;
}

const SENTENCES: Record<string, Record<string, string>> = {
  family_help_sought: {
    'Parenting or decision-making': 'help_parenting',
    'Child or spousal support': 'help_support',
    'Separation or divorce': 'help_separation',
    'Agreement or court order': 'help_order',
    'Other family issue': 'help_other',
    'Not sure': 'help_unsure',
  },
  family_children: { Yes: 'children_yes', No: 'children_no', 'Not sure': 'children_unsure' },
  family_existing_order: {
    'Court order': 'order_court', 'Written agreement': 'order_agreement',
    Both: 'order_both', Neither: 'order_neither', 'Not sure': 'order_unsure',
  },
  family_jurisdiction: { Ontario: 'location_ontario', 'Outside Ontario': 'location_outside', 'Not sure': 'location_unsure' },
  hiring_timeline: {
    'Now (this week)': 'timeline_week', 'Within the next 30 days': 'timeline_month',
    'Within the next few months': 'timeline_months', 'Just exploring, no timeline yet': 'timeline_exploring',
    'As soon as possible': 'timeline_soon', 'Not sure': 'timeline_unsure',
  },
  other_counsel: {
    No: 'counsel_first', 'No, you are the first': 'counsel_first',
    'Yes, I am comparing options': 'counsel_comparing',
    'Yes, switching from a previous lawyer': 'counsel_switching', 'Not sure': 'counsel_unsure',
  },
  decision_authority: {
    'Just me': 'decision_self', 'Me with a partner or family member': 'decision_shared',
    'Multiple owners or directors': 'decision_multiple', 'Someone else decides': 'decision_other',
    'Not sure': 'decision_unsure',
  },
};

/** Restates supplied facts only. Raw details stay in the person's own words. */
export function buildFamilyRecapParagraphs(input: string, facts: readonly FamilyRecapFact[], i18n: I18nBundle): string[] {
  const copy = i18n.summary?.family_general ?? {};
  const fallback = getI18n('en').summary.family_general;
  const text = (key: string, answer = '') => {
    const quoted = answer && !/[.!?…]["'”’)\]]*$/.test(answer) ? answer + '.' : answer;
    return (copy['prose_' + key] || fallback['prose_' + key]).replace('{text}', quoted);
  };
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  const isCanonical = (fact: FamilyRecapFact) => fact.answer === fact.value || fact.answer === (i18n.slot_options?.[fact.id]?.[fact.value] || fact.value);
  const sentence = (id: string): string => {
    const fact = byId.get(id);
    if (!fact) return '';
    if (id === 'family_timing') {
      const answer = fact.answer.trim();
      if (/^(?:no|none|nope|não|nao|nenhum)[.!]?$/i.test(answer)) return text('timing_none');
      if (/^(?:not sure|i(?:'m| am) not sure|i (?:do not|don't) know|don't know|unknown|não sei|nao sei|não tenho certeza)[.!]?$/i.test(answer)) return text('timing_unsure');
      return text('detail_' + id, answer);
    }
    const key = SENTENCES[id]?.[fact.value];
    // A normalized choice must not replace extra detail or an uncertain raw reply.
    return key && isCanonical(fact) ? text(key) : text('detail_' + id, fact.answer);
  };
  const context: string[] = input.trim() ? [text('description', input.trim())] : [];
  const help = byId.get('family_help_sought');
  const children = byId.get('family_children');
  if (help?.value === 'Parenting or decision-making' && children?.value === 'Yes' && isCanonical(help) && isCanonical(children)) {
    context.push(text('help_parenting_children'));
  } else context.push(sentence('family_help_sought'), sentence('family_children'));
  const circumstances = ['family_existing_order', 'family_timing', 'family_jurisdiction'].map(sentence);
  const readiness = [sentence('hiring_timeline')];
  const counsel = byId.get('other_counsel');
  const decision = byId.get('decision_authority');
  if (counsel && ['No', 'No, you are the first'].includes(counsel.value) && decision?.value === 'Just me' && isCanonical(counsel) && isCanonical(decision)) {
    readiness.push(text('first_and_self'));
  } else readiness.push(sentence('other_counsel'), sentence('decision_authority'));
  return [context, circumstances, readiness].map(group => group.filter(Boolean).join(' ')).filter(Boolean);
}
