/**
 * Tests for POST /api/start-conversation.
 *
 * Covers the plan's acceptance criteria most directly tied to this route:
 * 1. A submission without the consent box checked persists nothing and
 *    sends nothing.
 * 2. Both outcome paths submit identical payloads; banding never blocks
 *    persistence or the brief.
 * Plus the honeypot drop, rate limiting, validation rejection, and the
 * persistence-failure / email-failure error paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  checkRateLimit: vi.fn(),
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  sendEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: mocks.ipFromRequest,
  rateLimitHeaders: () => ({}),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: mocks.sendEmail,
}));

import { POST } from "../route";

function validAnswers(overrides: Record<string, unknown> = {}) {
  return {
    practice_area: "employment",
    practice_area_other: "",
    firm_size: "just_me",
    prompt_reason: "too_few_inquiries",
    prompt_reason_other: "",
    decision_role: "i_do",
    timeline: "this_month",
    name: "Jordan Lee",
    firm_name: "Lee Law",
    email: "jordan@leelaw.ca",
    province: "ON",
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new Request("https://www.caseloadselect.ca/api/start-conversation", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ ok: true, active: true, remaining: 9, reset: 0, limit: 10 });
  mocks.rpc.mockResolvedValue({ data: { ok: true, prospect_id: "p1" }, error: null });
  mocks.sendEmail.mockResolvedValue({ skipped: false, id: "email1" });
});

describe("POST /api/start-conversation", () => {
  it("rejects malformed JSON", async () => {
    const req = new Request("https://www.caseloadselect.ca/api/start-conversation", {
      method: "POST",
      body: "not json",
    }) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("acceptance criterion 1: an unchecked consent box persists nothing and sends nothing, 400", async () => {
    const res = await POST(makeRequest({ ...validAnswers(), consent: { granted: false } }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("persists nothing and sends nothing when consent is entirely missing from the body", async () => {
    const res = await POST(makeRequest(validAnswers()));
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("persists nothing and sends nothing when consent.granted is a truthy non-boolean", async () => {
    const res = await POST(makeRequest({ ...validAnswers(), consent: { granted: "yes" } }));
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid answers before checking consent or persisting", async () => {
    const res = await POST(
      makeRequest({ ...validAnswers({ practice_area: "tax_law" }), consent: { granted: true } }),
    );
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns 429 and never persists when rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, active: true, remaining: 0, reset: Date.now(), limit: 10 });
    const res = await POST(makeRequest({ ...validAnswers(), consent: { granted: true } }));
    expect(res.status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("drops a honeypot-tripped submission with a fake success, no persistence, no email", async () => {
    const res = await POST(
      makeRequest({ ...validAnswers(), consent: { granted: true }, firm_website_url: "http://spam.example" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("acceptance criterion 2: the booking outcome persists and sends exactly like the reply outcome", async () => {
    const res = await POST(
      makeRequest({ ...validAnswers({ decision_role: "i_do", timeline: "this_month" }), consent: { granted: true } }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.outcome).toBe("booking");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const rpcArgs = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs.p_outcome).toBe("booking");
  });

  it("acceptance criterion 2: the reply outcome persists and sends identically to booking", async () => {
    const res = await POST(
      makeRequest({
        ...validAnswers({ decision_role: "someone_else", timeline: "researching" }),
        consent: { granted: true },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.outcome).toBe("reply");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const rpcArgs = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs.p_outcome).toBe("reply");
  });

  it("stamps the consent evidence server-side rather than trusting the request body", async () => {
    await POST(
      makeRequest({
        ...validAnswers(),
        consent: { granted: true, textVersion: "attacker-supplied-version", capturedAtIso: "2000-01-01" },
      }),
    );
    const rpcArgs = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs.p_consent_text_version).not.toBe("attacker-supplied-version");
  });

  it("returns 500 and does not send the brief when persistence fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await POST(makeRequest({ ...validAnswers(), consent: { granted: true } }));
    expect(res.status).toBe(500);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("returns 500 when the RPC reports ok=false even without a Postgres error", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, error: "invalid outcome" }, error: null });
    const res = await POST(makeRequest({ ...validAnswers(), consent: { granted: true } }));
    expect(res.status).toBe(500);
  });

  it("still returns 200 to the visitor when the persisted-but-email-failed case occurs", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("resend down"));
    const res = await POST(makeRequest({ ...validAnswers(), consent: { granted: true } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
