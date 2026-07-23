/**
 * Tests for POST /api/tools/firm-voice-builder/turn. Covers the acceptance
 * list from BUILD_PLAN_firm_voice_builder_tool_v1.md Phase 1: validation
 * rejection, rate limiting, the disabled/error degradation paths, and the
 * message/raw/profile response-splitting logic (the profile block is
 * stripped from `message` for display but preserved verbatim in `raw` for
 * the client's own history, per the revision-loop requirement).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OPENING_MESSAGE, PROFILE_START_MARKER, PROFILE_END_MARKER } from "@/lib/firm-voice-builder/system-prompt";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  runFirmVoiceBuilderTurn: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: mocks.ipFromRequest,
  rateLimitHeaders: () => ({}),
}));

vi.mock("@/lib/firm-voice-builder/gemini", () => ({
  runFirmVoiceBuilderTurn: mocks.runFirmVoiceBuilderTurn,
}));

import { POST } from "../route";

function makeRequest(body: unknown) {
  return new Request("https://app.caseloadselect.ca/api/tools/firm-voice-builder/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

const VALID_TRANSCRIPT = {
  transcript: [
    { role: "interviewer", text: OPENING_MESSAGE },
    { role: "lawyer", text: "I do employment law for workers in Hamilton." },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ ok: true, active: true, remaining: 19, reset: 0, limit: 20 });
});

describe("POST /api/tools/firm-voice-builder/turn", () => {
  it("rejects a malformed JSON body", async () => {
    const req = new Request("https://app.caseloadselect.ca/api/tools/firm-voice-builder/turn", {
      method: "POST",
      body: "not json",
    }) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid transcript before calling Gemini", async () => {
    const res = await POST(makeRequest({ transcript: [] }));
    expect(res.status).toBe(400);
    expect(mocks.runFirmVoiceBuilderTurn).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited, without calling Gemini", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, active: true, remaining: 0, reset: Date.now(), limit: 20 });
    const res = await POST(makeRequest(VALID_TRANSCRIPT));
    expect(res.status).toBe(429);
    expect(mocks.runFirmVoiceBuilderTurn).not.toHaveBeenCalled();
  });

  it("returns 503 when the model is disabled (no API key)", async () => {
    mocks.runFirmVoiceBuilderTurn.mockResolvedValue({ mode: "disabled", reason: "no key" });
    const res = await POST(makeRequest(VALID_TRANSCRIPT));
    expect(res.status).toBe(503);
  });

  it("returns 502 when the model call errors", async () => {
    mocks.runFirmVoiceBuilderTurn.mockResolvedValue({ mode: "error", reason: "boom" });
    const res = await POST(makeRequest(VALID_TRANSCRIPT));
    expect(res.status).toBe(502);
  });

  it("returns the next question with its section number on a normal turn", async () => {
    mocks.runFirmVoiceBuilderTurn.mockResolvedValue({
      mode: "live",
      text: "[SECTION:1]\nDescribe one client you would happily take ten more of.",
    });
    const res = await POST(makeRequest(VALID_TRANSCRIPT));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.section).toBe(1);
    expect(json.message).toBe("Describe one client you would happily take ten more of.");
    expect(json.profile).toBeNull();
    expect(json.raw).toContain("[SECTION:1]");
  });

  it("strips the profile block from `message` but preserves it verbatim in `raw`", async () => {
    const modelOutput = `[SECTION:7]\nHere is your profile.\n${PROFILE_START_MARKER}\n# Firm Voice Profile\n\nBody.\n${PROFILE_END_MARKER}\nHere are three proof pieces. What feels off?`;
    mocks.runFirmVoiceBuilderTurn.mockResolvedValue({ mode: "live", text: modelOutput });
    const res = await POST(makeRequest(VALID_TRANSCRIPT));
    const json = await res.json();
    expect(json.profile).toBe("# Firm Voice Profile\n\nBody.");
    expect(json.message).not.toContain(PROFILE_START_MARKER);
    expect(json.message).not.toContain("# Firm Voice Profile");
    expect(json.message).toContain("Here is your profile.");
    expect(json.message).toContain("What feels off?");
    expect(json.raw).toBe(modelOutput);
    expect(json.raw).toContain(PROFILE_START_MARKER);
  });

  it("passes the mapped Gemini contents through, starting with a user kickoff turn", async () => {
    mocks.runFirmVoiceBuilderTurn.mockResolvedValue({ mode: "live", text: "[SECTION:1]\nnext question" });
    await POST(makeRequest(VALID_TRANSCRIPT));
    const contentsArg = mocks.runFirmVoiceBuilderTurn.mock.calls[0][0];
    expect(contentsArg[0]).toEqual({ role: "user", parts: [{ text: "Begin the interview." }] });
    expect(contentsArg[1].role).toBe("model");
    expect(contentsArg[2].role).toBe("user");
  });
});
