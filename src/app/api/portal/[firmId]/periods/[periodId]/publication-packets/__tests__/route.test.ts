/**
 * GET .../publication-packets: the HTTP boundary in front of
 * loadPublicationPacketsForPeriod. Same auth-mock pattern as its sibling
 * .../publication-preflight route.test.ts -- operator-only, 404s when the
 * period does not resolve, 400s without siteOrigin, otherwise passes the
 * result straight through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

const state = {
  isOperator: true,
  result: { packets: [], titles: {}, summary: { published: 0, readyToPublish: 0, needsAttention: 0, total: 0 }, outstanding: [] } as unknown,
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () =>
    Promise.resolve(state.isOperator ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
}));

vi.mock("@/lib/publication-packet-loader", () => ({
  loadPublicationPacketsForPeriod: () => Promise.resolve(state.result),
}));

import { GET } from "../route";

function params() {
  return { params: Promise.resolve({ firmId: FIRM, periodId: PERIOD }) } as never;
}

function reqWithSiteOrigin(siteOrigin: string | null) {
  const url = new URL(`https://app.caseloadselect.ca/api/portal/${FIRM}/periods/${PERIOD}/publication-packets`);
  if (siteOrigin !== null) url.searchParams.set("siteOrigin", siteOrigin);
  return { nextUrl: url } as never;
}

beforeEach(() => {
  state.isOperator = true;
  state.result = { packets: [], titles: {}, summary: { published: 0, readyToPublish: 0, needsAttention: 0, total: 0 }, outstanding: [] };
});

describe("GET publication-packets", () => {
  it("rejects a non-operator session", async () => {
    state.isOperator = false;
    const res = await GET(reqWithSiteOrigin("https://drglaw.ca"), params());
    expect(res.status).toBe(403);
  });

  it("400s when siteOrigin query param is missing", async () => {
    const res = await GET(reqWithSiteOrigin(null), params());
    expect(res.status).toBe(400);
  });

  it("404s when the period does not resolve for this firm", async () => {
    state.result = null;
    const res = await GET(reqWithSiteOrigin("https://drglaw.ca"), params());
    expect(res.status).toBe(404);
  });

  it("returns packets + summary for an operator with siteOrigin supplied", async () => {
    const res = await GET(reqWithSiteOrigin("https://drglaw.ca"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.packets).toEqual([]);
    expect(body.summary).toBeDefined();
  });
});
