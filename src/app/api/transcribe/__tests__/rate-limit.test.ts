/**
 * Route-level tests for /api/transcribe rate limiting + size guards (H6).
 *
 * /api/transcribe is a public proxy in front of Gemini transcription (the
 * kickoff recorder calls it from the browser, so it cannot require auth).
 * Pins:
 *   - 429 when the per-IP bucket denies
 *   - 413 from the Content-Length guard BEFORE the body is parsed
 *   - happy path: allowed request reaches the (mocked) Gemini fetch and the
 *     candidate text is unwrapped + trimmed
 *
 * The Content-Length test uses a stub request whose formData() throws,
 * proving the oversize rejection happens without buffering the body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  rateLimitHeaders: vi.fn(() => ({ "Retry-After": "30" })),
}));

import { POST } from "../route";

const ALLOWED = { ok: true, active: false, remaining: 10, reset: 0, limit: 10 };
const DENIED = { ok: false, active: true, remaining: 0, reset: Date.now() + 30_000, limit: 10 };

const realFetch = global.fetch;
const realGoogleKey = process.env.GOOGLE_AI_API_KEY;
const realGeminiKey = process.env.GEMINI_API_KEY;

function geminiResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200 },
  );
}

function makeAudioRequest(): Request {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(2048)], { type: "audio/wav" }), "kickoff.wav");
  return new Request("https://app.caseloadselect.ca/api/transcribe", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(ALLOWED);
  process.env.GOOGLE_AI_API_KEY = "test-key";
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  global.fetch = realFetch;
  if (realGoogleKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
  else process.env.GOOGLE_AI_API_KEY = realGoogleKey;
  if (realGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = realGeminiKey;
});

describe("/api/transcribe rate limiting", () => {
  it("returns 429 with rate-limit headers when the limiter denies", async () => {
    mocks.checkRateLimit.mockResolvedValue(DENIED);
    const res = await POST(makeAudioRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("rate limited");
  });

  it("charges the transcribe bucket", async () => {
    global.fetch = vi.fn(async () => geminiResponse("hi")) as typeof fetch;
    await POST(makeAudioRequest());
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("transcribe", "203.0.113.9");
  });

  it("rejects an oversize Content-Length with 413 before parsing the body", async () => {
    const fakeReq = {
      headers: new Headers({ "content-length": String(30 * 1024 * 1024) }),
      formData: () => {
        throw new Error("body must not be parsed for oversize requests");
      },
    } as unknown as Request;

    const res = await POST(fakeReq);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("audio exceeds 25 MB limit");
  });

  it("passes an allowed request through to Gemini and returns the transcript", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => geminiResponse("  hello world  "),
    );
    global.fetch = fetchMock as typeof fetch;

    const res = await POST(makeAudioRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, text: "hello world" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
  });
});

describe("/api/transcribe direct OpenAI project", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("submits the audio bytes in their original language and trims the returned text", async () => {
    vi.stubEnv("SCREEN_TRANSCRIPTION_AI_PROVIDER", "openai");
    vi.stubEnv("CASELOAD_OPENAI_API_KEY", "fixture-project-key");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ text: "  Bonjour  " }),
    );
    global.fetch = fetchMock;
    const res = await POST(makeAudioRequest());
    expect(await res.json()).toEqual({ ok: true, text: "Bonjour" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init?.headers).toEqual({ Authorization: "Bearer fixture-project-key" });
    const sent = init?.body as FormData;
    const file = sent.get("file") as File;
    expect(file.name).toBe("recording.wav");
    expect(file.size).toBe(2048);
    expect(sent.get("model")).toBe("gpt-transcribe");
    expect(sent.has("language")).toBe(false);
  });

  it("stops before any upload when the selected project's key is missing", async () => {
    vi.stubEnv("SCREEN_TRANSCRIPTION_AI_PROVIDER", "openai");
    vi.stubEnv("CASELOAD_OPENAI_API_KEY", "");
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    const res = await POST(makeAudioRequest());
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
