import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { AnalysisRequestEnvelope, DesiredClientAnswers } from "@/lib/desired-client/types";

const generative = vi.hoisted(() => ({ GoogleGenerativeAI: vi.fn() }));
vi.mock("@google/generative-ai", () => generative);

import { GoogleGenerativeAI } from "@google/generative-ai";
import { POST } from "../route";

const ROUTE = "https://app.caseloadselect.ca/api/tools/desired-client-matter/analyze";
const B0: DesiredClientAnswers = {
  schema_version: "dcm-v2.1", revision: 1,
  focus: { area: "business", work: "business_agreements", work_other: "", service_area: "Ontario", certainty: "chosen", route: "established", comparison: null },
  situation: { timing: "planning", role: "business_organization", role_other: "", contact: null },
  client: { goals: ["complete"], concerns: ["cost", "next"] },
  value: { reasons: ["client_benefit", "fees", "skills"], fee_effort: "worthwhile", collected_fee: null, team_hours: null, payment: null },
  delivery: { conditions: ["scope", "information"], capacity: "room", limit: null },
  direction: { aim: "more_current", evidence: ["repeated", "records"], less: null, less_note: "" },
  clarifications: { FOCUS_UNCLEAR: null, CLIENT_GOAL_UNCLEAR: null, CURRENT_CAPACITY_CONFLICT: null, FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null },
};
const ENVELOPE: AnalysisRequestEnvelope = {
  schemaVersion: 2,
  requestId: "11111111-1111-4111-8111-111111111111",
  answerRevision: 1,
  reviewRunId: "22222222-2222-4222-8222-222222222222",
  analysisIndex: 0,
  aiConsent: true,
  answers: B0,
  clarifications: [],
};

function browserHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "content-type": "application/json",
    origin: "https://app.caseloadselect.ca",
    "sec-fetch-site": "same-origin",
    ...extra,
  });
}

function makeRequest(body: string, extra: Record<string, string> = {}): NextRequest {
  return new Request(ROUTE, { method: "POST", headers: browserHeaders(extra), body }) as unknown as NextRequest;
}

async function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("POST /api/tools/desired-client-matter/analyze safe HTTP scaffold", () => {
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
  });

  it("rejects declared oversize bodies before parsing", async () => {
    const response = await POST(makeRequest("{}", { "content-length": "32769" }));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("TOO_LARGE");
    await expectNoStore(response);
  });

  it.each(["missing", "false-small"]) ("hard-caps and cancels a streaming body when Content-Length is %s", async (lengthMode) => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls >= 8) { controller.close(); return; }
        pulls += 1;
        controller.enqueue(new Uint8Array(8192).fill(65));
      },
      cancel() { cancelled = true; },
    });
    const headers = browserHeaders(lengthMode === "false-small" ? { "content-length": "1" } : {});
    const request = new Request(ROUTE, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit) as unknown as NextRequest;
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("TOO_LARGE");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(8);
    await expectNoStore(response);
  });

  it("strictly rejects an invalid envelope without calling an external provider", async () => {
    const invalid = { ...ENVELOPE, answers: { ...B0, extra: "sentinel" } };
    const response = await POST(makeRequest(JSON.stringify(invalid)));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(GoogleGenerativeAI).not.toHaveBeenCalled();
    await expectNoStore(response);
  });

  it("accepts a valid app-origin iframe request but keeps provider transmission disabled", async () => {
    const request = new Request(ROUTE, {
      method: "POST",
      headers: browserHeaders({ referer: "https://caseloadselect.ca/tools/desired-client-matter" }),
      body: JSON.stringify(ENVELOPE),
    }) as unknown as NextRequest;
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      requestId: ENVELOPE.requestId,
      error: { code: "AI_DISABLED" },
    });
    expect(GoogleGenerativeAI).not.toHaveBeenCalled();
    await expectNoStore(response);
  });
});
