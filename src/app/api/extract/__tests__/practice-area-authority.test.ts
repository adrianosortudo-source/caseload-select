import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  llmExtractServer: vi.fn(),
  generateContent: vi.fn(),
  captureModelOptions: vi.fn(),
  providerJson: "{}",
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: vi.fn(() => "203.0.113.44"),
  rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/screen-llm-server", () => ({ llmExtractServer: mocks.llmExtractServer }));
vi.mock("@/lib/llm-option-map", () => ({ llmMapOptionReply: vi.fn() }));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(options: unknown) {
      mocks.captureModelOptions(options);
      return { generateContent: mocks.generateContent };
    }
  },
}));

import { POST } from "../route";
import type { EngineState } from "@/lib/screen-engine/types";

function request(body: Record<string, unknown>): Request {
  return new Request("https://app.caseloadselect.ca/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function familyRouting(revision = 3) {
  return { selection: "family", active_area: "family", revision };
}

function modelProperties(): Record<string, unknown> {
  const options = mocks.captureModelOptions.mock.calls.at(-1)?.[0] as {
    generationConfig?: { responseSchema?: { properties?: Record<string, unknown> } };
  } | undefined;
  return options?.generationConfig?.responseSchema?.properties ?? {};
}

function respondWith(payload: Record<string, unknown>) {
  mocks.providerJson = JSON.stringify(payload);
  mocks.generateContent.mockResolvedValue({
    response: { text: () => mocks.providerJson, usageMetadata: {} },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_AI_API_KEY", "mock-only-key");
  mocks.checkRateLimit.mockResolvedValue({ ok: true, active: false, remaining: 30, reset: 0, limit: 30 });
  mocks.llmExtractServer.mockResolvedValue({ mode: "live", extracted: {} });
  respondWith({});
});

afterEach(() => vi.unstubAllEnvs());

const familyRequest = {
  description: "my ex wife wont allow me to enter our home and pick up my stuff",
  matter_type: "family_general",
  family_enabled: true,
  routing: familyRouting(),
};

describe("/api/extract practice-area boundary", () => {
  it("rejects malformed routing, foreign matter, and foreign request slots before extraction", async () => {
    const invalidRequests = [
      { ...familyRequest, routing: { selection: "home", active_area: "family", revision: 3 } },
      { ...familyRequest, routing: { selection: "family", active_area: "real_estate", revision: 3 } },
      { ...familyRequest, routing: { selection: "family", active_area: "family", revision: -1 } },
      { ...familyRequest, matter_type: "not_a_real_matter" },
      { ...familyRequest, already_extracted: { residential_role: "Buying" } },
      { ...familyRequest, already_extracted: { unknown_provider_slot: "forged" } },
    ];

    for (const body of invalidRequests) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.llmExtractServer).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("builds a consistent Family state for the exact weak-home-keyword narrative", async () => {
    mocks.llmExtractServer.mockResolvedValue({ mode: "live", extracted: {} });
    const response = await POST(request({
      ...familyRequest,
      already_extracted: { client_name: "Avery Chen" },
    }));
    expect(response.status).toBe(200);

    const [description, state] = mocks.llmExtractServer.mock.calls[0] as [string, {
      practice_area: string; matter_type: string; input: string; slots: Record<string, string | null>; demoRouting?: { selection: string };
    }];
    expect(state).toMatchObject({
      input: description,
      practice_area: "family",
      matter_type: "family_general",
      slots: { client_name: "Avery Chen" },
      demoRouting: { selection: "family" },
    });
    expect(description).toBe(familyRequest.description);
  });

  it("filters malformed and foreign provider fields while retaining a valid independent candidate", async () => {
    const actual = await vi.importActual<typeof import("@/lib/screen-llm-server")>("@/lib/screen-llm-server");
    const { initialiseState } = await import("@/lib/screen-engine/extractor");
    const description = familyRequest.description;
    const state = {
      ...initialiseState(description),
      practice_area: "family" as const,
      matter_type: "family_general" as const,
      family_enabled: true,
      demoRouting: { selection: "family" as const, candidate: null, pending: null, revision: 3, declinedCandidate: null },
    };
    respondWith({
      __practice_area: "real_estate",
      family_children: "Yes",
      family_existing_order: "Sometimes",
      residential_role: "Buying",
      invented_provider_field: "fabricated",
    });

    const result = await actual.llmExtractServer(description, state, 16_000);
    expect(result.mode).toBe("live");
    expect(result.extracted).toMatchObject({ __practice_area: "real_estate", family_children: "Yes" });
    expect(result.extracted.family_existing_order).toBeUndefined();
    expect(result.extracted.residential_role).toBeUndefined();
    expect(result.extracted.invented_provider_field).toBeUndefined();
    expect(mocks.generateContent).toHaveBeenCalledOnce();

    const properties = modelProperties();
    expect(properties.__practice_area).toBeDefined();
    expect(properties.family_children).toBeDefined();
    expect(properties.residential_role).toBeUndefined();
  });

  it("uses the confirmed active area after a switch while preserving the original selection label", async () => {
    mocks.llmExtractServer.mockResolvedValue({ mode: "live", extracted: { residential_role: "Buying" } });
    const response = await POST(request({
      description: familyRequest.description,
      matter_type: "residential_purchase_sale",
      family_enabled: true,
      routing: { selection: "family", active_area: "real_estate", revision: 5 },
    }));

    expect(response.status).toBe(200);
    const [, state] = mocks.llmExtractServer.mock.calls[0] as [string, {
      practice_area: string; matter_type: string; demoRouting?: { selection: string; revision: number };
    }];
    expect(state).toMatchObject({
      practice_area: "real_estate",
      matter_type: "residential_purchase_sale",
      demoRouting: { selection: "family", revision: 5 },
    });
    const actual = await vi.importActual<typeof import("@/lib/screen-llm-server")>("@/lib/screen-llm-server");
    respondWith({ residential_role: "Buying", family_children: "Yes" });
    const extracted = await actual.llmExtractServer(familyRequest.description, state as EngineState, 16_000);
    expect(extracted.extracted.residential_role).toBe("Buying");
    expect(extracted.extracted.family_children).toBeUndefined();
    const properties = modelProperties();
    expect(properties.__practice_area).toBeDefined();
    expect(properties.residential_role).toBeDefined();
    expect(properties.family_children).toBeUndefined();
  });

  it("keeps legacy calls without routing compatible", async () => {
    mocks.llmExtractServer.mockResolvedValue({ mode: "live", extracted: { residential_role: "Selling" } });
    const response = await POST(request({
      description: "I am selling my home.",
      matter_type: "residential_purchase_sale",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "live", extracted: { residential_role: "Selling" } });
    const [, state] = mocks.llmExtractServer.mock.calls[0] as [string, EngineState];
    expect(state).toMatchObject({ practice_area: "real_estate", matter_type: "residential_purchase_sale" });
    expect(state.demoRouting).toBeUndefined();
  });
});




