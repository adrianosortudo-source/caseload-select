import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { interviewClarificationSourceFingerprint, type AnalysisRequestEnvelope, type DesiredClientAnswers, type InterviewClarificationAnswer, type InterviewClarificationRequestEnvelope } from "@/lib/desired-client/types";
import { completeAnswers, providerBlueprint, validBlueprint } from "@/lib/desired-client/__tests__/blueprint-helpers";
import { validateAnalysisResponseResult, validateAnalysisResult } from "@/lib/desired-client/output";
import type { AnalysisResult } from "@/lib/desired-client/types";
import { buildDesiredClientEvidenceGroups } from "@/lib/desired-client/evidence-contract";
import { buildStructuredBlueprintV4 } from "@/lib/desired-client/structured-blueprint";

const mocks = vi.hoisted(() => ({
  GoogleGenerativeAI: vi.fn(),
  getGenerativeModel: vi.fn(),
  generateContent: vi.fn(),
  checkRateLimit: vi.fn(),
  reserveDesiredClientProviderCall: vi.fn(),
  releaseDesiredClientProviderRun: vi.fn(),
  providerBudget: new Map<string, { revision: number; answerFingerprint: string; used: number; ownerToken: string | null }>(),
  ipFromRequest: vi.fn(() => "203.0.113.42"),
  rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60", "X-RateLimit-Limit": "20" })),
}));
vi.mock("@google/generative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/generative-ai")>();
  return { ...actual, GoogleGenerativeAI: mocks.GoogleGenerativeAI };
});
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  reserveDesiredClientProviderCall: mocks.reserveDesiredClientProviderCall,
  releaseDesiredClientProviderRun: mocks.releaseDesiredClientProviderRun,
  ipFromRequest: mocks.ipFromRequest,
  rateLimitHeaders: mocks.rateLimitHeaders,
}));

import { GET, POST } from "../route";

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
function makeClarificationRequest(): InterviewClarificationRequestEnvelope {
  const answers = structuredClone(B0);
  answers.interview = { ai_clarification_consent: true, clarification_count: 0, clarified_stages: [], followups: [] };
  return {
    schemaVersion: 4,
    operation: "clarify",
    requestId: "44444444-4444-4444-8444-444444444444",
    answerRevision: answers.revision,
    interviewRunId: "55555555-5555-4555-8555-555555555555",
    clarificationIndex: 0,
    stage: 3,
    aiConsent: true,
    answers,
  };
}
const MODEL_RESULT = validBlueprint(B0);
const EXPECTED_RESULT = validateAnalysisResult(MODEL_RESULT, B0, []);
const ORIGINAL_ENV = new Map<string, string | undefined>();
const ENV_KEYS = ["DESIRED_CLIENT_AI_ENABLED", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VERCEL_ENV"];

function browserHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ "content-type": "application/json", origin: "https://app.caseloadselect.ca", "sec-fetch-site": "same-origin", ...extra });
}
function makeRequest(body: string, extra: Record<string, string> = {}): NextRequest {
  return new Request(ROUTE, { method: "POST", headers: browserHeaders(extra), body }) as unknown as NextRequest;
}
async function expectNoStore(response: Response) { expect(response.headers.get("cache-control")).toBe("no-store"); }
function providerResponse(value: unknown, answers: DesiredClientAnswers = B0) {
  if (value && typeof value === "object" && !Array.isArray(value) && "brief" in value) {
    const source = value as AnalysisResult;
    const root = value as Record<string, unknown>;
    const encoded = providerBlueprint(source, answers) as Record<string, unknown>;
    if (root.clarification_code !== null && root.clarification_code !== undefined) encoded.clarification_code = root.clarification_code;
    value = encoded;
  }
  return { response: { text: () => JSON.stringify(value) } };
}
function rawProviderResponse(value: unknown) { return { response: { text: () => JSON.stringify(value) } }; }

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL_ENV.set(key, process.env[key]);
  process.env.DESIRED_CLIENT_AI_ENABLED = "true";
  process.env.GOOGLE_AI_API_KEY = "test-provider-key";
  delete process.env.GEMINI_API_KEY;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-redis-token";
  delete process.env.VERCEL_ENV;
  mocks.GoogleGenerativeAI.mockReset().mockImplementation(() => ({ getGenerativeModel: mocks.getGenerativeModel }));
  mocks.getGenerativeModel.mockReset().mockReturnValue({ generateContent: mocks.generateContent });
  mocks.generateContent.mockReset().mockResolvedValue(providerResponse(MODEL_RESULT));
  mocks.checkRateLimit.mockReset().mockResolvedValue({ ok: true, active: true, remaining: 19, reset: Date.now() + 60_000, limit: 20 });
  mocks.providerBudget.clear();
  mocks.reserveDesiredClientProviderCall.mockReset().mockImplementation(async (input: { reviewRunId: string; answerRevision: number; expectedCallsUsed: number; limit: number; answerFingerprint: string; ownerToken: string }) => {
    let run = mocks.providerBudget.get(input.reviewRunId);
    if (run && (run.revision !== input.answerRevision || run.answerFingerprint !== input.answerFingerprint)) return { status: "stale", callsUsed: run.used };
    if (!run && input.expectedCallsUsed !== 0) return { status: "sequence_conflict", callsUsed: 0 };
    if (!run) {
      run = { revision: input.answerRevision, answerFingerprint: input.answerFingerprint, used: 0, ownerToken: null };
      mocks.providerBudget.set(input.reviewRunId, run);
    }
    if (run.ownerToken && run.ownerToken !== input.ownerToken) return { status: "busy", callsUsed: run.used };
    run.ownerToken = input.ownerToken;
    if (run.used >= input.limit) return { status: "exhausted", callsUsed: run.used };
    if (run.used !== input.expectedCallsUsed) return { status: "sequence_conflict", callsUsed: run.used };
    run.used += 1;
    return { status: "reserved", callsUsed: run.used };
  });
  mocks.releaseDesiredClientProviderRun.mockReset().mockImplementation(async (runId: string, ownerToken: string) => {
    const run = mocks.providerBudget.get(runId);
    if (run?.ownerToken === ownerToken) run.ownerToken = null;
  });
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

