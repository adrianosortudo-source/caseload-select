import { describe, expect, it } from "vitest";
import { canContinueDemo, nextContinuationStep, seedCallState } from "../voice-screen-demo";
import { answerDemoState } from "../screen-demo";
import { planVoiceScreenCall, type VoiceScreenCall } from "../voice-screen-bridge";

describe("parallel Voice to Screen", () => {
  it("never repeats captured contact and advances through remaining questions", () => {
    let state = seedCallState();
    expect(state.slots.client_name).toBe("Alex Morgan");
    expect(state.slots.client_phone).toBe("+1 416-555-0142");
    expect(state.slots.amount_at_stake).toBe("$25,000–$100,000");
    const asked = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const next = nextContinuationStep(state);
      if (!next.slot) break;
      expect(["client_name", "client_phone", "client_email", "amount_at_stake", "invoice_exists", "payment_status", "dispute_reason"]).not.toContain(next.slot.id);
      expect(asked.has(next.slot.id)).toBe(false);
      asked.add(next.slot.id);
      state = answerDemoState(state, next.slot.id, next.slot.options?.[0]?.value ?? "not_sure");
    }
    expect(asked.size).toBeGreaterThan(0);
    expect(asked.size).toBeLessThan(20);
  });
  it("requires explicit permission and a new inquiry for simulated SMS", () => {
    expect(canContinueDemo("granted", "new", true)).toBe(true);
    expect(canContinueDemo("granted", "new", false)).toBe(false);
    expect(canContinueDemo("unknown", "new", true)).toBe(false);
    expect(canContinueDemo("declined", "new", true)).toBe(false);
    expect(canContinueDemo("granted", "urgent", true)).toBe(false);
    expect(canContinueDemo("granted", "existing", true)).toBe(false);
  });
  it("does not repeatedly ask a skipped question", () => {
    let state = seedCallState();
    const asked = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const next = nextContinuationStep(state);
      if (!next.slot) break;
      expect(asked.has(next.slot.id)).toBe(false);
      asked.add(next.slot.id);
      state = answerDemoState(state, next.slot.id, "not_sure");
    }
    expect(asked.size).toBeGreaterThan(0);
    expect(asked.size).toBeLessThan(20);
  });
});

const scope = { locationId: "test-location", agentId: "parallel-agent" };
const call: VoiceScreenCall = {
  ...scope, callId: "call-1", endedAt: "2026-09-09T20:05:00Z", callerType: "new", urgency: "routine", humanRequested: false,
  callback: { number: "+14165550142", verifiedOnCallId: "call-1" },
  permission: { value: "granted", callId: "call-1", capturedAt: "2026-09-09T20:04:00Z" },
  safeToText: { value: "yes", callId: "call-1" },
};
describe("inactive bridge policy", () => {
  it("makes human follow-up independent of Screen completion", () => {
    expect(planVoiceScreenCall(call, scope)).toMatchObject({ humanTask: true, invitationEligible: true });
    expect(planVoiceScreenCall({ ...call, permission: { ...call.permission, value: "declined" } }, scope)).toMatchObject({ humanTask: true, invitationEligible: false });
  });
  it.each([
    { permission: { ...call.permission, callId: "older-call" } },
    { safeToText: { ...call.safeToText, callId: "older-call" } },
    { callback: { ...call.callback, verifiedOnCallId: "older-call" } },
    { urgency: "urgent" as const }, { urgency: "unknown" as const }, { humanRequested: true },
    { permission: { ...call.permission, capturedAt: "2026-09-10T20:04:00Z" } },
    { safeToText: { ...call.safeToText, value: "no" as const } },
  ])("blocks unsafe or stale invitation proof: %o", patch => {
    expect(planVoiceScreenCall({ ...call, ...patch }, scope).invitationEligible).toBe(false);
  });
  it("rejects original agent events", () => {
    expect(planVoiceScreenCall({ ...call, agentId: "original-agent" }, scope).accept).toBe(false);
  });
});
