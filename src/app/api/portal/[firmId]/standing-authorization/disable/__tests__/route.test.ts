/**
 * POST .../standing-authorization/disable: auth gate (lawyer-only) and
 * validation. Mirrors enable/__tests__/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

const state = {
  firmSession: null as { firm_id: string; role: string; lawyer_id?: string } | null,
  actor: { role: "lawyer" as const, id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" },
  disableResult: { ok: true, eventId: "e2", eventSeq: 2, event: "disabled" as const, effectiveAt: "2026-07-17T02:00:00Z" } as
    | { ok: true; eventId: string; eventSeq: number; event: "enabled" | "disabled"; effectiveAt: string }
    | { ok: false; error: string },
  disableCallArgs: null as unknown,
  previewDenied: null as { status: number; body: { error: string; code: string } } | null,
};

vi.mock("@/lib/portal-auth", () => ({
  getFirmSession: () => Promise.resolve(state.firmSession),
}));

vi.mock("@/lib/preview-guard", () => ({
  denyWriteIfPreview: () => {
    if (!state.previewDenied) return Promise.resolve(null);
    const denial = state.previewDenied;
    return Promise.resolve({
      status: denial.status,
      json: async () => denial.body,
    });
  },
}));

vi.mock("@/lib/standing-publishing-authorization", () => ({
  resolveFirmLawyerIdentity: () => Promise.resolve(state.actor),
  disableStandingAuthorization: (args: unknown) => {
    state.disableCallArgs = args;
    return Promise.resolve(state.disableResult);
  },
}));

import { POST } from "../route";

function makeReq(body?: unknown): NextRequest {
  return { json: async () => body ?? {}, headers: new Headers() } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ firmId: FIRM }) } as never;
}

beforeEach(() => {
  state.firmSession = { firm_id: FIRM, role: "lawyer", lawyer_id: "law-1" };
  state.actor = { role: "lawyer", id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" };
  state.disableResult = { ok: true, eventId: "e2", eventSeq: 2, event: "disabled", effectiveAt: "2026-07-17T02:00:00Z" };
  state.disableCallArgs = null;
  state.previewDenied = null;
});

describe("POST disable: support preview", () => {
  it("returns the support-preview contract and never reaches getFirmSession when denyWriteIfPreview denies (guard-first)", async () => {
    state.previewDenied = {
      status: 403,
      body: {
        error: "Support preview is read-only. Complete this action from the firm’s own authorized session.",
        code: "support_preview_read_only",
      },
    };
    const res = await POST(makeReq({ agreed: true }), params());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("support_preview_read_only");
    expect(state.disableCallArgs).toBeNull();
  });

  it("proceeds to the normal lawyer-only auth gate when denyWriteIfPreview allows (no active preview)", async () => {
    state.previewDenied = null;
    const res = await POST(makeReq({ agreed: true }), params());
    expect(res.status).toBe(200);
  });
});

describe("POST disable: auth gate", () => {
  it("401s when there is no lawyer session (operator/client never resolve one)", async () => {
    state.firmSession = null;
    const res = await POST(makeReq({ agreed: true }), params());
    expect(res.status).toBe(401);
    expect(state.disableCallArgs).toBeNull();
  });
});

describe("POST disable: validation", () => {
  it("400s when agreed is not exactly true", async () => {
    const res = await POST(makeReq({ agreed: false }), params());
    expect(res.status).toBe(400);
    expect(state.disableCallArgs).toBeNull();
  });

  it("400s when the resolved lawyer has no email on file", async () => {
    state.actor = { role: "lawyer", id: "law-1", name: "Damaris", email: "" };
    const res = await POST(makeReq({ agreed: true }), params());
    expect(res.status).toBe(400);
  });
});

describe("POST disable: success", () => {
  it("passes a trimmed reason through, or null when omitted", async () => {
    await POST(makeReq({ agreed: true, reason: "  testing revocation  " }), params());
    expect((state.disableCallArgs as { reason: string | null }).reason).toBe("testing revocation");

    await POST(makeReq({ agreed: true }), params());
    expect((state.disableCallArgs as { reason: string | null }).reason).toBeNull();
  });

  it("200s with the event id on success", async () => {
    const res = await POST(makeReq({ agreed: true }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.eventId).toBe("e2");
  });
});