describe("GET /api/tools/desired-client-matter/analyze readiness", () => {
  it("reports AI readiness and the server generation-call limit without caching", async () => {
    process.env.DESIRED_CLIENT_AI_ENABLED="false";
    const disabled=await GET();
    expect(await disabled.json()).toEqual({enabled:false,providerCallLimit:3});
    await expectNoStore(disabled);
    process.env.DESIRED_CLIENT_AI_ENABLED="true";
    const enabled=await GET();
    expect(await enabled.json()).toEqual({enabled:true,providerCallLimit:3});
    await expectNoStore(enabled);
    process.env.VERCEL_ENV="preview";
    const preview=await GET();
    expect(await preview.json()).toEqual({enabled:true,providerCallLimit:1});
    delete process.env.VERCEL_ENV;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const incomplete=await GET();
    expect(await incomplete.json()).toEqual({enabled:false,providerCallLimit:3});
    await expectNoStore(incomplete);
  });
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

  it("fails closed without a provider call when the atomic budget store is unavailable", async () => {
    mocks.reserveDesiredClientProviderCall.mockResolvedValueOnce({ status: "unavailable", callsUsed: 0 });
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "AI_UNAVAILABLE" }, providerCallsUsed: 0, providerCallLimit: 3 });
    expect(mocks.generateContent).not.toHaveBeenCalled();
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
    expect(body).toMatchObject({ ok: true, requestId: ENVELOPE.requestId, answerRevision: 1, reviewRunId: ENVELOPE.reviewRunId, providerCallsUsed: 1, providerCallLimit: 3, result: EXPECTED_RESULT });
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
    expect(modelOptions.generationConfig).toHaveProperty("responseSchema");
    expect(requestOptions).toEqual({ timeout: 24_000 });
    const prompt = mocks.generateContent.mock.calls[0][0] as string;
    expect(prompt).toContain("Desired Client Blueprint");
    expect(prompt).toContain('"eligible_codes":[]');
    expect(prompt).not.toContain("203.0.113.42");
    expect(prompt).not.toContain("app.caseloadselect.ca");
    await expectNoStore(response);
  });

  it("returns recovery metadata derived by server validation and rejects provider self-assertion", async () => {
    const encoded = providerBlueprint(validBlueprint(B0), B0) as { brief: Record<string, unknown> };
    const groups = buildDesiredClientEvidenceGroups("why_firm_wants_work", B0);
    const paths = ["practice.capability", "practice.experience", "practice.enjoys"] as const;
    const evidenceGroupIds = paths.map(path => {
      const group = groups.find(candidate => candidate.source_answer_ids.includes(path));
      if (!group) throw new Error(`Missing test evidence group for ${path}`);
      return group.id;
    });
    encoded.brief.why_firm_wants_work = {
      claims: [{ text: "The firm reports regular experience in business acquisition advice and transaction planning.", evidence_group_ids: evidenceGroupIds }],
    };
    mocks.generateContent.mockResolvedValueOnce(rawProviderResponse(encoded));

    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.recoveredSections).toEqual(["why_firm_wants_work"]);
    expect(body.result.brief.why_firm_wants_work).toEqual(buildStructuredBlueprintV4(B0).why_firm_wants_work);
    expect(validateAnalysisResponseResult(body.result, B0, [])?.recoveredSections).toEqual(["why_firm_wants_work"]);

    const selfAsserted = { ...providerBlueprint(validBlueprint(B0), B0) as Record<string, unknown>, recoveredSections: ["why_firm_wants_work"] };
    mocks.generateContent.mockResolvedValueOnce(rawProviderResponse(selfAsserted));
    const rejected = await POST(makeRequest(JSON.stringify({ ...ENVELOPE, reviewRunId: "33333333-3333-4333-8333-333333333333" })));
    expect(rejected.status).toBe(502);
    expect(await rejected.json()).toMatchObject({ error: { code: "INVALID_AI_OUTPUT", diagnostic: { field: "report", reason: "root_shape" } } });
  });

  it("allows only one concurrent provider request for a review run", async () => {
    const [first, duplicate] = await Promise.all([
      POST(makeRequest(JSON.stringify(ENVELOPE))),
      POST(makeRequest(JSON.stringify(ENVELOPE))),
    ]);
    expect([first.status, duplicate.status].sort()).toEqual([200, 409]);
    const rejected = first.status === 409 ? await first.json() : await duplicate.json();
    expect(rejected.error.code).toBe("ANALYSIS_RUN_BUSY");
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it("caps primary and repair generations at three for one review run", async () => {
    const invalid = structuredClone(MODEL_RESULT);
    invalid.brief.why_firm_wants_work.claims[0].text = "x".repeat(701);
    mocks.generateContent.mockImplementation(async () => providerResponse(invalid));
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ providerCallsUsed: 3, providerCallLimit: 3 });
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);

    const retry = { ...ENVELOPE, requestId: "33333333-3333-4333-8333-333333333333", analysisIndex: 2 as const };
    const denied = await POST(makeRequest(JSON.stringify(retry)));
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({ error: { code: "PROVIDER_CALL_LIMIT_REACHED" }, providerCallsUsed: 3, providerCallLimit: 3 });
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
  });

  it("rejects a repeated sequence index without spending another provider call", async () => {
    const first = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(first.status).toBe(200);
    const replay = await POST(makeRequest(JSON.stringify({ ...ENVELOPE, requestId: "33333333-3333-4333-8333-333333333333" })));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: { code: "ANALYSIS_RUN_SEQUENCE_CONFLICT" }, providerCallsUsed: 1 });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects changed answers on an existing run even when the revision is replayed", async () => {
    const first = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(first.status).toBe(200);
    const changedAnswers = structuredClone(B0);
    changedAnswers.practice.firm_type = "A different Ontario business law firm";
    const stale = await POST(makeRequest(JSON.stringify({ ...ENVELOPE, requestId: "33333333-3333-4333-8333-333333333333", analysisIndex: 1, answers: changedAnswers })));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "ANALYSIS_RUN_STALE" }, providerCallsUsed: 1 });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it("keeps Preview at one total generation call including later retries", async () => {
    process.env.VERCEL_ENV = "preview";
    const invalid = structuredClone(MODEL_RESULT);
    invalid.brief.why_firm_wants_work.claims[0].text = "x".repeat(701);
    mocks.generateContent.mockImplementation(async () => providerResponse(invalid));
    const first = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ providerCallsUsed: 1, providerCallLimit: 1 });
    const retry = await POST(makeRequest(JSON.stringify({ ...ENVELOPE, requestId: "33333333-3333-4333-8333-333333333333", analysisIndex: 1 })));
    expect(retry.status).toBe(429);
    expect(await retry.json()).toMatchObject({ error: { code: "PROVIDER_CALL_LIMIT_REACHED" }, providerCallsUsed: 1, providerCallLimit: 1 });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it("normalizes a provider ask and carries its answered history into the next request", async () => {
    const request = makeClarificationRequest();
    mocks.generateContent.mockResolvedValueOnce(providerResponse({
      outcome: "ask",
      prompt: {
        purpose: "economics_effort_conflict",
        source_answer_ids: ["value.reasons", "value.fee_effort"],
        question: "Which estimate should the firm confirm first?",
        choices: [{ label: "The collected fee" }, { label: "The delivery cost" }],
        reflection: "The firm's value assessment and estimated economics need reconciliation.",
      },
      reason: null,
    }));
    const first = await POST(makeRequest(JSON.stringify(request)));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.prompt).toMatchObject({
      outcome: "ask", stage: 3, purpose: "economics_effort_conflict",
      source_answer_ids: ["value.reasons", "value.fee_effort"],
      choices: [{ id: "choice_1", label: "The collected fee" }, { id: "choice_2", label: "The delivery cost" }],
    });
    expect(firstBody.prompt.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocks.getGenerativeModel.mock.calls[0][0].generationConfig.responseSchema).toMatchObject({
      type: "object", required: ["outcome", "prompt", "reason"],
    });

    const followup = firstBody.prompt;
    const answered = structuredClone(request.answers);
    answered.revision += 1;
    const answer = followup.choices[0].label;
    const history: InterviewClarificationAnswer = {
      id: followup.id,
      stage: followup.stage,
      purpose: followup.purpose,
      source_answer_ids: followup.source_answer_ids,
      question: followup.question,
      answer,
      choiceId: followup.choices[0].id,
      skipped: false,
      reflection: followup.reflection,
    };
    answered.interview = {
      ai_clarification_consent: true,
      clarification_count: 1,
      clarified_stages: [3],
      followups: [history],
    };
    history.source_answer_fingerprint = interviewClarificationSourceFingerprint(answered, history.source_answer_ids);
    const next = {
      ...request,
      requestId: "66666666-6666-4666-8666-666666666666",
      answerRevision: answered.revision,
      clarificationIndex: 1,
      stage: 4 as const,
      answers: answered,
    };
    mocks.generateContent.mockResolvedValueOnce(providerResponse({ outcome: "continue", prompt: null, reason: "There is no material ambiguity in this section." }));
    const second = await POST(makeRequest(JSON.stringify(next)));
    expect(second.status).toBe(200);
    expect((await second.json()).prompt).toEqual({ outcome: "continue", reason: "There is no material ambiguity in this section." });
    const nextModelInput = JSON.parse(mocks.generateContent.mock.calls[1][0] as string);
    expect(nextModelInput.previous_followups).toEqual([{ stage: 3, question: followup.question, answer }]);
  });

  it("returns safe field diagnostics for rejected clarification output", async () => {
    const request = makeClarificationRequest();
    const secretModelText = "synthetic private model text sentinel";
    mocks.generateContent.mockResolvedValueOnce(providerResponse({
      outcome: "ask",
      prompt: {
        purpose: "not-a-stage-three-purpose",
        source_answer_ids: ["value.reasons"],
        question: secretModelText,
        choices: [{ label: "First" }, { label: "Second" }],
        reflection: "A harmless reflection.",
      },
      reason: null,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(makeRequest(JSON.stringify(request)));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("INVALID_AI_OUTPUT");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      event: "desired_client_clarification_rejected", requestId: request.requestId,
      stage: request.stage, reason: "prompt_contract", validationCode: "purpose", repairAttempts: 0,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secretModelText);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(JSON.stringify(request.answers));
  });

  it("rejects legacy post-draft clarification codes because v4 follow-ups happen during discovery", async () => {
    const answers = { ...B0, delivery: { ...B0.delivery, capacity: "change" as const } };
    mocks.generateContent.mockResolvedValueOnce(providerResponse({ ...MODEL_RESULT, clarification_code: "CAPACITY_CONFLICT" }));
    const early = await POST(makeRequest(JSON.stringify({ ...ENVELOPE, reviewRunId: "33333333-3333-4333-8333-333333333333", answers, analysisIndex: 0 })));
    expect(early.status).toBe(502);
    expect((await early.json()).error.code).toBe("INVALID_AI_OUTPUT");
    const earlyPrompt = JSON.parse(mocks.generateContent.mock.calls[0][0] as string);
    expect(earlyPrompt.eligible_codes).toEqual([]);

    mocks.generateContent.mockResolvedValueOnce(providerResponse({ ...MODEL_RESULT, clarification_code: "CAPACITY_CONFLICT" }));
    const final = await POST(makeRequest(JSON.stringify({ ...ENVELOPE, reviewRunId: "44444444-4444-4444-8444-444444444444", answers, analysisIndex: 0 })));
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
    expect(body).toEqual({ ok: false, requestId: ENVELOPE.requestId, error: { code: "AI_UNAVAILABLE" }, providerCallsUsed: 1, providerCallLimit: 3 });
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

  it("logs safe rejection details when blueprint validation fails", async () => {
    const invalid = structuredClone(MODEL_RESULT);
    invalid.brief.why_firm_wants_work.claims[0].text = "x".repeat(701);
    mocks.generateContent.mockResolvedValueOnce(providerResponse(invalid));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(502);
    const failure = await response.json();
    expect(failure).toEqual({
      ok: false, requestId: ENVELOPE.requestId,
      error: { code: "INVALID_AI_OUTPUT", diagnostic: { field: "why_firm_wants_work", reason: "card_shape" } },
      providerCallsUsed: 3, providerCallLimit: 3,
    });
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      event: "[desired-client] analysis output rejected",
      requestId: ENVELOPE.requestId,
      model: "gemini-2.5-flash",
      field: "why_firm_wants_work",
      reason: "statement_text_budget_or_format",
      finalField: "why_firm_wants_work",
      finalReason: "card_shape",
      repairAttempts: 2,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("x".repeat(701));
    expect(JSON.stringify(failure)).not.toContain("x".repeat(701));
  });

  it("does not log provider-supplied answer paths or model text", async () => {
    process.env.VERCEL_ENV = "preview";
    const invalid = providerBlueprint(MODEL_RESULT, B0) as {
      brief: { definition_components: { client: { text: string; evidence_group_ids: string[]; source_answer_ids?: string[] } } };
    };
    invalid.brief.definition_components.client.text = "Ontario business owners";
    invalid.brief.definition_components.client.evidence_group_ids = [];
    invalid.brief.definition_components.client.source_answer_ids = ["practice.firm_type"];
    mocks.generateContent.mockResolvedValueOnce(rawProviderResponse(invalid));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));
    expect(response.status).toBe(502);
    const log = JSON.parse(warn.mock.calls[0][0] as string);
    expect(log).toMatchObject({
      event: "[desired-client] analysis output rejected",
      requestId: ENVELOPE.requestId,
      model: "gemini-2.5-flash",
      field: "definition_components.client",
      reason: "evidence_group_selection_invalid",
      finalField: "definition_components.client",
      finalReason: "evidence_group_selection_invalid",
      repairAttempts: 0,
    });
    expect(log).not.toHaveProperty("sourcePath");
    expect(log.firstClaimDiagnostic).toMatchObject({ slot: "definition_client_type", claimIndex: 1, sourceAnswerIds: [], groupIds: [], expectedGroups: [] });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(JSON.stringify(ENVELOPE.answers));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Ontario business owners");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("practice.firm_type");
  });

  it("rejects a non-registered why-firm selection in Preview without exposing text or spending repair calls", async () => {
    process.env.VERCEL_ENV = "preview";
    const invalid = structuredClone(MODEL_RESULT);
    const privateClaim = "private diagnostic claim text sentinel";
    invalid.brief.why_firm_wants_work.claims[0] = {
      text: privateClaim,
      kind: "experience",
      source_answer_ids: ["practice.experience"],
      evidence_basis: "client_reported",
    };
    const privateAnswer = "private diagnostic answer text sentinel";
    const request = structuredClone(ENVELOPE);
    request.answers.client.goal_detail = privateAnswer;
    mocks.generateContent.mockResolvedValueOnce(providerResponse(invalid));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(makeRequest(JSON.stringify(request)));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      requestId: ENVELOPE.requestId,
      error: { code: "INVALID_AI_OUTPUT", diagnostic: { field: "why_firm_wants_work", reason: "evidence_group_selection_invalid" } },
      providerCallsUsed: 1,
      providerCallLimit: 1,
    });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    const log = JSON.parse(warn.mock.calls[0][0] as string);
    expect(log.repairAttempts).toBe(0);
    expect(log.firstClaimDiagnostic).toEqual({
      claimIndex: 1,
      slot: "why_firm_wants_work",
      kind: "unknown",
      evidenceBasis: "unknown",
      sourceAnswerIds: [],
      groupIds: [],
      expectedGroups: [],
    });
    expect(log.finalClaimDiagnostic).toEqual(log.firstClaimDiagnostic);
    const serializedLog = JSON.stringify(warn.mock.calls);
    expect(serializedLog).toContain("evidence_group_selection_invalid");
    expect(serializedLog).not.toContain(privateClaim);
    expect(serializedLog).not.toContain(privateAnswer);
    expect(serializedLog).not.toContain(JSON.stringify(request.answers));
    expect(JSON.stringify(body)).not.toContain(privateClaim);
    expect(JSON.stringify(body)).not.toContain(privateAnswer);
  });

  it("keeps invalid-group repair behavior unchanged in Production", async () => {
    process.env.VERCEL_ENV = "production";
    const invalid = structuredClone(MODEL_RESULT);
    invalid.brief.why_firm_wants_work.claims[0] = {
      text: "A private production-only claim sentinel",
      kind: "experience",
      source_answer_ids: ["practice.experience"],
      evidence_basis: "client_reported",
    };
    mocks.generateContent.mockResolvedValueOnce(providerResponse(invalid)).mockResolvedValue(providerResponse({ claims: invalid.brief.why_firm_wants_work.claims }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(makeRequest(JSON.stringify(ENVELOPE)));

    expect(response.status).toBe(502);
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
    const log = JSON.parse(warn.mock.calls[0][0] as string);
    expect(log).toMatchObject({
      field: "why_firm_wants_work",
      reason: "evidence_group_selection_invalid",
      finalField: "why_firm_wants_work",
      finalReason: "evidence_group_selection_invalid",
      repairAttempts: 2,
    });
    expect(log).not.toHaveProperty("firstClaimDiagnostic");
    expect(log).not.toHaveProperty("finalClaimDiagnostic");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("A private production-only claim sentinel");
  });

  it.each([
    ["unbounded numeric suffix", `interview.followups.${"9".repeat(512)}`],
    ["unknown followup index", "interview.followups.999"],
  ])("omits %s from Preview diagnostics and does not retry", async (_label, unsafeSourceId) => {
    process.env.VERCEL_ENV = "preview";
    const invalid = structuredClone(MODEL_RESULT);
    const privateClaim = "private unsupported followup claim sentinel";
    invalid.brief.why_firm_wants_work.claims[0] = {
      text: privateClaim,
      kind: "experience",
      source_answer_ids: [unsafeSourceId as never],
      evidence_basis: "client_reported",
    };
    const privateAnswer = "private unsupported followup answer sentinel";
    const request = structuredClone(ENVELOPE);
    request.answers.client.goal_detail = privateAnswer;
    mocks.generateContent.mockResolvedValueOnce(providerResponse(invalid));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(makeRequest(JSON.stringify(request)));

    expect(response.status).toBe(502);
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    const log = JSON.parse(warn.mock.calls[0][0] as string);
    expect(log.repairAttempts).toBe(0);
    expect(log.firstClaimDiagnostic).toMatchObject({ sourceAnswerIds: [], expectedGroups: [] });
    expect(log).not.toHaveProperty("sourcePath");
    const serializedLog = JSON.stringify(warn.mock.calls);
    expect(serializedLog).not.toContain(unsafeSourceId);
    expect(serializedLog).not.toContain(privateClaim);
    expect(serializedLog).not.toContain(privateAnswer);
    expect(JSON.stringify(await response.json())).not.toContain(unsafeSourceId);
  });

  it("rejects a request without explicit AI consent", async () => {
    const invalid = { ...ENVELOPE, aiConsent: false };
    const response = await POST(makeRequest(JSON.stringify(invalid)));
    expect(response.status).toBe(400);
    expect(mocks.GoogleGenerativeAI).not.toHaveBeenCalled();
  });
});
