import type { DemoRoutingArea, EngineState, MatterType } from './types';
import { classificationForMatterType, extractRawSignals, initialiseState } from './extractor';
import { SLOT_REGISTRY } from './slotRegistry';

const GENERAL: Record<DemoRoutingArea, MatterType> = {
  corporate: 'corporate_general', real_estate: 'real_estate_general',
  employment: 'employment_general', estates: 'estates_general', family: 'family_general',
};

function classification(area: DemoRoutingArea) {
  return classificationForMatterType(GENERAL[area]);
}

function pruneToMatter(state: EngineState): EngineState {
  const valid = new Set(SLOT_REGISTRY.filter(slot => slot.applies_to.includes(state.matter_type as never)).map(slot => slot.id));
  return { ...state,
    slots: Object.fromEntries(Object.entries(state.slots).filter(([id]) => valid.has(id))),
    slot_meta: Object.fromEntries(Object.entries(state.slot_meta).filter(([id]) => valid.has(id))),
    slot_evidence: Object.fromEntries(Object.entries(state.slot_evidence).filter(([id]) => valid.has(id))) };
}

export function startDemoRouting(state: EngineState, selection: DemoRoutingArea | 'auto'): EngineState {
  const detected = state.practice_area;
  const specific = state.matter_type !== 'unknown' && state.matter_type !== 'out_of_scope' && !state.matter_type.endsWith('_general');
  const route = selection === 'auto' ? classificationForMatterType('unknown') :
    detected === selection && state.matter_type !== 'unknown' && state.matter_type !== 'out_of_scope' &&
      classificationForMatterType(state.matter_type).practice_area === selection ? {} : classification(selection);
  let result = pruneToMatter({ ...state, ...route, ...(selection === 'auto' || detected !== selection ? { raw: extractRawSignals('') } : {}), family_enabled: true, family_only: false,
    demoRouting: { selection, candidate: null, pending: null, revision: 0, declinedCandidate: null } });
  if (specific && ['corporate', 'real_estate', 'employment', 'estates', 'family'].includes(detected)) {
    result = proposePracticeArea(result, detected as DemoRoutingArea);
  }
  return result;
}

export function proposePracticeArea(state: EngineState, candidate: DemoRoutingArea | null): EngineState {
  const routing = state.demoRouting;
  if (!routing || !candidate) return state;
  if (candidate === state.practice_area) return { ...state, demoRouting: { ...routing, candidate: null, pending: null } };
  if (candidate === routing.declinedCandidate) return state;
  return { ...state, demoRouting: { ...routing, candidate,
    pending: state.practice_area === 'unknown' ? 'confirmation' : 'conflict' } };
}

export function resolvePracticeArea(state: EngineState, accept: boolean): EngineState {
  const routing = state.demoRouting;
  if (!routing?.pending || !routing.candidate) return state;
  const candidate = routing.candidate;
  if (!accept) return { ...state, raw: extractRawSignals(''), demoRouting: { ...routing, candidate: null, pending: null, declinedCandidate: candidate, revision: routing.revision + 1 } };
  const fresh = initialiseState(state.input);
  return pruneToMatter({ ...fresh, ...classification(candidate), raw: extractRawSignals(''), family_enabled: true, family_only: false,
    channel: state.channel, language: state.language, lead_id: state.lead_id,
    submitted_at: state.submitted_at,
    demoRouting: { ...routing, candidate: null, pending: null, declinedCandidate: null, revision: routing.revision + 1 } });
}
