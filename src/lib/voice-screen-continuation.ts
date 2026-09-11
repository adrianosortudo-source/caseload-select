import { initialiseState } from "./screen-engine/extractor";
import { runEvidencePass } from "./screen-engine/slotEvidence";
import { applyAnswer, getNextStep } from "./screen-engine/control";
import { computeBand } from "./screen-engine/band";
import { computeCoreCompleteness, getDecisionGap } from "./screen-engine/selector";
import type { EngineState } from "./screen-engine/types";

/** Browser-safe domain logic shared by the caller API and independent tests. */
export interface ContinuationCallFacts {
  callerName: string;
  broadNeed: string;
  callback: { number: string };
  capturedSlots: Record<string, string>;
}

export interface ContinuationAnswer {
  question: string;
  answer: string;
  source: "screen";
  at: string;
}

export interface ContinuationView {
  revision: number;
  status: string;
  question: { id: string; text: string; options: Array<{ value: string; label: string }> } | null;
}

export interface ContinuationPayload {
  revision: number;
  slotId?: string;
  value?: string;
  skip?: boolean;
  finish?: boolean;
}

export interface ContinuationSession {
  state: EngineState;
  answers: ContinuationAnswer[];
  status: string;
  revision: number;
}

export class ContinuationError extends Error {
  constructor(public readonly code: "invalid_answer" | "refresh_required", public readonly status: 400 | 409) {
    super(code);
    this.name = "ContinuationError";
  }
}

export function scoreContinuationState(state: EngineState): EngineState {
  const band = computeBand(state);
  return { ...state, band: band.band, confidence: band.confidence, coreCompleteness: computeCoreCompleteness(state), currentGap: getDecisionGap(state) };
}

export function seedContinuationState(call: ContinuationCallFacts): EngineState {
  let state = runEvidencePass(call.broadNeed, initialiseState(call.broadNeed));
  for (const [slot, value] of Object.entries(call.capturedSlots)) state = applyAnswer(state, slot, value);
  if (call.callerName) state = applyAnswer(state, "client_name", call.callerName);
  if (call.callback.number) state = applyAnswer(state, "client_phone", call.callback.number);
  return scoreContinuationState({ ...state, questionHistory: [], contactCaptureStarted: false });
}

export function continuationView(state: EngineState, revision: number, status: string): ContinuationView {
  const next = getNextStep(state);
  // The caller contract excludes facts, scores, engine state and lawyer reports.
  return {
    revision,
    status,
    question: status === "completed" || status === "stopped" || !next.slot ? null : {
      id: next.slot.id,
      text: next.slot.question,
      options: (next.slot.options ?? []).map(option => ({ value: option.value, label: option.label })),
    },
  };
}

/** Validate and apply one answer identically in production and segment tests. */
export function transitionContinuation(session: ContinuationSession, payload: unknown, now = new Date().toISOString()): ContinuationSession {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ContinuationError("invalid_answer", 400);
  const body = payload as ContinuationPayload;
  if (!Number.isInteger(body.revision) || (body.skip !== undefined && typeof body.skip !== "boolean") ||
      (body.finish !== undefined && typeof body.finish !== "boolean") ||
      Object.keys(body).some(key => !["revision", "slotId", "value", "skip", "finish"].includes(key))) {
    throw new ContinuationError("invalid_answer", 400);
  }
  if (body.finish === true && (body.slotId !== undefined || body.value !== undefined || body.skip !== undefined)) {
    throw new ContinuationError("invalid_answer", 400);
  }
  if (body.revision !== session.revision || session.status === "completed" || session.status === "stopped") {
    throw new ContinuationError("refresh_required", 409);
  }
  let state = session.state;
  const answers = [...session.answers];
  if (body.finish !== true) {
    const next = getNextStep(state);
    if (!next.slot || body.slotId !== next.slot.id || typeof body.value !== "string" || body.value.length > 1500 || (!body.skip && !body.value.trim())) {
      throw new ContinuationError("invalid_answer", 400);
    }
    const value = body.skip ? "Not sure" : body.value.trim();
    if (!body.skip && next.slot.options?.length && !next.slot.options.some(option => option.value === value)) {
      throw new ContinuationError("invalid_answer", 400);
    }
    state = scoreContinuationState(applyAnswer(state, next.slot.id, value));
    answers.push({ question: next.slot.question, answer: body.skip ? "Skipped by caller" : value, source: "screen", at: now });
  }
  return { state, answers, status: body.finish ? "completed" : "partial", revision: session.revision + 1 };
}
