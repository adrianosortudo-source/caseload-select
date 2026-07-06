/**
 * Tests for POST /api/portal/request-link.
 *
 * This route is intentionally always-200-{ok:true} (anti-enumeration): a
 * different response code or shape on a no-match / internal-failure path
 * would let an attacker learn something about which lawyer emails are
 * authorized. These tests pin two things:
 *
 *   1. The external response NEVER changes shape, even when the
 *      firm_lawyers lookup errors, the legacy intake_firms lookup errors,
 *      or the Resend send throws.
 *   2. Those three failure modes are no longer invisible: each logs via
 *      console.error with a stage-identifying tag, without ever including
 *      the raw email address (kept out of the assertions on purpose here,
 *      but also verified there is no literal email substring in the log
 *      call args).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  sendEmail: vi.fn(),
  generatePortalToken: vi.fn(() => "tok.sig"),
}));

const state = vi.hoisted(() => ({
  // firm_lawyers query result
  lawyerRows: null as unknown[] | null,
  lawyerError: null as { message: string } | null,
  // legacy intake_firms query result
  legacyFirms: null as unknown[] | null,
  legacyError: null as { message: string } | null,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: mocks.ipFromRequest,
}));

vi.mock("@/lib/email", () => ({
  sendEmail: mocks.sendEmail,
}));

vi.mock("@/lib/portal-auth", () => ({
  generatePortalToken: mocks.generatePortalToken,
}));

vi.mock("@/lib/supabase-admin", () => {
  const from = (table: string) => {
    if (table === "firm_lawyers") {
      // .select(...).ilike(...).eq(...).order(...).limit(...).returns<T>()
      const builder = {
        ilike: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        returns: () =>
          Promise.resolve({ data: state.lawyerRows, error: state.lawyerError }),
      };
      return { select: () => builder };
    }
    if (table === "intake_firms") {
      // .select(...).filter(...)
      return {
        select: () => ({
          filter: () =>
            Promise.resolve({ data: state.legacyFirms, error: state.legacyError }),
        }),
      };
    }
    throw new Error(`unexpected table in test: ${table}`);
  };
  return { supabaseAdmin: { from } };
});

import { POST } from "../route";
import type { NextRequest } from "next/server";

const ALLOWED = { ok: true, active: false, remaining: 5, reset: 0, limit: 5 };

function makeRequest(body: unknown): NextRequest {
  return new Request("https://app.caseloadselect.ca/api/portal/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(ALLOWED);
  mocks.ipFromRequest.mockReturnValue("203.0.113.9");
  mocks.sendEmail.mockResolvedValue({ skipped: false, id: "email-1" });
  mocks.generatePortalToken.mockReturnValue("tok.sig");
  state.lawyerRows = null;
  state.lawyerError = null;
  state.legacyFirms = null;
  state.legacyError = null;
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("POST /api/portal/request-link", () => {
  it("firm_lawyers lookup failure still returns { ok: true } and logs internally", async () => {
    state.lawyerRows = null;
    state.lawyerError = { message: "connection reset" };
    // Legacy fallback also finds nothing, so we hit the final no-match silent path.
    state.legacyFirms = [];
    state.legacyError = null;

    const res = await POST(makeRequest({ email: "lawyer@example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    expect(consoleErrorSpy).toHaveBeenCalled();
    const messages = consoleErrorSpy.mock.calls.map((call) => call.join(" "));
    expect(messages.some((m) => m.includes("firm_lawyers lookup"))).toBe(true);
    // Anti-enumeration: never log the raw email.
    expect(messages.some((m) => m.includes("lawyer@example.com"))).toBe(false);
  });

  it("legacy firm lookup failure still returns { ok: true } and logs internally", async () => {
    // firm_lawyers finds nothing (no error) so we fall through to legacy.
    state.lawyerRows = [];
    state.lawyerError = null;
    state.legacyFirms = null;
    state.legacyError = { message: "timeout" };

    const res = await POST(makeRequest({ email: "lawyer@example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    expect(consoleErrorSpy).toHaveBeenCalled();
    const messages = consoleErrorSpy.mock.calls.map((call) => call.join(" "));
    expect(messages.some((m) => m.includes("legacy firm lookup"))).toBe(true);
    expect(messages.some((m) => m.includes("lawyer@example.com"))).toBe(false);
  });

  it("sendEmail failure still returns { ok: true } and logs internally", async () => {
    state.lawyerRows = [
      {
        id: "lawyer-1",
        firm_id: "firm-1",
        email: "lawyer@example.com",
        role: "lawyer",
        intake_firms: { id: "firm-1", name: "Test Firm", branding: null },
      },
    ];
    state.lawyerError = null;
    mocks.sendEmail.mockRejectedValue(new Error("Resend 500"));

    const res = await POST(makeRequest({ email: "lawyer@example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    const messages = consoleErrorSpy.mock.calls.map((call) => call.join(" "));
    expect(messages.some((m) => m.includes("email send"))).toBe(true);
    expect(messages.some((m) => m.includes("Resend 500"))).toBe(true);
  });

  it("golden path: real match + successful send returns { ok: true } with no console.error", async () => {
    state.lawyerRows = [
      {
        id: "lawyer-1",
        firm_id: "firm-1",
        email: "lawyer@example.com",
        role: "lawyer",
        intake_firms: { id: "firm-1", name: "Test Firm", branding: null },
      },
    ];
    state.lawyerError = null;
    mocks.sendEmail.mockResolvedValue({ skipped: false, id: "email-1" });

    const res = await POST(makeRequest({ email: "lawyer@example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("rate-limited request still returns { ok: true } (unchanged behavior)", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false, active: true, remaining: 0, reset: Date.now() + 1000, limit: 5 });
    const res = await POST(makeRequest({ email: "lawyer@example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("invalid email still returns { ok: true } (unchanged behavior)", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
