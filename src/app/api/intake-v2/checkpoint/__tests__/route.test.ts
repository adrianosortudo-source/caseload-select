import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  firmRow: { id: "11111111-1111-1111-1111-111111111111" } as { id: string } | null,
  checkpointResult: { ok: true } as { ok: boolean; error?: string; skipped?: string },
  checkpointArgs: [] as unknown[],
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mocks.firmRow, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/intake-v2-security", () => ({
  originAllowed: () => Promise.resolve({ ok: true }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => Promise.resolve({ ok: true, reset: Date.now() + 60_000 }),
  ipFromRequest: () => "127.0.0.1",
  rateLimitHeaders: () => ({}),
}));

vi.mock("@/lib/web-intake-session-store", () => ({
  checkpointWebSession: (...args: unknown[]) => {
    mocks.checkpointArgs.push(args);
    return Promise.resolve(mocks.checkpointResult);
  },
}));

import { POST } from "../route";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";

function makeReq(body: unknown): Request {
  return new Request("https://app.caseloadselect.ca/api/intake-v2/checkpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.firmRow = { id: FIRM_ID };
  mocks.checkpointResult = { ok: true };
  mocks.checkpointArgs = [];
});

describe("POST /api/intake-v2/checkpoint", () => {
  it("checkpoints a valid payload", async () => {
    const res = await POST(
      makeReq({ firmId: FIRM_ID, lead_id: "L-1", engine_state: { lead_id: "L-1" } }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mocks.checkpointArgs).toHaveLength(1);
  });

  it("returns ok:false without persisting for demo mode (no firmId)", async () => {
    const res = await POST(makeReq({ lead_id: "L-1", engine_state: {} }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mocks.checkpointArgs).toHaveLength(0);
  });

  it("returns ok:false for demo_firm sentinel", async () => {
    const res = await POST(
      makeReq({ firmId: "demo_firm", lead_id: "L-1", engine_state: {} }) as never,
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("demo_or_no_firm");
  });

  it("returns ok:false when lead_id is missing", async () => {
    const res = await POST(makeReq({ firmId: FIRM_ID, engine_state: {} }) as never);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("invalid_lead_id");
  });

  it("returns ok:false when engine_state is not an object", async () => {
    const res = await POST(
      makeReq({ firmId: FIRM_ID, lead_id: "L-1", engine_state: "not an object" }) as never,
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("invalid_engine_state");
  });

  it("returns ok:false when engine_state exceeds the size cap", async () => {
    const huge = { blob: "x".repeat(250_000) };
    const res = await POST(
      makeReq({ firmId: FIRM_ID, lead_id: "L-1", engine_state: huge }) as never,
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("engine_state_too_large");
  });

  it("returns ok:false when the firm cannot be resolved", async () => {
    mocks.firmRow = null;
    const res = await POST(
      makeReq({ firmId: FIRM_ID, lead_id: "L-1", engine_state: {} }) as never,
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("firm_not_found");
  });

  it("never returns a non-200 for malformed JSON (telemetry, not the intake path)", async () => {
    const res = await POST(
      new Request("https://app.caseloadselect.ca/api/intake-v2/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }) as never,
    );
    expect(res.status).toBe(200);
  });
});
