import { describe, expect, it } from "vitest";
import { buildVoiceScreenSms } from "../voice-screen-message";
import { planVoiceScreenCall, type VoiceScreenCall } from "../voice-screen-bridge";

const call: VoiceScreenCall = {
  callId: "current", locationId: "location", agentId: "agent",
  endedAt: "2026-09-11T16:00:00Z", callerType: "new", urgency: "routine", humanRequested: false,
  callback: { number: "+14165550142", verifiedOnCallId: "current" },
  permission: { value: "granted", callId: "current", capturedAt: "2026-09-11T15:59:00Z" },
  safeToText: { value: "yes", callId: "current" },
};

describe("independent handoff and message checks", () => {
  it("keeps the exact production invitation wording and supplied continuation link", () => {
    const link = "https://example.invalid/widget/voice-continuation#inactive-test-link";
    expect(buildVoiceScreenSms("Example Law Firm", link)).toBe(
      "Thanks for calling Example Law Firm. Here is the link we discussed to help our team prepare: " +
      link + " You can skip questions. Please avoid confidential details or documents. Reply STOP to opt out."
    );
  });
  it.each([
    { permission: { ...call.permission, value: "declined" as const } },
    { safeToText: { ...call.safeToText, value: "no" as const } },
    { callerType: "existing" as const },
    { urgency: "urgent" as const },
    { humanRequested: true },
    { callback: { ...call.callback, verifiedOnCallId: "previous-call" } },
  ])("retains human follow-up when a text condition fails: %j", override => {
    const result = planVoiceScreenCall({ ...call, ...override }, call);
    expect(result).toMatchObject({ accept: true, humanTask: true, invitationEligible: false });
  });
  it("allows an invitation only with all current-call conditions and matching scope", () => {
    expect(planVoiceScreenCall(call, call)).toMatchObject({ accept: true, humanTask: true, invitationEligible: true });
    expect(planVoiceScreenCall(call, { locationId: "other", agentId: call.agentId })).toMatchObject({ accept: false, invitationEligible: false });
  });
});
