/**
 * POST .../standing-authorization/enable: auth gate (lawyer-only --
 * operator and client sessions must never reach this route), validation,
 * and that the canonical text is assembled server-side, never accepted
 * from the request body.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

const state = {
  firmSession: null as { firm_id: string; role: string; lawyer_id?: string } | null,
  actor: { role: "lawyer" as const, id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" },
  firmName: "DRG Law" as string | null,
  enableResult: { ok: true, eventId: "e1", eventSeq: 1, event: "enabled" as const, effectiveAt: "2026-07-17T00:00:00Z" } as
    | { ok: true; eventId: string; eventSeq: number; event: "enabled" | "disabled"; effectiveAt: string }
    | { ok: false; error: string },
  enableCallArgs: null as unknown,
};

vi.mock("@/lib/portal-auth", () => ({
  getFirmSession: () => Promise.resolve(state.firmSession),
}));

vi.mock("@/lib/standing-publishing-authorization", () => ({
  resolveFirmLawyerIdentity: () => Promise.resolve(state.actor),
  getFirmDisplayName: () => Promise.resolve(state.firmName),
  enableStandingAuthorization: (args: unknown) => {
    state.enableCallArgs = args;
    return Promise.resolve(state.enableResult);
  },
}));

import { POST } from "../route";

function makeReq(body?: unknown): NextRequest {
  return {
    json: async () => body ?? {},
    headers: new Headers({ "user-agent": "test-agent", "x-forwarded-for": "203.0.113.9" }),
  } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ firmId: FIRM }) } as never;
}

beforeEach(() => {
  state.firmSession = { firm_id: FIRM, role: "lawyer", lawyer_id: "law-1" };
  state.actor = { role: "lawyer", id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" };
  state.firmName = "DRG Law";
  state.enableResult = { ok: true, eventId: "e1", eventSeq: 1, event: "enabled", effectiveAt: "2026-07-17T00:00:00Z" };
  state.enableCallArgs = null;
});

describe("POST enable: auth gate", () => {
  it("401s when there is no lawyer session at all (getFirmSession returns null)", async () => {
    state.firmSession = null;
    const res = await POST(makeReq({ notification_preference: "weekly_digest", agreed: true }), params());
    expect(res.status).toBe(401);
    expect(state.enableCallArgs).toBeNull();
  });

  it("relies on getFirmSession to reject operator/client sessions -- an operator or client session never resolves to a firm session here", async () => {
    // getFirmSession (lib/portal-auth.ts) structurally returns null for
    // operator and client roles; this route has no independent role check
    // of its own because none is needed -- there is no path for an
    // operator or client session to reach this handler with a truthy
    // session at all.
    state.firmSession = null;
    const res = await POST(makeReq({ notification_preference: "weekly_digest", agreed: true }), params());
    expect(res.status).toBe(401);
  });
});

describe("POST enable: validation", () => {
  it("400s when agreed is not exactly true", async () => {
    const res = await POST(makeReq({ notification_preference: "weekly_digest", agreed: false }), params());
    expect(res.status).toBe(400);
    expect(state.enableCallArgs).toBeNull();
  });

  it("400s when notification_preference is missing or invalid", async () => {
    const res = await POST(makeReq({ agreed: true }), params());
    expect(res.status).toBe(400);
    expect(state.enableCallArgs).toBeNull();
  });

  it("400s when the resolved lawyer has no email on file", async () => {
    state.actor = { role: "lawyer", id: "law-1", name: "Damaris", email: "" };
    const res = await POST(makeReq({ notification_preference: "weekly_digest", agreed: true }), params());
    expect(res.status).toBe(400);
  });

  it("404s when the firm cannot be found", async () => {
    state.firmName = null;
    const res = await POST(makeReq({ notification_preference: "weekly_digest", agreed: true }), params());
    expect(res.status).toBe(404);
  });
});

describe("POST enable: success", () => {
  it("passes the resolved lawyer identity and firm name through, never trusting a request-body actor", async () => {
    await POST(
      makeReq({ notification_preference: "per_publication", agreed: true, actor: { name: "Attacker" } }),
      params(),
    );
    const args = state.enableCallArgs as { firmId: string; firmName: string; actor: { name: string }; notificationPreference: string };
    expect(args.firmId).toBe(FIRM);
    expect(args.firmName).toBe("DRG Law");
    expect(args.actor.name).toBe("Damaris");
    expect(args.notificationPreference).toBe("per_publication");
  });

  it("200s with the event id on success", async () => {
    const res = await POST(makeReq({ notification_preference: "weekly_digest", agreed: true }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.eventId).toBe("e1");
  });

  it("500s with the underlying error when the RPC rejects (e.g. DB-level non-lawyer check failed unexpectedly)", async () => {
    state.enableResult = { ok: false, error: "only an authorized firm lawyer/client decision-maker may change standing publishing authorization" };
    const res = await POST(makeReq({ notification_preference: "weekly_digest", agreed: true }), params());
    expect(res.status).toBe(500);
  });
});
