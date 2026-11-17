import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAnswer } from "../assist/generate-answer";
import { extractionProvider } from "../ai/intake-generation";
import { initialiseState } from "../screen-engine/extractor";
import { llmExtractServer } from "../screen-llm-server";
import { llmMapOptionReply } from "../llm-option-map";
import { classifyVoiceBranchServer } from "../voice-branch-classifier-server";
import { classifyVoiceBranchHeuristic } from "../voice-branch-classifier";

const testOrigin = "https://example.test";
const demoPage = testOrigin + "/screen-demo-app/index.html";
const invoice = "A fictional customer owes $18,450 on an unpaid invoice.";
const state = { ...initialiseState(invoice), matter_type: "unpaid_invoice" as const };

function request(referrer?: string): Request {
  return new Request(testOrigin + "/api/extract", { headers: referrer ? { referer: referrer } : {} });
}

function stubResponse(json: unknown) {
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "project-fixture");
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(json) }] }],
    usage: { input_tokens: 36, output_tokens: 17 },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("SCREEN provider routing", () => {
  it("selects the demo independently of operational intake, including iframe document queries", () => {
    vi.stubEnv("SCREEN_DEMO_AI_PROVIDER", "openai");
    vi.stubEnv("SCREEN_INTAKE_AI_PROVIDER", "gemini");
    expect(extractionProvider(request(demoPage + "?embedded=true"))).toBe("openai");
    for (const referrer of [undefined, "invalid", testOrigin + "/chat", demoPage + ".fake", "https://other.test/screen-demo-app/index.html"]) {
      expect(extractionProvider(request(referrer))).toBe("gemini");
    }
    vi.stubEnv("SCREEN_DEMO_AI_PROVIDER", "gemini");
    vi.stubEnv("SCREEN_INTAKE_AI_PROVIDER", "openai");
    expect(extractionProvider(request(demoPage))).toBe("gemini");
    expect(extractionProvider(request())).toBe("openai");
  });

  it("uses the direct project, nullable slots and canonical output filtering on the OpenAI route", async () => {
    const fetchMock = stubResponse({ amount_at_stake: "$5,000-$25,000", client_email: "invalid", invented: "invalid" });
    const result = await llmExtractServer(invoice, state, 4000, "openai");
    expect(result).toMatchObject({ mode: "live", attempts: 1, extracted: { amount_at_stake: "$5,000–$25,000" }, tokens: { prompt: 36, completion: 17 } });
    expect(Object.keys(result.extracted)).toEqual(["amount_at_stake"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const sent = JSON.parse(String(init?.body));
    expect(sent.text.format).toMatchObject({ name: "screen_extraction", strict: true, schema: { additionalProperties: false } });
    expect(sent.text.format.schema.properties.amount_at_stake.type).toEqual(["string", "null"]);
    expect(sent.store).toBe(false);
  });

  it("preserves disabled mode without sending intake to another provider when the key is missing", async () => {
    vi.stubEnv("CASELOAD_OPENAI_API_KEY", "");
    vi.stubEnv("GOOGLE_AI_API_KEY", "google-fixture");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await llmExtractServer(invoice, state, 4000, "openai")).mode).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves an ambiguous reply for the deterministic clarifier", async () => {
    stubResponse({ value: null });
    const answer = await llmMapOptionReply({
      questionLabel: "Has it been filed?", options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }],
      reply: "I am unsure", language: "en",
    }, "openai");
    expect(answer).toEqual({ mode: "live", value: null });
  });

  it("keeps the existing heuristic when GPT returns an invalid voice branch", async () => {
    vi.stubEnv("SCREEN_INTAKE_AI_PROVIDER", "openai");
    stubResponse({ branch: "invented" });
    const transcript = "You have the wrong number.";
    expect(await classifyVoiceBranchServer(transcript)).toMatchObject({ mode: "error", branch: classifyVoiceBranchHeuristic(transcript) });
  });
});

describe("Firm Assist answer routing", () => {
  it("uses only the supplied firm context and returns the generation model", async () => {
    vi.stubEnv("FIRM_ASSIST_ANSWER_AI_PROVIDER", "openai");
    vi.stubEnv("FIRM_ASSIST_OPENAI_MODEL", "fixture-model");
    const fetchMock = stubResponse({ intent: "informational", answer_html: "<p>Open on Mondays.</p>", source_page_ids: ["hours"] });
    const r = await generateAnswer("When is the office open?", "Test Firm", [{ page_id: "hours", heading: "Hours", chunk_text: "Open on Mondays." }]);
    expect(r).toMatchObject({ mode: "live", model: "fixture-model", response: { source_page_ids: ["hours"] } });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.input).toContain("page_id=hours");
    expect(sent.instructions).toContain("Test Firm");
  });

  it("rejects an unrecognized answer intent", async () => {
    vi.stubEnv("FIRM_ASSIST_ANSWER_AI_PROVIDER", "openai");
    stubResponse({ intent: "invented", answer_html: "test", source_page_ids: [] });
    expect(await generateAnswer("Test?", "Test Firm", [])).toEqual({ mode: "error", reason: "invalid_response_shape" });
  });
});
