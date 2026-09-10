import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContinuation } from "../voice-screen-live";
const mocks = vi.hoisted(() => ({ config: vi.fn(), database: vi.fn(), rpc: vi.fn(), read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../voice-screen-store", () => ({ liveConfig: mocks.config, database: mocks.database }));
import { dispatchInvitation } from "../voice-screen-sender";

describe("parallel invitation sender", () => {
  const key = "k".repeat(32);
  let inquiry: Record<string, unknown>;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("V2S_SMS_ENABLED", "true"); vi.stubEnv("V2S_GHL_SMS_TOKEN", "test-token");
    vi.stubEnv("V2S_SENDER_NAME", "Fictional firm"); vi.stubEnv("V2S_TEST_RECIPIENTS", "+14165550142");
    mocks.config.mockReturnValue({ firmId: "firm", locationId: "location", agentId: "agent", key, origin: "https://example.test" });
    const token = createContinuation(key);
    inquiry = { id: "inquiry", contact_id: "contact", token_nonce: token.nonce, token_hash: token.hash,
      expires_at: new Date(Date.now() + 3600000).toISOString(), caller_facts: { callback: { number: "+14165550142" } },
      human_status: "pending", status: "open", invitation_eligible: true };
    mocks.read.mockImplementation(async () => ({ data: inquiry }));
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: mocks.read };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    mocks.database.mockResolvedValue({ from: () => chain, rpc: mocks.rpc });
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "v2s_claim" ? { ...inquiry, claimed: true, inquiry_id: "inquiry", outbox_id: "outbox" } : true }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ contact: { locationId: "location", phone: "+14165550142", dnd: false } })).mockResolvedValueOnce(Response.json({ messageId: "message" })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("does nothing when sending is disabled", async () => {
    vi.stubEnv("V2S_SMS_ENABLED", "false");
    expect(await dispatchInvitation("inquiry")).toEqual({ status: "disabled" });
    expect(mocks.database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("never claims or sends outside the explicit test-number allowlist", async () => {
    vi.stubEnv("V2S_TEST_RECIPIENTS", "+14165550999");
    expect(await dispatchInvitation("inquiry")).toEqual({ status: "not_allowlisted" });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("sends one generic fragment link and reconciles provider acceptance", async () => {
    expect(await dispatchInvitation("inquiry")).toEqual({ status: "sent" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(body.message).toMatch(/https:\/\/example.test\/widget\/voice-continuation#[A-Za-z0-9_-]{43}/);
    expect(body.message).not.toContain("14165550142"); expect(body.message).not.toContain("?token");
    expect(mocks.rpc).toHaveBeenLastCalledWith("v2s_finish_dispatch", { p_id: "outbox", p_status: "sent", p_provider_id: "message", p_error: null });
  });
  it("does not repeat an already claimed attempt", async () => {
    mocks.rpc.mockResolvedValue({ data: { claimed: false } });
    expect(await dispatchInvitation("inquiry")).toEqual({ status: "not_pending" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels for current provider DND", async () => {
    vi.mocked(fetch).mockReset().mockResolvedValue(Response.json({ contact: { locationId: "location", phone: "+14165550142", dnd: true } }));
    expect(await dispatchInvitation("inquiry")).toEqual({ status: "cancelled" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("records an ambiguous POST without retrying", async () => {
    vi.mocked(fetch).mockReset().mockResolvedValueOnce(Response.json({ contact: { locationId: "location", phone: "+14165550142", dnd: false } })).mockRejectedValueOnce(new Error("timeout"));
    expect(await dispatchInvitation("inquiry")).toEqual({ status: "unknown" }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rechecks human takeover immediately before the provider send", async () => {
    mocks.read.mockResolvedValueOnce({ data: inquiry }).mockResolvedValueOnce({ data: { ...inquiry, human_status: "taken_over" } });
    expect(await dispatchInvitation("inquiry")).toEqual({ status: "cancelled" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
