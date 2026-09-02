import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  ipFromRequest: vi.fn(() => "203.0.113.10"),
  sendEmail: vi.fn(),
  generatePortalToken: vi.fn(() => "operator-token.sig"),
  buildMagicLinkUrl: vi.fn(() => "https://app.caseloadselect.ca/api/operator/login?token=operator-token.sig"),
  renderMagicLinkEmail: vi.fn(() => "<html>operator</html>"),
}));

const state = vi.hoisted(() => ({
  rows: null as unknown[] | null,
  error: null as { message: string } | null,
  filters: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: mocks.ipFromRequest,
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/portal-auth", () => ({ generatePortalToken: mocks.generatePortalToken }));
vi.mock("@/lib/portal-magic-link", () => ({
  buildMagicLinkUrl: mocks.buildMagicLinkUrl,
  renderMagicLinkEmail: mocks.renderMagicLinkEmail,
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      const builder = {
        ilike: () => builder,
        eq: (column: string, value: unknown) => {
          state.filters.push([column, value]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        returns: () => Promise.resolve({ data: state.rows, error: state.error }),
      };
      return { select: () => builder };
    },
  },
}));

import { POST } from "../route";
import type { NextRequest } from "next/server";

function request(body: unknown): NextRequest {
  return new Request("https://app.caseloadselect.ca/api/operator/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ ok: true, remaining: 5 });
  mocks.sendEmail.mockResolvedValue({ skipped: false, id: "email-1" });
  state.rows = [];
  state.error = null;
  state.filters = [];
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => consoleErrorSpy.mockRestore());

describe("POST /api/operator/request-link", () => {
  it("selects only an active operator membership and emits an operator consumer link", async () => {
    state.rows = [{
      id: "operator-1",
      firm_id: "firm-1",
      role: "operator",
      intake_firms: { id: "firm-1", name: "Test Firm", branding: null },
    }];

    const res = await POST(request({ email: "OPERATOR@example.com" }));

    expect(await res.json()).toEqual({ ok: true });
    expect(state.filters).toContainEqual(["disabled", false]);
    expect(state.filters).toContainEqual(["role", "operator"]);
    expect(mocks.generatePortalToken).toHaveBeenCalledWith("firm-1", {
      role: "operator",
      lawyer_id: "operator-1",
    });
    expect(mocks.buildMagicLinkUrl).toHaveBeenCalledWith("operator-token.sig", "operator");
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      "operator@example.com",
      "CaseLoad Select operator sign-in link",
      "<html>operator</html>",
    );
  });

  it.each([
    ["malformed email", { email: "not-an-email" }],
    ["no match", { email: "missing@example.com" }],
  ])("returns the same generic success for %s", async (_label, body) => {
    const res = await POST(request(body));
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("returns generic success when rate limited without querying or sending", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, remaining: 0 });
    const res = await POST(request({ email: "operator@example.com" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(state.filters).toEqual([]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("logs a DB failure without exposing the requested email", async () => {
    state.error = { message: "database unavailable" };
    const res = await POST(request({ email: "operator@example.com" }));
    expect(await res.json()).toEqual({ ok: true });
    const messages = consoleErrorSpy.mock.calls.map((call) => call.join(" "));
    expect(messages.some((m) => m.includes("operator lookup failed"))).toBe(true);
    expect(messages.some((m) => m.includes("operator@example.com"))).toBe(false);
  });

  it("logs a send failure but keeps the anti-enumeration response", async () => {
    state.rows = [{
      id: "operator-1",
      firm_id: "firm-1",
      role: "operator",
      intake_firms: { id: "firm-1", name: "Test Firm", branding: null },
    }];
    mocks.sendEmail.mockRejectedValue(new Error("Resend unavailable"));
    const res = await POST(request({ email: "operator@example.com" }));
    expect(await res.json()).toEqual({ ok: true });
    const messages = consoleErrorSpy.mock.calls.map((call) => call.join(" "));
    expect(messages.some((m) => m.includes("email send failed"))).toBe(true);
  });
});
