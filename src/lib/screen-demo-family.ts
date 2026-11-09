import type { EngineState, PracticeArea } from "./screen-engine/types";

/** Opt-in only: retain the default firm classification for all other profiles. */
export function prepareFamilyDemoState(state: EngineState, configuredPracticeAreas: readonly PracticeArea[]): EngineState {
  if (!configuredPracticeAreas.includes("family")) return state;
  const familySignal = /\b(?:other parent|parenting|child custody|custody of (?:my|our|the) (?:child|children)|access to (?:my|our) (?:child|children|kids)|child support|spousal support|divorce|marital separation|family separation|separat(?:ed|ing) from my (?:spouse|husband|wife|partner)|family court|family lawyer|family law)\b/i.test(state.input);
  if (!familySignal) return state;
  return { ...state, practice_area: "family", matter_type: "family_general", intent_family: "unknown", dispute_family: "unknown", advisory_subtrack: "unknown", matter_type_provenance: "deterministic" };
}
