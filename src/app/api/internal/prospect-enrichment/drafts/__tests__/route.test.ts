import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  stage: vi.fn(),
}));

vi.mock("@/lib/gta-prospect-agent-draft-inbox", () => ({
  stageGtaProspectAgentDraft: state.stage,
}));

import { POST } from "../route";

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
