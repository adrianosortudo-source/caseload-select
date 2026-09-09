import { answerDemoState, startDemoState } from "./screen-demo";
import { getNextStep } from "./screen-engine/control";
import type { EngineState } from "./screen-engine/types";

export const FICTIONAL_CALL = {
  name: "Alex Morgan",
  phone: "+1 416-555-0142",
  situation: "I own a small Toronto design studio. A client has not paid a $28,000 invoice for completed work. The invoice was due two weeks ago and the client now disputes the scope.",
  deadline: "No immediate deadline reported",
};

export type InquiryPermission = "unknown" | "granted" | "declined";

/** No transport or persistence. Permission gates the simulated handoff only. */
export function canContinueDemo(permission: InquiryPermission, callerType: string, safeToText: boolean) {
  return permission === "granted" && callerType === "new" && safeToText;
}

export function seedCallState(): EngineState {
  let state = startDemoState(FICTIONAL_CALL.situation);
  state = answerDemoState(state, "client_name", FICTIONAL_CALL.name);
  state = answerDemoState(state, "client_phone", FICTIONAL_CALL.phone);
  // Contact was captured by voice. Do not activate the web contact-form stop gate.
  return { ...state, contactCaptureStarted: false };
}

/** The unchanged Screen selector decides which remaining question comes next. */
export function nextContinuationStep(state: EngineState) {
  return getNextStep(state);
}
