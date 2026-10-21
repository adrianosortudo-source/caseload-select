import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const state: { session: { lawyer_id?: string } | null } = { session: null };
  const getOperatorSession = vi.fn(() => Promise.resolve(state.session));
  const recordAgencyFollowupOptInEvent = vi.fn();
  const listAgencyFollowupOptInHistory = vi.fn();
  class AgencyFollowupOptInError extends Error {
    constructor(message: string, readonly kind: "invalid" | "conflict" | "internal") { super(message); }
  }
  return { state, getOperatorSession, recordAgencyFollowupOptInEvent, listAgencyFollowupOptInHistory, AgencyFollowupOptInError };
});
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: h.getOperatorSession }));
vi.mock("@/lib/agency-followup-opt-in", () => ({
  AgencyFollowupOptInError: h.AgencyFollowupOptInError,
  listAgencyFollowupOptInHistory: h.listAgencyFollowupOptInHistory,
  recordAgencyFollowupOptInEvent: h.recordAgencyFollowupOptInEvent,
}));
import { GET, POST } from "../route";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const CLIENT_ACTOR = "33333333-3333-4333-8333-333333333333";
const BASE = "https://app.caseloadselect.ca/api/admin/agency-crm/follow-up/opt-in";
const PROSPECT = "22222222-2222-4222-8222-222222222222";
const body = {
  prospectId: "22222222-2222-4222-8222-222222222222", eventType: "opt_in_granted",
  capturedAt: "2026-10-20T12:00:00.000Z", captureSource: "subject_email",
  consentTextVersion: "v1", consentTextSha256: "a".repeat(64),
  evidenceReference: "vault://consent/evidence-1", evidenceSha256: "b".repeat(64),
  idempotencyKey: "event-1", evidenceReviewed: true,
};
function request(payload: unknown): NextRequest {
  return new NextRequest(BASE, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } });
}
function getRequest(prospectId?: string): NextRequest {
  return new NextRequest(BASE + (prospectId === undefined ? "" : "?prospectId=" + encodeURIComponent(prospectId)));
}
beforeEach(() => {
  h.state.session = null;
  h.getOperatorSession.mockClear();
  h.recordAgencyFollowupOptInEvent.mockReset().mockResolvedValue({ eventId: "event-id", replayed: false, recipientEmailSha256: "c".repeat(64) });
  h.listAgencyFollowupOptInHistory.mockReset().mockResolvedValue([]);
});
describe("Agency follow-up opt-in route", () => {
  it("requires authentication and operator identity for history reads", async () => {
    expect((await GET(getRequest(PROSPECT))).status).toBe(401);
    h.state.session = {};
    expect((await GET(getRequest(PROSPECT))).status).toBe(403);
    expect(h.listAgencyFollowupOptInHistory).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "not-a-uuid"])("rejects a missing or malformed prospectId with 400", async (prospectId) => {
    h.state.session = { lawyer_id: ACTOR };
    expect((await GET(getRequest(prospectId))).status).toBe(400);
    expect(h.listAgencyFollowupOptInHistory).not.toHaveBeenCalled();
  });
  it("loads history for the requested prospect and authenticated operator", async () => {
    h.state.session = { lawyer_id: ACTOR };
    const events = [{ eventType: "opt_in_granted", capturedAt: "2026-10-20T10:00:00Z", recordedAt: "2026-10-20T10:01:00Z" }];
    h.listAgencyFollowupOptInHistory.mockResolvedValue(events);
    const response = await GET(getRequest(PROSPECT));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events });
    expect(h.listAgencyFollowupOptInHistory).toHaveBeenCalledWith({ prospectId: PROSPECT, actorOperatorId: ACTOR });
  });
  it("returns 401 without a session", async () => {
    expect((await POST(request(body))).status).toBe(401);
    expect(h.recordAgencyFollowupOptInEvent).not.toHaveBeenCalled();
  });
  it("returns 403 when session lacks operator identity", async () => {
    h.state.session = {};
    expect((await POST(request(body))).status).toBe(403);
    expect(h.recordAgencyFollowupOptInEvent).not.toHaveBeenCalled();
  });
  it.each([
    [null],
    [[]],
    [{ ...body, eventType: "approve" }],
    [{ ...body, captureSource: "unverified" }],
    [{ ...body, evidenceReviewed: false }],
    [{ ...body, evidenceSha256: "invalid" }],
  ])("returns 400 for malformed or unsupported evidence fields", async (payload) => {
    h.state.session = { lawyer_id: ACTOR };
    expect((await POST(request(payload))).status).toBe(400);
    expect(h.recordAgencyFollowupOptInEvent).not.toHaveBeenCalled();
  });
  it("returns 201 and takes actor identity from the session, ignoring a client actor field", async () => {
    h.state.session = { lawyer_id: ACTOR };
    const response = await POST(request({ ...body, actorOperatorId: CLIENT_ACTOR }));
    expect(response.status).toBe(201);
    expect(h.recordAgencyFollowupOptInEvent).toHaveBeenCalledWith(expect.objectContaining({ actorOperatorId: ACTOR }));
    expect(h.recordAgencyFollowupOptInEvent).not.toHaveBeenCalledWith(expect.objectContaining({ actorOperatorId: CLIENT_ACTOR }));
  });
  it("returns 200 for an exact idempotent replay", async () => {
    h.state.session = { lawyer_id: ACTOR };
    h.recordAgencyFollowupOptInEvent.mockResolvedValue({ eventId: "event-id", replayed: true, recipientEmailSha256: "c".repeat(64) });
    expect((await POST(request(body))).status).toBe(200);
  });
  it("returns sanitized 409 for a known context conflict", async () => {
    h.state.session = { lawyer_id: ACTOR };
    h.recordAgencyFollowupOptInEvent.mockRejectedValue(new h.AgencyFollowupOptInError("Current opt-in evidence conflicts with the prospect context.", "conflict"));
    const response = await POST(request(body));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Current opt-in evidence conflicts with the prospect context." });
  });
  it("returns sanitized 500 for infrastructure failures", async () => {
    h.state.session = { lawyer_id: ACTOR };
    h.recordAgencyFollowupOptInEvent.mockRejectedValue(new Error("secret database host and credentials"));
    const response = await POST(request(body));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to record Agency follow-up opt-in evidence." });
  });
});
