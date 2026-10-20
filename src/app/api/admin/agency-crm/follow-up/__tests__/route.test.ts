import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const state: { session: { lawyer_id?: string } | null } = { session: null };
  const fns = {
    getOperatorSession: vi.fn(() => Promise.resolve(state.session)),
    activateAgencyFollowupJourney: vi.fn(() => Promise.resolve()),
    approveAgencyFollowupMessage: vi.fn(() => Promise.resolve()),
    approveAgencyFollowupTemplateVersion: vi.fn(() => Promise.resolve()),
    createAgencyFollowupJourneyVersion: vi.fn(() => Promise.resolve({ journeyId: "j", version: 1 })),
    createAgencyFollowupEnrollment: vi.fn(() => Promise.resolve({ enrollmentId: "e", messageCount: 1 })),
    createAgencyFollowupTemplateVersion: vi.fn(() => Promise.resolve({ templateVersionId: "t", version: 1 })),
    listAgencyFollowupConsole: vi.fn(() => Promise.resolve({ journeys: [], templates: [], items: [] })),
    pauseAgencyFollowupEnrollment: vi.fn(() => Promise.resolve()),
    releaseAgencyFollowupEnrollment: vi.fn(() => Promise.resolve()),
    setAgencyFollowupEligibility: vi.fn(() => Promise.resolve()),
  };
  return { state, fns };
});

vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: h.fns.getOperatorSession }));
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
    expect(responseStatus(await GET(request("GET")))).toBe(401);
    expect(responseStatus(await POST(request("POST", { action: "enroll" })))).toBe(401);
    h.state.session = {};
    expect(responseStatus(await GET(request("GET")))).toBe(403);
    expect(h.fns.listAgencyFollowupConsole).not.toHaveBeenCalled();
    expect(h.fns.getOperatorSession).toHaveBeenCalledTimes(3);
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

  it("creates reusable template versions and attributes approval to the operator", async () => {
    h.state.session = { lawyer_id: ID };
    const created = await POST(request("POST", { action: "template_create", templateKey: "intro", subject: "Subject", body: "Body" }));
    expect(responseStatus(created)).toBe(201);
    expect(h.fns.createAgencyFollowupTemplateVersion).toHaveBeenCalledWith({ templateKey: "intro", subject: "Subject", body: "Body", actorId: ID });
    expect(responseStatus(await POST(request("POST", { action: "template_approve", templateVersionId: ID })))).toBe(200);
    expect(h.fns.approveAgencyFollowupTemplateVersion).toHaveBeenCalledWith({ templateVersionId: ID, actorId: ID });
  });

  it("validates schedule configuration and ordered approved-template step inputs", async () => {
    h.state.session = { lawyer_id: ID };
    const response = await POST(request("POST", {
      action: "journey_create", journeyKey: "diagnostic", name: "Diagnostic", timezone: "America/Toronto",
      businessDays: [1, 2, 3, 4, 5], localWindowStart: "09:00", localWindowEnd: "17:00", minimumSpacingHours: 168,
      steps: [{ templateVersionId: ID, delayBusinessDays: 0 }],
    }));
    expect(responseStatus(response)).toBe(201);
    expect(h.fns.createAgencyFollowupJourneyVersion).toHaveBeenCalledWith({
      journeyKey: "diagnostic", name: "Diagnostic",
      schedule: { timezone: "America/Toronto", businessDays: [1, 2, 3, 4, 5], localWindowStart: "09:00", localWindowEnd: "17:00", minimumSpacingHours: 168 },
      steps: [{ templateVersionId: ID, delayBusinessDays: 0 }], actorId: ID,
    });
    expect(responseStatus(await POST(request("POST", {
      action: "journey_activate", journeyId: ID,
    })))).toBe(200);
    expect(h.fns.activateAgencyFollowupJourney).toHaveBeenCalledWith({ journeyId: ID, actorId: ID });
  });
});
