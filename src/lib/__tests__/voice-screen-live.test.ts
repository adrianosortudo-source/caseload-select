import { afterEach, describe, it, expect, vi } from "vitest";
const senderMocks = vi.hoisted(() => ({ database: vi.fn(), config: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../voice-screen-store", () => ({ database: senderMocks.database, liveConfig: senderMocks.config }));
import { dispatchInvitation, senderConfig } from "../voice-screen-sender";
import { continuationView, createContinuation, hashToken, invitationEligible, parseLiveCall, secretMatches, seedLiveState, tokenForNonce, validToken, type LiveCall } from "../voice-screen-live";
const call: LiveCall = {
  callId: "call1", locationId: "location1", agentId: "test-agent", contactId: "contact1", endedAt: "2026-09-09T20:05:00Z",
  callerName: "Fictional Caller", broadNeed: "My client has not paid a $28000 invoice for completed work.", deadline: "No deadline reported",
  callerType: "new", urgency: "routine", humanRequested: false,
  callback: { number: "+14165550142", verifiedOnCallId: "call1" },
  permission: { value: "granted", callId: "call1", capturedAt: "2026-09-09T20:04:00Z" }, safeToText: { value: "yes", callId: "call1" },
  evidence: { callId: "call1", consentQuote: "Yes, you may text", safeToTextQuote: "It is safe to text", callbackQuote: "4165550142 is correct" },
  capturedSlots: { amount_at_stake: "$25,000–$100,000" },
};
describe("live Voice to Screen primitives", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it.each(["sent", "unknown", "cancelled"])("reconciles a claimed provider attempt as %s without retry", async (outcome) => {
    vi.stubEnv("V2S_SMS_ENABLED", "true"); vi.stubEnv("V2S_GHL_SMS_TOKEN", "fixture-token");
    vi.stubEnv("V2S_SENDER_NAME", "Fictional firm"); vi.stubEnv("V2S_TEST_RECIPIENTS", "+14165550142");
    const key = "k".repeat(32); const minted = createContinuation(key);
    senderMocks.config.mockReturnValue({ firmId: "firm", locationId: "location", agentId: "agent", key, origin: "https://example.test" });
    const inquiry = { id: "inquiry", contact_id: "contact", token_nonce: minted.nonce, token_hash: minted.hash,
      expires_at: new Date(Date.now() + 3600000).toISOString(), caller_facts: { callback: { number: "+14165550142" } },
      human_status: "pending", status: "open", invitation_eligible: true };
    const read = vi.fn().mockResolvedValue({ data: inquiry });
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: read };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    const rpc = vi.fn().mockImplementation(async (name: string) => ({ data: name === "v2s_claim" ? { ...inquiry, claimed: true, inquiry_id: "inquiry", outbox_id: "outbox" } : true }));
    senderMocks.database.mockResolvedValue({ from: () => chain, rpc });
    const request = vi.fn().mockResolvedValueOnce(Response.json({ contact: { locationId: "location", phone: "+14165550142", dnd: outcome === "cancelled" } }));
    if (outcome === "unknown") request.mockRejectedValueOnce(new Error("timeout"));
    else request.mockResolvedValueOnce(Response.json({ messageId: "message" }));
    vi.stubGlobal("fetch", request);
    expect(await dispatchInvitation("inquiry")).toEqual({ status: outcome });
    expect(request).toHaveBeenCalledTimes(outcome === "cancelled" ? 1 : 2);
    expect(rpc).toHaveBeenLastCalledWith("v2s_finish_dispatch", { p_id: "outbox", p_status: outcome, p_provider_id: outcome === "sent" ? "message" : null, p_error: outcome === "sent" ? null : `provider_${outcome}` });
    if (outcome === "sent") {
      const message = JSON.parse(request.mock.calls[1][1].body).message;
      expect(message).toContain(`/widget/voice-continuation#${minted.token}`);
      expect(message).not.toContain("14165550142"); expect(message).not.toContain("?token");
    }
  });
  it("does not open the database when sending is disabled", async () => {
    vi.stubEnv("V2S_SMS_ENABLED", "false");
    expect(senderConfig()).toBeNull();
    expect(await dispatchInvitation("inquiry")).toEqual({ status: "disabled" });
    expect(senderMocks.database).not.toHaveBeenCalled();
  });
  it("requires dedicated sending credentials and exact allowlisted numbers", () => {
    vi.stubEnv("V2S_SMS_ENABLED", "true"); vi.stubEnv("V2S_GHL_SMS_TOKEN", "fixture-token");
    vi.stubEnv("V2S_SENDER_NAME", "Fictional firm"); vi.stubEnv("V2S_TEST_RECIPIENTS", "invalid");
    expect(senderConfig()).toBeNull();
    vi.stubEnv("V2S_TEST_RECIPIENTS", "+14165550142");
    expect(senderConfig()?.recipients).toEqual(["+14165550142"]);
  });
  it("mints opaque keyed tokens with independent 256-bit nonces and stores only their hash", () => {
    const secret = "a".repeat(32); const a = createContinuation(secret); const b = createContinuation(secret);
    expect(validToken(a.token)).toBe(true); expect(a.nonce).toHaveLength(43); expect(a.hash).toHaveLength(64);
    expect(a.token).not.toBe(a.nonce); expect(a.token).not.toBe(b.token); expect(hashToken(a.token)).toBe(a.hash);
    expect(tokenForNonce(a.nonce, secret)).toBe(a.token); expect(tokenForNonce(a.nonce, "b".repeat(32))).not.toBe(a.token);
    expect(() => createContinuation("short")).toThrow();
  });
  it("fails closed for missing secrets and malformed bearer values", () => {
    expect(secretMatches("a".repeat(32), "a".repeat(32))).toBe(true);
    expect(secretMatches("a".repeat(31), "a".repeat(32))).toBe(false);
    expect(secretMatches(null, "a".repeat(32))).toBe(false); expect(secretMatches("short", "short")).toBe(false);
    expect(validToken("phone=4165550142")).toBe(false);
  });
  it("accepts valid current-call structure and rejects unknown control slots", () => {
    expect(parseLiveCall(call)).toEqual(call);
    expect(parseLiveCall({ ...call, capturedSlots: { client_phone: "attacker" } })).toBe(null);
    expect(parseLiveCall({ ...call, permission: null })).toBe(null);
    expect(parseLiveCall({ ...call, broadNeed: "x" })).toBe(null);
  });
  it("requires current proof, recency and safety independent of saved contact fields", () => {
    const now = Date.parse("2026-09-09T20:06:00Z");
    expect(invitationEligible(call, call, now)).toBe(true);
    expect(invitationEligible({ ...call, evidence: { ...call.evidence, callId: "older" } }, call, now)).toBe(false);
    expect(invitationEligible({ ...call, evidence: { ...call.evidence, consentQuote: "" } }, call, now)).toBe(false);
    expect(invitationEligible(call, call, now + 86400000)).toBe(false);
    expect(invitationEligible({ ...call, humanRequested: true }, call, now)).toBe(false);
  });
  it("keeps captured facts and exposes only the next question to the caller", () => {
    const state = seedLiveState(call); expect(state.slots.amount_at_stake).toBe("$25,000–$100,000");
    const view = continuationView(state, 4, "partial");
    expect(view.revision).toBe(4);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(call.callerName); expect(serialized).not.toContain(call.callback.number);
    expect(serialized).not.toContain("token"); expect(serialized).not.toContain("lawyer_time_priority");
    expect(continuationView(state, 5, "completed").question).toBe(null);
  });
});
