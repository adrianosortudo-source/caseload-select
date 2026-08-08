/**
 * Auth-boundary and request-validation coverage for
 * POST /api/admin/caseload-prospects/purge (DR-114).
 *
 * An erasure endpoint that anyone can call is a deletion vector, so the
 * unauthorised path matters as much as the happy one: a rejected caller must
 * never reach the anonymisation function at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(),
  getOperatorSession: vi.fn(),
  anonymize: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: mocks.isCronAuthorized }));

vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: mocks.getOperatorSession }));

// The erasure module is only partially mocked below (its two validation
// helpers stay real, since they are what this suite is checking the route
// wires up), so importOriginal loads the genuine module, which reaches
// supabase-admin at import time and throws without the Supabase env vars.
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: vi.fn() } }));

vi.mock("@/lib/caseload-prospect-erasure", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/caseload-prospect-erasure")
  >();
  return { ...actual, anonymizeCaseloadProspects: mocks.anonymize };
});

import { POST } from "../route";

function makeRequest(body: unknown) {
  return new Request("https://app.caseloadselect.ca/api/admin/caseload-prospects/purge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

beforeEach(() => {
  mocks.isCronAuthorized.mockReset().mockReturnValue(true);
  mocks.getOperatorSession.mockReset().mockResolvedValue(null);
  mocks.anonymize
    .mockReset()
    .mockResolvedValue({ ok: true, anonymized_count: 1, prospect_ids: ["p1"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/admin/caseload-prospects/purge", () => {
  it("rejects a caller with neither a bearer token nor an operator session", async () => {
    mocks.isCronAuthorized.mockReturnValue(false);
    mocks.getOperatorSession.mockResolvedValue(null);

    const res = await POST(makeRequest({ prospect_id: "p1" }));

    expect(res.status).toBe(401);
    expect(mocks.anonymize).not.toHaveBeenCalled();
  });

  it("accepts an operator session when no bearer token is presented", async () => {
    mocks.isCronAuthorized.mockReturnValue(false);
    mocks.getOperatorSession.mockResolvedValue({ role: "operator" });

    const res = await POST(makeRequest({ prospect_id: "p1" }));

    expect(res.status).toBe(200);
    expect(mocks.anonymize).toHaveBeenCalledWith({ prospectId: "p1" }, "subject_request");
  });

  it("rejects a body with no selector", async () => {
    const res = await POST(makeRequest({ reason: "subject_request" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("exactly one") });
    expect(mocks.anonymize).not.toHaveBeenCalled();
  });

  it("rejects a body with two selectors", async () => {
    const res = await POST(makeRequest({ prospect_id: "p1", email: "a@b.ca" }));
    expect(res.status).toBe(400);
    expect(mocks.anonymize).not.toHaveBeenCalled();
  });

  it("rejects an unrecognised reason before touching the database", async () => {
    const res = await POST(makeRequest({ prospect_id: "p1", reason: "because" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid reason" });
    expect(mocks.anonymize).not.toHaveBeenCalled();
  });

  it("passes the email selector through and defaults the reason", async () => {
    const res = await POST(makeRequest({ email: "someone@firm.ca" }));
    expect(res.status).toBe(200);
    expect(mocks.anonymize).toHaveBeenCalledWith(
      { email: "someone@firm.ca" },
      "subject_request",
    );
  });

  it("passes an explicit reason through", async () => {
    const res = await POST(
      makeRequest({ prospect_id: "p1", reason: "internal_test_record" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.anonymize).toHaveBeenCalledWith({ prospectId: "p1" }, "internal_test_record");
  });

  it("reports the count so a zero-match request is visible to the operator", async () => {
    mocks.anonymize.mockResolvedValue({ ok: true, anonymized_count: 0, prospect_ids: [] });
    const res = await POST(makeRequest({ email: "nobody@firm.ca" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, anonymized_count: 0 });
  });

  it("surfaces a failure as a 500 rather than a false success", async () => {
    mocks.anonymize.mockResolvedValue({
      ok: false,
      anonymized_count: 0,
      prospect_ids: [],
      error: "connection reset",
    });
    const res = await POST(makeRequest({ prospect_id: "p1" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "connection reset" });
  });

  it("rejects a malformed JSON body", async () => {
    const bad = new Request(
      "https://app.caseloadselect.ca/api/admin/caseload-prospects/purge",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;
    const res = await POST(bad);
    expect(res.status).toBe(400);
    expect(mocks.anonymize).not.toHaveBeenCalled();
  });
});
