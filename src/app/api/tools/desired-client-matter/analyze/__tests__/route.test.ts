import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { AnalysisRequestEnvelope, DesiredClientAnswers } from "@/lib/desired-client/types";
import { completeAnswers, validBlueprint } from "@/lib/desired-client/__tests__/blueprint-helpers";

const mocks = vi.hoisted(() => ({
  GoogleGenerativeAI: vi.fn(),
  getGenerativeModel: vi.fn(),
  generateContent: vi.fn(),
  checkRateLimit: vi.fn(),
  ipFromRequest: vi.fn(() => "203.0.113.42"),
  rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60", "X-RateLimit-Limit": "20" })),
}));
vi.mock("@google/generative-ai", () => ({ GoogleGenerativeAI: mocks.GoogleGenerativeAI }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: mocks.ipFromRequest,
  rateLimitHeaders: mocks.rateLimitHeaders,
}));

import { POST } from "../route";

const ROUTE = "https://app.caseloadselect.ca/api/tools/desired-client-matter/analyze";
const B0: DesiredClientAnswers = (() => {
  const answers = completeAnswers();
  answers.revision = 1;
  answers.practice.firm_type = "Ontario business law firm";
  return answers;
})();
const ENVELOPE: AnalysisRequestEnvelope = {
  schemaVersion: 4,
  operation: "generate",
  requestId: "11111111-1111-4111-8111-111111111111",
  answerRevision: 1,
  reviewRunId: "22222222-2222-4222-8222-222222222222",
  analysisIndex: 0,
  aiConsent: true,
  answers: B0,
  clarifications: [],
};
const MODEL_RESULT = validBlueprint();
const ORIGINAL_ENV = new Map<string, string | undefined>();
const ENV_KEYS = ["DESIRED_CLIENT_AI_ENABLED", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];

function browserHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ "content-type": "application/json", origin: "https://app.caseloadselect.ca", "sec-fetch-site": "same-origin", ...extra });
}
function makeRequest(body: string, extra: Record<string, string> = {}): NextRequest {
  return new Request(ROUTE, { method: "POST", headers: browserHeaders(extra), body }) as unknown as NextRequest;
}
async function expectNoStore(response: Response) { expect(response.headers.get("cache-control")).toBe("no-store"); }
function providerResponse(value: unknown) { return { response: { text: () => JSON.stringify(value) } }; }

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL_ENV.set(key, process.env[key]);
  process.env.DESIRED_CLIENT_AI_ENABLED = "true";
  process.env.GOOGLE_AI_API_KEY = "test-provider-key";
  delete process.env.GEMINI_API_KEY;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-redis-token";
  mocks.GoogleGenerativeAI.mockReset().mockImplementation(() => ({ getGenerativeModel: mocks.getGenerativeModel }));
  mocks.getGenerativeModel.mockReset().mockReturnValue({ generateContent: mocks.generateContent });
  mocks.generateContent.mockReset().mockResolvedValue(providerResponse(MODEL_RESULT));
  mocks.checkRateLimit.mockReset().mockResolvedValue({ ok: true, active: true, remaining: 19, reset: Date.now() + 60_000, limit: 20 });
  mocks.ipFromRequest.mockClear().mockReturnValue("203.0.113.42");
  mocks.rateLimitHeaders.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("POST /api/tools/desired-client-matter/analyze", () => {
  it("requires a JSON same-origin browser request and returns no-store failures", async () => {
    const missingOrigin = await POST(new Request(ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ENVELOPE) }) as unknown as NextRequest);
    expect(missingOrigin.status).toBe(403);
    await expectNoStore(missingOrigin);
    const foreignOrigin = await POST(makeRequest(JSON.stringify(ENVELOPE), { origin: "https://evil.example" }));
    expect(foreignOrigin.status).toBe(403);
    await expectNoStore(foreignOrigin);
    const crossSite = await POST(makeRequest(JSON.stringify(ENVELOPE), { "sec-fetch-site": "cross-site" }));
    expect(crossSite.status).toBe(403);
    await expectNoStore(crossSite);
    const wrongType = await POST(new Request(ROUTE, { method: "POST", headers: { origin: "https://app.caseloadselect.ca", "content-type": "text/plain" }, body: JSON.stringify(ENVELOPE) }) as unknown as NextRequest);
    expect(wrongType.status).toBe(400);
    await expectNoStore(wrongType);
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();
  });

  it("rejects declared and streamed oversize bodies before provider calls", async () => {
    const declared = await POST(makeRequest("{}", { "content-length": "32769" }));
    expect(declared.status).toBe(413);
    await expectNoStore(declared);
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { if (pulls >= 8) { controller.close(); return; } pulls += 1; controller.enqueue(new Uint8Array(8192).fill(65)); },
      cancel() { cancelled = true; },
    });
    const streamed = await POST(new Request(ROUTE, { method: "POST", headers: browserHeaders(), body: stream, duplex: "half" } as RequestInit) as unknown as NextRequest);
    expect(streamed.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(8);
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();
  });

  it("rejects invalid envelopes without contacting Gemini", async () => {
    const invalid = { ...ENVELOPE, answers: { ...B0, extra: "sentinel" } };
    const response = await POST(makeRequest(JSON.stringify(invalid)));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();
    await expectNoStore(response);
  });

  it("requires the current v3 answer contract and does not accept legacy schema envelopes", async () => {
    const oldEnvelope = { ...ENVELOPE, schemaVersion: 2 };
    const oldAnswers = { ...ENVELOPE, answers: { ...B0, schema_version: "dcm-v2.2" } };
    for (const invalid of [oldEnvelope, oldAnswers]) {
      const response = await POST(makeRequest(JSON.stringify(invalid)));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_REQUEST");
      await expectNoStore(response);
    }
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();
  });

  it("keeps AI disabled unless the server opt-in, key and both Redis settings exist", async () => {
    process.env.DESIRED_CLIENT_AI_ENABLED = "false";
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("AI_DISABLED");
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();
    await expectNoStore(response);
  });

  it("uses three sequential limits, sends only the validated answer payload and returns a validated brief", async () => {
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, requestId: ENVELOPE.requestId, answerRevision: 1, reviewRunId: ENVELOPE.reviewRunId, result: MODEL_RESULT });
    expect(body.result.brief.report_version).toBe("dcm-blueprint-v4");
    expect(body.result.brief.definition_sentence).toContain("The firm wants to attract and serve");
    expect(Object.keys(body.result.brief)).toEqual([
      "report_version", "definition_sentence", "definition_components", "client_and_matter", "client_goals_needs",
      "why_firm_wants_work", "why_client_chooses_firm", "recognizable_circumstances", "evidence_and_open_questions", "decision_pathway",
    ]);
    expect(mocks.checkRateLimit.mock.calls).toEqual([
      ["desiredClientAnalyze", "203.0.113.42"],
      ["desiredClientDaily", "203.0.113.42"],
      ["desiredClientGlobal", "all"],
    ]);
    expect(mocks.GoogleGenerativeAI).toHaveBeenCalledWith("test-provider-key");
    const [modelOptions, requestOptions] = mocks.getGenerativeModel.mock.calls[0];
    expect(modelOptions).toMatchObject({ model: "gemini-2.5-flash", generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 512 } } });
    expect(requestOptions).toEqual({ timeout: 12_000 });
    const prompt = mocks.generateContent.mock.calls[0][0] as string;
    expect(prompt).toContain("Desired Client Blueprint");
    expect(prompt).toContain('"eligible_codes":[]');
    expect(prompt).not.toContain("203.0.113.42");
    expect(prompt).not.toContain("app.caseloadselect.ca");
    await expectNoStore(response);
  });

  it("rejects legacy post-draft clarification codes because v4 follow-ups happen during discovery", async () => {
    const answers = { ...B0, delivery: { ...B0.delivery, capacity: "change" as const } };
    mocks.generateContent.mockResolvedValueOnce(providerResponse({ ...MODEL_RESULT, clarification_code: "CAPACITY_CONFLICT" }));
    const early = await POST(makeRequest(JSON.stringify({ ...ENVELOPE, answers, analysisIndex: 1 })));
    expect(early.status).toBe(502);
    expect((await early.json()).error.code).toBe("INVALID_AI_OUTPUT");
    const earlyPrompt = JSON.parse(mocks.generateContent.mock.calls[0][0] as string);
    expect(earlyPrompt.eligible_codes).toEqual([]);

    mocks.generateContent.mockResolvedValueOnce(providerResponse({ ...MODEL_RESULT, clarification_code: "CAPACITY_CONFLICT" }));
    const final = await POST(makeRequest(JSON.stringify({ ...ENVELOPE, answers, analysisIndex: 2 })));
    expect(final.status).toBe(502);
    expect((await final.json()).error.code).toBe("INVALID_AI_OUTPUT");
    const finalPrompt = JSON.parse(mocks.generateContent.mock.calls[1][0] as string);
    expect(finalPrompt.eligible_codes).toEqual([]);
  });

  it("stops at the first quota denial and never calls Gemini", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ ok: true, active: true, remaining: 1, reset: Date.now() + 60_000, limit: 20 });
    mocks.checkRateLimit.mockResolvedValueOnce({ ok: false, active: true, remaining: 0, reset: Date.now() + 60_000, limit: 100 });
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("RATE_LIMITED");
    expect(mocks.checkRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.rateLimitHeaders).toHaveBeenCalledWith(expect.objectContaining({ ok: false, limit: 100 }));
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();
    await expectNoStore(response);
  });

  it("returns safe unavailable output when the provider fails", async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error("provider echoed private prompt sentinel"));
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ ok: false, requestId: ENVELOPE.requestId, error: { code: "AI_UNAVAILABLE" } });
    expect(JSON.stringify(body)).not.toContain("private prompt sentinel");
    await expectNoStore(response);
  });

  it("rejects malformed or unsupported Gemini text before returning it", async () => {
    mocks.generateContent.mockResolvedValueOnce(providerResponse({ ...MODEL_RESULT, clarification_code: "NOT_ELIGIBLE" }));
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("INVALID_AI_OUTPUT");
    await expectNoStore(response);
  });

  it("rejects a request without explicit AI consent", async () => {
    const invalid = { ...ENVELOPE, aiConsent: false };
    const response = await POST(makeRequest(JSON.stringify(invalid)));
    expect(response.status).toBe(400);
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();
  });
});
