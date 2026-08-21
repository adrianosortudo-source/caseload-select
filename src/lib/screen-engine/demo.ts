import { computeBand } from "./band";
import { applyAnswer } from "./control";
import { initialiseState } from "./extractor";
import { buildReport } from "./report";
import { getDecisionGap, computeCoreCompleteness } from "./selector";
import { runEvidencePass } from "./slotEvidence";
import type { EngineState, LawyerReport } from "./types";

/**
 * Local-only adapter for the Screen demonstration.
 *
 * This deliberately uses the deterministic Screen engine only. It never
 * invokes extraction, checkpoint, contact, consent, submit, or persistence
 * code. A demo report exists only in the current browser state.
 */
export function scoreDemoState(state: EngineState): EngineState {
  const band = computeBand(state);
  return {
    ...state,
    band: band.band,
    confidence: band.confidence,
    coreCompleteness: computeCoreCompleteness(state),
    currentGap: getDecisionGap(state),
  };
}

export function startDemoState(fictionalSituation: string): EngineState {
  const initial = initialiseState(fictionalSituation.trim());
  return scoreDemoState(runEvidencePass(fictionalSituation, initial));
}

export function answerDemoState(
  state: EngineState,
  slotId: string,
  value: string | string[],
): EngineState {
  const normalized = Array.isArray(value) ? value.join(", ") : value;
  return scoreDemoState(applyAnswer(state, slotId, normalized));
}

export function buildDemoReport(state: EngineState): LawyerReport {
  return buildReport(scoreDemoState(state));
}
