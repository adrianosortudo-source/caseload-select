import type { EngineState, PracticeArea } from "./screen-engine/types";
import { configureFirmPracticeAreas } from "./screen-engine/family";
export function prepareFamilyDemoState(state: EngineState, areas: readonly PracticeArea[]): EngineState {
  return configureFirmPracticeAreas(state, areas);
}
