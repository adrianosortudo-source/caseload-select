/**
 * Tests for the lightweight triage fingerprint endpoint.
 *
 * /api/portal/[firmId]/triage/stream-check returns the count + latest
 * updated_at of triaging rows for a firm. The TriageRefresh client polls
 * this every 15 seconds while the tab is visible and only triggers a
 * full router.refresh when the fingerprint changes.
 *
 * Coverage:
 *   - Lawyer with matching firm_id: 200 + fingerprint shape
 *   - Lawyer with mismatched firm_id: 401
 *   - Operator session: 200 (cross-firm view permitted)
 *   - No session: 401
 *   - Supabase count error: 500 with error surfaced
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  countResult: { count: number | null; error: { message: string } | null };
  latestResult: { data: { updated_at: string } | null; error: { message: string } | null };
  session: { firm_id: string; role: "lawyer" | "operator"; lawyer_id?: string } | null;
}

const state: MockState = {
  countResult: { count: 0, error: null },
  latestResult: { data: null, error: null },
  session: null,
};

// Capture which status value the route is filtering by so the
// ?status=declined branch can be asserted.
const capturedStatus: { values: string[] } = { values: [] };

vi.mock("@/lib/supabase-admin", () => {
  const makeQuery = () => ({
    select: (_cols: string, _opts?: { count?: string; head?: boolean }) => ({
      eq: (_field: string, _v: unknown) => ({
        eq: (f2: string, v2: unknown) => {
          if (f2 === "status" && typeof v2 === "string") {
            capturedStatus.values.push(v2);
          }
          // count path: terminates here (no order/limit/maybeSingle)
          return Object.assign(Promise.resolve(state.countResult), {
            order: (_orderBy: string, _opts: unknown) => ({
              limit: (_n: number) => ({
                maybeSingle: () => Promise.resolve(state.latestResult),
              }),
            }),
          });
        },
      }),
    }),
  });
  return {
    supabaseAdmin: {
      from: (_table: string) => makeQuery(),
    },
  };
});

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

import { GET } from "../route";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-2222-2222-222222222222";

function makeReq(query: string = ""): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/portal/${FIRM_ID}/triage/stream-check${query}`,
    { method: "GET" },
  );
}

function makeParams(): { params: Promise<{ firmId: string }> } {
  return { params: Promise.resolve({ firmId: FIRM_ID }) };
}

beforeEach(() => {
  state.session = null;
  state.countResult = { count: 0, error: null };
  state.latestResult = { data: null, error: null };
  capturedStatus.values = [];
});

describe("GET /api/portal/[firmId]/triage/stream-check", () => {
  it("returns 401 when no portal session exists", async () => {
    state.session = null;
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session firm_id mismatches the URL firmId", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "lawyer" };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 200 + fingerprint for a matching lawyer session", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "abc" };
    state.countResult = { count: 3, error: null };
    state.latestResult = {
      data: { updated_at: "2026-05-14T12:00:00.000Z" },
      error: null,
    };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(3);
    expect(body.latest_updated_at).toBe("2026-05-14T12:00:00.000Z");
  });

  it("returns count=0 and latest_updated_at=null when no triaging rows exist", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer" };
    state.countResult = { count: 0, error: null };
    state.latestResult = { data: null, error: null };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.latest_updated_at).toBeNull();
  });

  it("operator session bypasses the firm-match check", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "operator" };
    state.countResult = { count: 7, error: null };
    state.latestResult = {
      data: { updated_at: "2026-05-14T13:00:00.000Z" },
      error: null,
    };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(7);
  });

  it("surfaces a 500 when the supabase count query errors", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer" };
    state.countResult = { count: null, error: { message: "connection refused" } };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(500);
  });

  it("defaults to filtering by status='triaging' when no ?status param", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer" };
    state.countResult = { count: 4, error: null };
    const res = await GET(makeReq() as never, makeParams());
    expect(res.status).toBe(200);
    // The route applies .eq("status", X) twice: once for the count, once
    // for the latest_updated_at lookup. Both should be 'triaging'.
    expect(capturedStatus.values.every((v) => v === "triaging")).toBe(true);
    expect(capturedStatus.values.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by status='declined' when ?status=declined is passed", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer" };
    state.countResult = { count: 2, error: null };
    const res = await GET(
      makeReq("?status=declined") as never,
      makeParams(),
    );
    expect(res.status).toBe(200);
    expect(capturedStatus.values.every((v) => v === "declined")).toBe(true);
    expect(capturedStatus.values.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores unknown ?status values and falls back to triaging (no enum drift)", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer" };
    state.countResult = { count: 0, error: null };
    const res = await GET(
      makeReq("?status=garbage") as never,
      makeParams(),
    );
    expect(res.status).toBe(200);
    expect(capturedStatus.values.every((v) => v === "triaging")).toBe(true);
  });
});
