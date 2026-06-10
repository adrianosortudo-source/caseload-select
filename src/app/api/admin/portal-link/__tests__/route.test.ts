/**
 * Tests for the operator portal-link minting endpoint
 * (GET /api/admin/portal-link).
 *
 * Focus: the requireOperator gate (adversarial-review fix, 2026-06-09).
 * The route mints a 48-hour lawyer magic link for ANY firmId, so an
 * unauthenticated caller must get 401, not a working link. The real
 * @/lib/admin-auth is exercised; only its getOperatorSession dependency
 * (cookie read) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  operatorSession: { firm_id: string; role: "operator"; exp: number } | null;
}

const state: MockState = {
  operatorSession: null,
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
  generatePortalToken: (firmId: string) => `tok-${firmId}.sig`,
}));

import { GET } from "../route";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";

function makeReq(query: string): Request {
  // The handler only touches req.nextUrl; a stub with a URL is enough.
  return {
    nextUrl: new URL(`https://app.caseloadselect.ca/api/admin/portal-link${query}`),
  } as never;
}

beforeEach(() => {
  state.operatorSession = null;
});

describe("GET /api/admin/portal-link", () => {
  it("returns 401 when no operator session is present", async () => {
    const res = await GET(makeReq(`?firmId=${FIRM_ID}`) as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.magic_link).toBeUndefined();
  });

  it("returns 400 for an operator session without firmId", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    const res = await GET(makeReq("") as never);
    expect(res.status).toBe(400);
  });

  it("returns 200 + magic link for an operator session", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`?firmId=${FIRM_ID}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.magic_link).toContain("/api/portal/login?token=");
    expect(body.magic_link).toContain(encodeURIComponent(`tok-${FIRM_ID}.sig`));
    expect(body.expires_in_hours).toBe(48);
  });
});
