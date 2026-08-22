import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  enabled: false,
  verifiedContext: { surface: "marketing_demo", firmId: null } as { surface: "marketing_demo" | "firm_widget"; firmId: string | null } | null,
  rate: { ok: true, active: true, remaining: 119, reset: Date.now() + 60_000, limit: 120 },
  insertResult: "inserted" as "inserted" | "duplicate" | "conflict" | "error",
  inserts: [] as unknown[][],
  rateCalls: 0,
}));

vi.mock("@/lib/screen-funnel-context", () => ({
  isScreenFunnelTelemetryCollectionEnabled: () => mocks.enabled,
  verifyScreenFunnelContextToken: () => mocks.verifiedContext,
}));
vi.mock("@/lib/screen-funnel-event-store", () => ({
  insertScreenFunnelEvent: (...args: unknown[]) => {
    mocks.inserts.push(args);
    return Promise.resolve(mocks.insertResult);
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => {
    mocks.rateCalls += 1;
    return Promise.resolve(mocks.rate);
  },
  ipFromRequest: () => "203.0.113.2",
  rateLimitHeaders: () => ({ "Retry-After": "60" }),
}));

import { POST } from "../route";

const VALID = {
  schemaVersion: 1,
  eventId: "11111111-1111-4111-8111-111111111111",
  flowId: "22222222-2222-4222-8222-222222222222",
  sequence: 0,
  contextToken: "server-signed-token",
  event: "flow_started",
  stage: "opening",
  stepIndex: 0,
  questionCount: 0,
  locale: "en",
  viewport: "desktop",
  elapsedMs: 0,
};

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://app.caseloadselect.ca/api/screen-funnel/event", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.enabled = false;
  mocks.verifiedContext = { surface: "marketing_demo", firmId: null };
  mocks.rate = { ok: true, active: true, remaining: 119, reset: Date.now() + 60_000, limit: 120 };
  mocks.insertResult = "inserted";
  mocks.inserts = [];
  mocks.rateCalls = 0;
});

describe("POST /api/screen-funnel/event", () => {
  it("returns 204 with no rate-limit or database work while collection is disabled", async () => {
    const response = await POST(request({ opening: "must never be parsed" }) as never);
    expect(response.status).toBe(204);
    expect(mocks.rateCalls).toBe(0);
    expect(mocks.inserts).toEqual([]);
  });

  it("rejects forbidden content fields and unknown nested values without writing", async () => {
    mocks.enabled = true;
    for (const body of [{ ...VALID, answer: "private answer" }, { ...VALID, unknown: { value: "private" } }]) {
      const response = await POST(request(body) as never);
      expect(response.status).toBe(400);
    }
    expect(mocks.inserts).toEqual([]);
  });

  it("rejects oversized and invalidly signed payloads before persistence", async () => {
    mocks.enabled = true;
    expect((await POST(request("x".repeat(1025)) as never)).status).toBe(400);
    mocks.verifiedContext = null;
    expect((await POST(request(VALID) as never)).status).toBe(400);
    expect(mocks.inserts).toEqual([]);
  });

  it("persists only validated fields with server-derived context", async () => {
    mocks.enabled = true;
    mocks.verifiedContext = { surface: "firm_widget", firmId: "33333333-3333-4333-8333-333333333333" };
    const response = await POST(request(VALID) as never);
    expect(response.status).toBe(204);
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0]?.[1]).toEqual(mocks.verifiedContext);
  });

  it("keeps an idempotent retry successful and signals a conflicting sequence", async () => {
    mocks.enabled = true;
    mocks.insertResult = "duplicate";
    expect((await POST(request(VALID) as never)).status).toBe(204);
    mocks.insertResult = "conflict";
    expect((await POST(request(VALID) as never)).status).toBe(409);
  });

  it("rate limits before reading or writing an enabled payload", async () => {
    mocks.enabled = true;
    mocks.rate = { ok: false, active: true, remaining: 0, reset: Date.now() + 60_000, limit: 120 };
    const response = await POST(request(VALID) as never);
    expect(response.status).toBe(429);
    expect(mocks.inserts).toEqual([]);
  });
});
