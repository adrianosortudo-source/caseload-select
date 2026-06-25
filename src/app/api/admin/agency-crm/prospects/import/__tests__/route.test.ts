/**
 * Bulk prospect import route tests: operator gate + rows[] envelope validation
 * + happy path delegating to importProspects.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const state: { session: { firm_id: string; role: "operator"; exp: number } | null; result: unknown } = {
    session: null,
    result: { ok: true, received: 1, inserted: 1, skipped: 0, invalid: 0, errors: [] },
  };
  const importProspects = vi.fn(() => Promise.resolve(state.result));
  return { state, importProspects };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(h.state.session),
}));
vi.mock("@/lib/agency-prospect-import", () => ({ importProspects: h.importProspects }));

import { POST } from "../route";

const BASE = "https://app.caseloadselect.ca/api/admin/agency-crm/prospects/import";
function req(body?: unknown): NextRequest {
  return new NextRequest(BASE, {
    method: "POST",
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}
function asOperator(): void {
  h.state.session = { firm_id: "11111111-1111-1111-1111-111111111111", role: "operator", exp: Date.now() + 1000 };
}

beforeEach(() => {
  h.state.session = null;
  h.state.result = { received: 1, inserted: 1, skipped: 0, invalid: 0, errors: [] };
  h.importProspects.mockClear();
});

describe("POST /api/admin/agency-crm/prospects/import", () => {
  it("returns 401 without an operator session and does not import", async () => {
    const res = await POST(req({ rows: [{ firm_name: "Acme" }] }));
    expect(res.status).toBe(401);
    expect(h.importProspects).not.toHaveBeenCalled();
  });

  it("returns 400 when rows[] is missing", async () => {
    asOperator();
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ rows: "nope" }))).status).toBe(400);
  });

  it("returns 400 when rows[] is empty", async () => {
    asOperator();
    expect((await POST(req({ rows: [] }))).status).toBe(400);
  });

  it("returns 400 when rows[] exceeds the cap", async () => {
    asOperator();
    const rows = Array.from({ length: 10001 }, (_, i) => ({ firm_name: `Firm ${i}` }));
    expect((await POST(req({ rows }))).status).toBe(400);
    expect(h.importProspects).not.toHaveBeenCalled();
  });

  it("imports on the happy path and returns the result", async () => {
    asOperator();
    h.state.result = { ok: true, received: 2, inserted: 2, skipped: 0, invalid: 0, errors: [] };
    const res = await POST(req({ rows: [{ firm_name: "Acme" }, { firm_name: "Beta" }] }));
    expect(res.status).toBe(200);
    expect(h.importProspects).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.inserted).toBe(2);
  });

  it("returns a non-2xx with the result when a chunk failed", async () => {
    asOperator();
    h.state.result = { ok: false, received: 3, inserted: 1, skipped: 0, invalid: 0, errors: ["insert boom"] };
    const res = await POST(req({ rows: [{ firm_name: "Acme" }, { firm_name: "Beta" }, { firm_name: "Gamma" }] }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.errors).toContain("insert boom");
    expect(body.error).toMatch(/failed/i);
  });
});
