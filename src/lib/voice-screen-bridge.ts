/**
 * Pure, inactive bridge policy. Not an HTTP endpoint, sender or persistence layer.
 * A future authenticated adapter must supply CURRENT-CALL evidence, never stale
 * contact fields. Its transaction must create the human task and claim callId
 * before enqueueing one invitation. This planner does not provide idempotency.
 */
export interface VoiceScreenCall {
  callId: string;
  locationId: string;
  agentId: string;
  endedAt: string;
  callerType: "new" | "existing" | "other" | "unknown";
  urgency: "urgent" | "routine" | "unknown";
  humanRequested: boolean;
  callback: { number: string; verifiedOnCallId: string };
  permission: { value: "granted" | "declined" | "unknown"; callId: string; capturedAt: string };
  safeToText: { value: "yes" | "no" | "unknown"; callId: string };
}

export interface VoiceScreenScope { locationId: string; agentId: string }

export function planVoiceScreenCall(call: VoiceScreenCall, scope: VoiceScreenScope) {
  if (call.locationId !== scope.locationId || call.agentId !== scope.agentId || !call.callId) {
    return { accept: false, humanTask: false, invitationEligible: false, reason: "outside_test_scope" } as const;
  }
  const currentProof = call.permission.callId === call.callId && call.safeToText.callId === call.callId && call.callback.verifiedOnCallId === call.callId;
  const ended = Date.parse(call.endedAt);
  const captured = Date.parse(call.permission.capturedAt);
  const validTime = Number.isFinite(ended) && Number.isFinite(captured) && captured <= ended && ended - captured <= 60 * 60 * 1000;
  const eligible = currentProof && validTime && call.permission.value === "granted" && call.safeToText.value === "yes" && /^\+[1-9]\d{7,14}$/.test(call.callback.number) && call.callerType === "new" && call.urgency === "routine" && !call.humanRequested;
  return { accept: true, humanTask: true, invitationEligible: eligible, reason: eligible ? "eligible_pending_durable_claim" : "human_follow_up_only" } as const;
}
