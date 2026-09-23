import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  stage: vi.fn(),
  enrichmentStage: vi.fn(),
  receipt: vi.fn(),
  legacyModuleLoaded: (() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:3100";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "synthetic-unit-test-service-role-key";
    return true;
  })(),
}));

vi.mock("@/lib/gta-prospect-agent-draft-inbox", () => ({
  stageGtaProspectAgentDraft: state.stage,
}));

vi.mock("@/lib/prospect-enrichment-store", () => ({
  ProspectEnrichmentStoreError: class ProspectEnrichmentStoreError extends Error {
    status: number;
    code: string;
    constructor(message: string, status = 503, code = "error") { super(message); this.status = status; this.code = code; }
  },
  stageProspectEnrichmentPackage: state.enrichmentStage,
  getProspectEnrichmentOperatorReceipt: state.receipt,
}));

import { POST } from "../route";
import { GET as getReceipt } from "../[packageId]/receipt/route";

const strongToken = "gta-prospect-agent-draft-token-32bytes-0001";

function request(token: string) {
  return new NextRequest("https://example.test/api/internal/prospect-enrichment/drafts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "test-draft-0001",
    },
    body: JSON.stringify({ sourceName: "test-agent", records: [] }),
  });
}

beforeEach(() => {
  vi.stubEnv("GTA_PROSPECT_AGENT_DRAFT_TOKEN", strongToken);
  state.stage.mockReset();
  state.receipt.mockReset();
  state.receipt.mockResolvedValue({ packageId: "11111111-1111-4111-8111-111111111111", state: "received" });
  state.stage.mockResolvedValue({
    state: "created",
    draftId: "11111111-1111-4111-8111-111111111111",
    payloadSha256: "a".repeat(64),
    review: {
      summary: { invalid: 0, duplicate: 0, reviewRequired: 0 },
    },
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("prospect-enrichment draft bearer gate", () => {
  it("fails closed when the configured bearer token is below the 32-byte minimum", async () => {
    vi.stubEnv("GTA_PROSPECT_AGENT_DRAFT_TOKEN", "too-short");

    const response = await POST(request("too-short"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(state.stage).not.toHaveBeenCalled();
  });

  it("accepts a matching bearer only after a strong configured token is present", async () => {
    const response = await POST(request(strongToken));

    expect(response.status).toBe(201);
    expect(state.stage).toHaveBeenCalledOnce();
  });
});

describe("prospect-enrichment agent receipt read-back", () => {
  it("returns the configured actor's receipt privately", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const req = new NextRequest(`https://example.test/api/internal/prospect-enrichment/drafts/${id}/receipt`, {
      headers: { authorization: `Bearer ${strongToken}` },
    });

    const response = await getReceipt(req, { params: Promise.resolve({ packageId: id }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.receipt).toHaveBeenCalledWith({ packageId: id, submittedBy: "authorized-agent" });
  });

  it("hides receipt existence from unauthorized callers before lookup", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const req = new NextRequest(`https://example.test/api/internal/prospect-enrichment/drafts/${id}/receipt`, {
      headers: { authorization: "Bearer incorrect-token" },
    });

    const response = await getReceipt(req, { params: Promise.resolve({ packageId: id }) });

    expect(response.status).toBe(404);
    expect(state.receipt).not.toHaveBeenCalled();
  });
});
