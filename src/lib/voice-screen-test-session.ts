import { buildReport } from "./screen-engine/report";
import type { LawyerReport } from "./screen-engine/types";
import { FICTIONAL_CALL } from "./voice-screen-demo";
import {
  continuationView, seedContinuationState, transitionContinuation,
  type ContinuationAnswer, type ContinuationSession,
} from "./voice-screen-continuation";

export interface VoiceScreenTestSnapshot {
  facts: typeof FICTIONAL_CALL;
  answers: ContinuationAnswer[];
  status: string;
  revision: number;
  report: LawyerReport;
}

/**
 * Independent test session using the exact caller qualification engine.
 * Data lives only in this instance: no network, storage, SMS or CRM writes.
 */
export function createVoiceScreenTestSession() {
  const facts = structuredClone(FICTIONAL_CALL);
  function initial(): ContinuationSession {
    return {
      state: seedContinuationState({
        callerName: facts.name,
        broadNeed: facts.situation,
        callback: { number: facts.phone },
        capturedSlots: facts.capturedSlots,
      }),
      answers: [],
      revision: 0,
      status: "open",
    };
  }
  let session = initial();
  function getView() { return continuationView(session.state, session.revision, session.status); }
  return {
    getView,
    save(payload: unknown) {
      session = transitionContinuation(session, payload);
      return getView();
    },
    reset() {
      session = initial();
      return getView();
    },
    getAnswers() { return structuredClone(session.answers); },
    getReport() { return structuredClone(buildReport(session.state)); },
    getSnapshot(): VoiceScreenTestSnapshot {
      return structuredClone({
        facts,
        answers: session.answers,
        status: session.status,
        revision: session.revision,
        report: buildReport(session.state),
      });
    },
  };
}

export type VoiceScreenTestSession = ReturnType<typeof createVoiceScreenTestSession>;
