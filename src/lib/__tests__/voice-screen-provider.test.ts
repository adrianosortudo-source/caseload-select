import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const ingestMocks = vi.hoisted(() => ({ config: vi.fn(), scope: vi.fn(), enabled: vi.fn(), ingest: vi.fn(), dispatch: vi.fn(), verify: vi.fn() }));
vi.mock("../voice-screen-store", () => ({
  liveConfig: ingestMocks.config,
  voiceScreenScopeConfig: ingestMocks.scope,
  voiceScreenIsEnabled: ingestMocks.enabled,
  ingestLiveCall: ingestMocks.ingest,
}));
vi.mock("../voice-screen-sender", () => ({ senderConfig: () => null, dispatchInvitation: ingestMocks.dispatch }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("../ghl-webhook-signature", () => ({ verifyGhlWebhookSignature: ingestMocks.verify }));
import { POST as ingestPost } from "../../app/api/integrations/voice-screen/calls/route";
import { parseProviderCall } from "../voice-screen-provider";
import { invitationEligible } from "../voice-screen-live";

const locationId = "TH71IN0vUaIByLOxnFQY";
const agentId = "6aa1d9d7c17e44082c31a0fc";
const appId = "marketplace_app_test";
const fixture = () => ({
  type: "VoiceAiCallEnd", id: "call_123", locationId, agentId, contactId: "contact_123", createdAt: "2026-09-09T20:00:00.000Z", duration: 120,
  trialCall: true,
  summary: "Caller asked about a fictional business agreement.",
  extractedData: { v2s_test_call_capture: JSON.stringify({ callerType: "new", callerName: "Alex Example", callbackPhone: "+14165550100", broadNeed: "Help with a business agreement", urgency: "routine", humanRequested: "no", inquirySmsConsent: "granted", safeToText: "yes" }) },
  transcript: "bot: What phone number should the team use?\nhuman: +1 416 555 0100\nbot: May we text you a link with optional inquiry questions?\nhuman: Yes.\nbot: Is it safe to text that number?\nhuman: Yes, it is safe to text me.",
});

describe("Voice AI provider adapter", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("rejects a missing or invalid native signature before parsing", async () => {
    ingestMocks.verify.mockReturnValue(false);
    const response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", { method: "POST", body: JSON.stringify(fixture()) }));
    expect(response.status).toBe(401);
    expect(ingestMocks.scope).not.toHaveBeenCalled();
  });
  it.each([true, false])("persists the exact signed top-level call once created=%s", async (created) => {
    ingestMocks.verify.mockReturnValue(true);
    ingestMocks.scope.mockReturnValue({ firmId: "firm", locationId, agentId, appId });
    ingestMocks.enabled.mockReturnValue(true);
    ingestMocks.config.mockReturnValue({ firmId: "firm", locationId, agentId, key: "k".repeat(32), origin: "https://example.test", retentionDays: 7 });
    ingestMocks.ingest.mockResolvedValue({ id: "inquiry", created });
    const body = JSON.stringify({ ...fixture(), createdAt: new Date(Date.now() - 120000).toISOString() });
    const response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", {
      method: "POST", headers: { "content-type": "application/json", "x-ghl-signature": "signed" }, body,
    }));
    expect(response.status).toBe(200);
    expect(ingestMocks.verify).toHaveBeenCalledWith(new Uint8Array(Buffer.from(body)), "signed");
    expect(ingestMocks.ingest.mock.calls[0][0].callId).toBe("call_123");
    expect(ingestMocks.ingest.mock.calls[0][0].contactId).toBe("contact_123");
    expect(await response.json()).toEqual({ accepted: true, processed: true, created, humanFollowUp: "pending" });
    expect(ingestMocks.dispatch).not.toHaveBeenCalled();
  });
  it("acknowledges signed events outside the TEST agent and while disabled", async () => {
    ingestMocks.verify.mockReturnValue(true);
    ingestMocks.scope.mockReturnValue({ firmId: "firm", locationId, agentId, appId });
    ingestMocks.enabled.mockReturnValue(true);
    let response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fixture(), agentId: "original_agent" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: false, reason: "outside_parallel_scope" });
    ingestMocks.enabled.mockReturnValue(false);
    response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fixture()),
    }));
    expect(await response.json()).toMatchObject({ processed: false, reason: "parallel_journey_disabled" });
    expect(ingestMocks.ingest).not.toHaveBeenCalled();
  });
  it.each([undefined, "UNINSTALL", "VoiceAiCallStart"])("acknowledges a signed non-VoiceAiCallEnd discriminator: %s", async (type) => {
    ingestMocks.verify.mockReturnValue(true);
    ingestMocks.scope.mockReturnValue({ firmId: "firm", locationId, agentId, appId });
    const response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fixture(), type }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: false, reason: "unsupported_event_type" });
    expect(ingestMocks.enabled).not.toHaveBeenCalled();
    expect(ingestMocks.ingest).not.toHaveBeenCalled();
  });
  it("acknowledges permanent invalid/replayed events and reserves 5xx for infrastructure", async () => {
    ingestMocks.verify.mockReturnValue(true);
    ingestMocks.scope.mockReturnValue({ firmId: "firm", locationId, agentId, appId });
    ingestMocks.enabled.mockReturnValue(true);
    ingestMocks.config.mockReturnValue({ firmId: "firm", locationId, agentId, key: "k".repeat(32), origin: "https://example.test", retentionDays: 7 });
    let response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    expect(await response.json()).toMatchObject({ processed: false, reason: "invalid_payload" });
    ingestMocks.ingest.mockResolvedValue({ id: null, created: false, reason: "subject_suppressed" });
    response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fixture(), createdAt: new Date(Date.now() - 120000).toISOString() }) }));
    expect(await response.json()).toMatchObject({ processed: false, reason: "subject_suppressed" });
    ingestMocks.ingest.mockRejectedValue(new Error("database unavailable"));
    response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fixture(), id: "call_other", createdAt: new Date(Date.now() - 120000).toISOString() }) }));
    expect(response.status).toBe(503);
  });
  it("allows signed TEST-agent trial calls and acknowledges signed bodies above 256KB", async () => {
    ingestMocks.verify.mockReturnValue(true);
    ingestMocks.scope.mockReturnValue({ firmId: "firm", locationId, agentId, appId });
    ingestMocks.enabled.mockReturnValue(true);
    ingestMocks.config.mockReturnValue({ firmId: "firm", locationId, agentId, key: "k".repeat(32), origin: "https://example.test", retentionDays: 7 });
    ingestMocks.ingest.mockResolvedValue({ id: "trial-inquiry", created: true });
    let response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fixture(), createdAt: new Date(Date.now() - 120000).toISOString() }),
    }));
    expect(response.status).toBe(200);
    expect(ingestMocks.ingest.mock.calls[0][0].callId).toBe("call_123");
    ingestMocks.verify.mockClear();
    ingestMocks.verify.mockReturnValue(true);
    response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", {
      method: "POST", body: "x".repeat(256 * 1024 + 1),
    }));
    expect(await response.json()).toMatchObject({ processed: false, reason: "payload_too_large" });
    expect(ingestMocks.verify).not.toHaveBeenCalled();
  });
  it("drops oversized transport before crypto but still rejects an in-bound missing signature", async () => {
    ingestMocks.verify.mockReturnValue(false);
    let response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", { method: "POST", body: "x".repeat(256 * 1024 + 1) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: false, reason: "payload_too_large" });
    expect(ingestMocks.verify).not.toHaveBeenCalled();
    response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(401);
    expect(ingestMocks.verify).toHaveBeenCalledOnce();
  });
  it("acknowledges a signed unsupported-content request", async () => {
    ingestMocks.verify.mockReturnValue(true);
    const response = await ingestPost(new NextRequest("https://example.test/api/integrations/voice-screen/calls", {
      method: "POST", headers: { "content-type": "text/plain" }, body: "not json",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: false, reason: "unsupported_content_type" });
  });
  it("fails closed after a change of mind or an oversized transcript", () => {
    const raw = fixture();
    raw.transcript += "\nhuman: I changed my mind.";
    expect(parseProviderCall(raw, locationId)!.permission.value).toBe("unknown");
    raw.transcript = fixture().transcript + "x".repeat(200001) + "\nhuman: Do not text me.";
    expect(parseProviderCall(raw, locationId)!.permission.value).toBe("unknown");
  });
  it("does not treat marketing permission as inquiry permission", () => {
    const raw = fixture();
    raw.transcript = raw.transcript.replace("human: Yes.", "human: Yes, send the newsletter link.");
    expect(parseProviderCall(raw, locationId)!.permission.value).not.toBe("granted");
  });
  it("normalizes a provider-scoped call with caller-only evidence and time provenance", () => {
    const call = parseProviderCall(fixture(), locationId)!;
    expect(call.callId).toBe("call_123");
    expect(call.endedAt).toBe("2026-09-09T20:02:00.000Z");
    expect(call.endedAtSource).toBe("provider_created_plus_duration");
    expect(call.permissionCapturedAtSource).toBe("call_end_bound");
    expect(invitationEligible(call, { locationId, agentId }, Date.parse("2026-09-09T20:03:00Z"))).toBe(true);
  });

  it("does not infer permission from extraction flags or assistant statements", () => {
    const raw = fixture(); raw.transcript = "bot: Yes, we can text you the link. It is safe to text.\nhuman: I have a question.";
    const call = parseProviderCall(raw, locationId)!;
    expect(call.permission.value).toBe("unknown");
    expect(call.safeToText.value).toBe("unknown");
    expect(call.callback.number).toBe("+14165550100");
    expect(call.callback.verifiedOnCallId).toBe("unverified");
  });

  it("honors later withdrawal and does not inherit old consent", () => {
    const raw = fixture(); raw.transcript += "\nhuman: Do not text me.";
    const call = parseProviderCall(raw, locationId)!;
    expect(call.permission.value).toBe("declined");
    expect(invitationEligible(call, { locationId, agentId })).toBe(false);
  });

  it("does not turn conditional or delayed consent into permission for immediate SMS", () => {
    const raw = fixture(); raw.transcript = raw.transcript.replace("human: Yes.", "human: Yes, but only tomorrow.");
    expect(parseProviderCall(raw, locationId)!.permission.value).toBe("unknown");
  });

  it("requires phone digits in caller speech, never provider caller ID", () => {
    const raw = { ...fixture(), fromNumber: "+14165550100" }; raw.transcript = raw.transcript.replace("human: +1 416 555 0100", "human: I would prefer not to give a number");
    expect(parseProviderCall(raw, locationId)!.callback.verifiedOnCallId).toBe("unverified");
  });

  it("fails closed on unknown transcript formats and malformed extraction while retaining a summary", () => {
    const raw = fixture(); raw.transcript = "Yes text me the link"; raw.extractedData.v2s_test_call_capture = "not json";
    const call = parseProviderCall(raw, locationId)!;
    expect(call.permission.value).toBe("unknown");
    expect(call.humanRequested).toBe(true);
    expect(call.broadNeed).toBe(raw.summary);
  });

  it("rejects wrong source location, absent call identity and invalid timestamp or duration", () => {
    expect(parseProviderCall({ ...fixture(), locationId: "other" }, locationId)).toBeNull();
    expect(parseProviderCall({ ...fixture(), id: undefined }, locationId)).toBeNull();
    expect(parseProviderCall({ ...fixture(), createdAt: "bad" }, locationId)).toBeNull();
    expect(parseProviderCall({ ...fixture(), duration: Infinity }, locationId)).toBeNull();
  });

  it("requires the configured test agent at eligibility evaluation", () => {
    const call = parseProviderCall({ ...fixture(), agentId: "original_agent" }, locationId)!;
    expect(invitationEligible(call, { locationId, agentId })).toBe(false);
  });

  it("retains an authenticated sparse call for human review", () => {
    const raw = { ...fixture(), summary: "", extractedData: {} };
    const call = parseProviderCall(raw, locationId)!;
    expect(call.broadNeed).toBe("Reason for calling was not captured. Human review is required.");
    expect(call.humanRequested).toBe(true);
    expect(invitationEligible(call, { locationId, agentId })).toBe(false);
  });

  it("preserves urgent and human paths without an invitation", () => {
    const raw = fixture(); raw.transcript += "\nhuman: I want to talk to a human.";
    const call = parseProviderCall(raw, locationId)!;
    expect(call.humanRequested).toBe(true);
    expect(invitationEligible(call, { locationId, agentId })).toBe(false);
  });
});
