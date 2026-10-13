import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const state: { session: { lawyer_id?: string } | null } = { session: null };
  const fns = {
    approveAgencyFollowupMessage: vi.fn(() => Promise.resolve()),
    createAgencyFollowupEnrollment: vi.fn(() => Promise.resolve({ enrollmentId: "e", messageCount: 1 })),
    listAgencyFollowupConsole: vi.fn(() => Promise.resolve({ journeys: [], items: [] })),
    pauseAgencyFollowupEnrollment: vi.fn(() => Promise.resolve()),
    releaseAgencyFollowupEnrollment: vi.fn(() => Promise.resolve()),
    setAgencyFollowupEligibility: vi.fn(() => Promise.resolve()),
  };
  return { state, fns };
});

vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: () => Promise.resolve(h.state.session) }));
vi.mock("@/lib/agency-followup-service", () => h.fns);

import { GET, POST } from "../route";

const ID = "11111111-1111-4111-8111-111111111111";
const BASE = "https://app.caseloadselect.ca/api/admin/agency-crm/follow-up";

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest(BASE, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

function responseStatus(response: { status?: number } | undefined): number {
  return response?.status ?? 0;
}

beforeEach(() => {
  h.state.session = null;
  for (const fn of Object.values(h.fns)) fn.mockClear();
});

describe("Agency CRM follow-up API", () => {
  it("requires an operator session and an audit identity", async () => {
    expect(responseStatus(await GET())).toBe(401);
    expect(responseStatus(await POST(request("POST", { action: "enroll" })))).toBe(401);
    h.state.session = {};
    expect(responseStatus(await GET())).toBe(403);
    expect(h.fns.listAgencyFollowupConsole).not.toHaveBeenCalled();
  });

  it("rejects bulk or malformed enrollment requests", async () => {
    h.state.session = { lawyer_id: ID };
    expect(responseStatus(await POST(request("POST", { action: "enroll", journeyId: "bad", prospectId: ID })))).toBe(400);
    expect(h.fns.createAgencyFollowupEnrollment).not.toHaveBeenCalled();
  });

  it("attributes a single-prospect enrollment to the authenticated operator", async () => {
    h.state.session = { lawyer_id: ID };
    const res = await POST(request("POST", { action: "enroll", journeyId: ID, prospectId: ID }));
    expect(responseStatus(res)).toBe(201);
    expect(h.fns.createAgencyFollowupEnrollment).toHaveBeenCalledWith({ journeyId: ID, prospectId: ID, actorId: ID });
  });

  it("requires evidence and review basis fields before calling state-changing services", async () => {
    h.state.session = { lawyer_id: ID };
    expect(responseStatus(await POST(request("POST", { action: "eligibility", enrollmentId: ID, state: "eligible", evidenceRef: " " })))).toBe(400);
    expect(responseStatus(await POST(request("POST", { action: "release", enrollmentId: ID, basis: " " })))).toBe(400);
    expect(h.fns.setAgencyFollowupEligibility).not.toHaveBeenCalled();
    expect(h.fns.releaseAgencyFollowupEnrollment).not.toHaveBeenCalled();
  });
});
