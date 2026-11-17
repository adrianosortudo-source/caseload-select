import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider, requestOpenAI } from "../openai";
import { newVoiceAssignment, voiceTurnProvider } from "../voice-rollout";

const input = { model: "gpt-6-luna", input: "Synthetic example", maxOutputTokens: 25 };
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "test-secret");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fetchMock.mockReset(); });

describe("direct OpenAI responses", () => {
  it("uses the project key and returns only completed text and usage", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "completed", output: [
      { type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "OK" }] }
    ], usage: { input_tokens: 8, output_tokens: 2 } }));
    expect(await requestOpenAI(input)).toEqual({ text: "OK", inputTokens: 8, outputTokens: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers.Authorization).toBe("Bearer test-secret");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body).store).toBe(false);
  });
  it.each([
    { status: "incomplete" },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] },
    { status: "completed", output: [] },
  ])("rejects incomplete, refused or empty output", async payload => {
    fetchMock.mockResolvedValue(Response.json(payload));
    await expect(requestOpenAI(input)).rejects.toMatchObject({ status: 422 });
  });
  it("keeps upstream error details out of logs and fails before fetching on missing key", async () => {
    fetchMock.mockResolvedValue(new Response("test customer content", { status: 429 }));
    await expect(requestOpenAI(input)).rejects.toMatchObject({ message: "OpenAI request failed (429)", status: 429 });
    vi.stubEnv("CASELOAD_OPENAI_API_KEY", "");
    await expect(requestOpenAI(input)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Tone of Voice session routing", () => {
  it("keeps old and new sessions on Gemini until enabled", () => {
    vi.stubEnv("FIRM_VOICE_BUILDER_PROVIDER", "");
    expect(getProvider("FIRM_VOICE_BUILDER_PROVIDER")).toBe("gemini");
    expect(newVoiceAssignment().provider).toBe("gemini");
    expect(voiceTurnProvider(new Headers())).toBe("gemini");
  });
  it("pins GPT sessions through a ramp, rejects forged tokens, and honors rollback and key rotation", () => {
    vi.stubEnv("FIRM_VOICE_BUILDER_PROVIDER", "openai");
    vi.stubEnv("FIRM_VOICE_BUILDER_OPENAI_PERCENT", "100");
    const { provider, token } = newVoiceAssignment();
    const headers = new Headers({ "X-CaseLoad-AI-Provider": provider, "X-CaseLoad-Voice-Assignment": token });
    expect(voiceTurnProvider(headers)).toBe("openai");
    vi.stubEnv("FIRM_VOICE_BUILDER_OPENAI_PERCENT", "10");
    expect(voiceTurnProvider(headers)).toBe("openai");
    expect(voiceTurnProvider(new Headers({ "X-CaseLoad-AI-Provider": "openai" }))).toBeNull();
    expect(voiceTurnProvider(new Headers())).toBe("gemini");
    vi.stubEnv("FIRM_VOICE_BUILDER_OPENAI_PERCENT", "0");
    expect(voiceTurnProvider(headers)).toBeNull();
    vi.stubEnv("FIRM_VOICE_BUILDER_OPENAI_PERCENT", "100");
    vi.stubEnv("CASELOAD_OPENAI_API_KEY", "rotation");
    expect(voiceTurnProvider(headers)).toBeNull();
  });
});
