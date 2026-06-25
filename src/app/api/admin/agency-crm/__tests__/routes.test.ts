/**
 * Agency CRM (Layer B) route tests.
 *
 * The operator gate, edge validation, and response codes:
 *   - 401 without an operator session (no data fn is called)
 *   - 400 on an invalid stage (prospects + deals, POST + PATCH)
 *   - 400 on an empty PATCH (prospects + deals)
 *   - 400 on a non-UUID id (path param, body id, query id)
 *   - 404 when an update matches no row
 *   - happy-path create/list/update call the expected lib functions
 *
 * portal-auth and the agency-crm data layer are mocked; the real stage/UUID
 * guards (from agency-crm-types) run unmocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  type OperatorSession = { firm_id: string; role: "operator"; exp: number };
  const state: { session: OperatorSession | null; created: unknown; updated: unknown; list: unknown[] } = {
    session: null,
    created: { id: "seed" },
    updated: { id: "seed" },
    list: [],
  };
  const fns = {
    listProspects: vi.fn(() => Promise.resolve(state.list)),
    createProspect: vi.fn(() => Promise.resolve(state.created)),
    updateProspect: vi.fn(() => Promise.resolve(state.updated)),
    listDeals: vi.fn(() => Promise.resolve(state.list)),
    createDeal: vi.fn(() => Promise.resolve(state.created)),
    updateDeal: vi.fn(() => Promise.resolve(state.updated)),
    listReminders: vi.fn(() => Promise.resolve(state.list)),
    createReminder: vi.fn(() => Promise.resolve(state.created)),
    updateReminder: vi.fn(() => Promise.resolve(state.updated)),
  };
  return { state, fns };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(h.state.session),
}));
vi.mock("@/lib/agency-crm", async () => {
  const types = await vi.importActual<typeof import("@/lib/agency-crm-types")>("@/lib/agency-crm-types");
  return { ...types, ...h.fns };
});

import { GET as prospectsGET, POST as prospectsPOST } from "../prospects/route";
import { PATCH as prospectPATCH } from "../prospects/[id]/route";
import { GET as dealsGET, POST as dealsPOST } from "../deals/route";
import { PATCH as dealPATCH } from "../deals/[id]/route";
import { GET as remindersGET, POST as remindersPOST } from "../reminders/route";
import { PATCH as reminderPATCH } from "../reminders/[id]/route";

const ID = "11111111-1111-1111-1111-111111111111";
const BASE = "https://app.caseloadselect.ca/api/admin/agency-crm";

function req(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}
function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}
function asOperator(): void {
  h.state.session = { firm_id: ID, role: "operator", exp: Date.now() + 1000 };
}

beforeEach(() => {
  h.state.session = null;
  h.state.created = { id: ID };
  h.state.updated = { id: ID };
  h.state.list = [];
  for (const f of Object.values(h.fns)) f.mockClear();
});

describe("agency CRM routes: auth gate", () => {
  it("every handler returns 401 without an operator session and touches no data fn", async () => {
    const results = await Promise.all([
      prospectsGET(req("/prospects", "GET")),
      prospectsPOST(req("/prospects", "POST", { firm_name: "X" })),
      prospectPATCH(req(`/prospects/${ID}`, "PATCH", { stage: "won" }), params(ID)),
      dealsGET(req("/deals", "GET")),
      dealsPOST(req("/deals", "POST", { prospect_id: ID, title: "T" })),
      dealPATCH(req(`/deals/${ID}`, "PATCH", { stage: "won" }), params(ID)),
      remindersGET(req("/reminders", "GET")),
      remindersPOST(req("/reminders", "POST", { due_at: "2026-07-01T00:00:00Z", note: "n" })),
      reminderPATCH(req(`/reminders/${ID}`, "PATCH", { done: true }), params(ID)),
    ]);
    for (const res of results) expect(res.status).toBe(401);
    for (const f of Object.values(h.fns)) expect(f).not.toHaveBeenCalled();
  });
});

describe("agency CRM routes: validation", () => {
  beforeEach(asOperator);

  it("rejects an invalid stage with 400", async () => {
    expect((await prospectsPOST(req("/prospects", "POST", { firm_name: "X", stage: "bogus" }))).status).toBe(400);
    expect((await prospectPATCH(req(`/prospects/${ID}`, "PATCH", { stage: "bogus" }), params(ID))).status).toBe(400);
    expect((await dealsPOST(req("/deals", "POST", { prospect_id: ID, title: "T", stage: "bogus" }))).status).toBe(400);
    expect((await dealPATCH(req(`/deals/${ID}`, "PATCH", { stage: "bogus" }), params(ID))).status).toBe(400);
  });

  it("rejects an empty PATCH for prospects and deals with 400", async () => {
    expect((await prospectPATCH(req(`/prospects/${ID}`, "PATCH", {}), params(ID))).status).toBe(400);
    expect((await dealPATCH(req(`/deals/${ID}`, "PATCH", {}), params(ID))).status).toBe(400);
  });

  it("rejects a non-UUID id with 400 (path, body, and query)", async () => {
    expect((await prospectPATCH(req("/prospects/not-a-uuid", "PATCH", { stage: "won" }), params("not-a-uuid"))).status).toBe(400);
    expect((await dealPATCH(req("/deals/not-a-uuid", "PATCH", { stage: "won" }), params("not-a-uuid"))).status).toBe(400);
    expect((await reminderPATCH(req("/reminders/not-a-uuid", "PATCH", { done: true }), params("not-a-uuid"))).status).toBe(400);
    expect((await dealsPOST(req("/deals", "POST", { prospect_id: "nope", title: "T" }))).status).toBe(400);
    expect((await remindersPOST(req("/reminders", "POST", { due_at: "2026-07-01T00:00:00Z", note: "n", prospect_id: "nope" }))).status).toBe(400);
    expect((await dealsGET(req("/deals?prospect_id=nope", "GET"))).status).toBe(400);
    expect((await remindersGET(req("/reminders?prospect_id=nope", "GET"))).status).toBe(400);
  });

  it("rejects an out-of-range fit_score with 400 (create and update)", async () => {
    expect((await prospectsPOST(req("/prospects", "POST", { firm_name: "X", fit_score: 150 }))).status).toBe(400);
    expect((await prospectPATCH(req(`/prospects/${ID}`, "PATCH", { fit_score: 150 }), params(ID))).status).toBe(400);
  });

  it("maps a no-row update to 404", async () => {
    h.state.updated = null;
    expect((await prospectPATCH(req(`/prospects/${ID}`, "PATCH", { stage: "won" }), params(ID))).status).toBe(404);
    expect((await dealPATCH(req(`/deals/${ID}`, "PATCH", { stage: "won" }), params(ID))).status).toBe(404);
    expect((await reminderPATCH(req(`/reminders/${ID}`, "PATCH", { done: true }), params(ID))).status).toBe(404);
  });
});

describe("agency CRM routes: happy path", () => {
  beforeEach(asOperator);

  it("create/list/update call the expected lib functions", async () => {
    expect((await prospectsPOST(req("/prospects", "POST", { firm_name: "Acme" }))).status).toBe(201);
    expect(h.fns.createProspect).toHaveBeenCalledTimes(1);

    expect((await prospectsGET(req("/prospects", "GET"))).status).toBe(200);
    expect(h.fns.listProspects).toHaveBeenCalledTimes(1);

    h.state.updated = { id: ID, stage: "won" };
    expect((await prospectPATCH(req(`/prospects/${ID}`, "PATCH", { stage: "won" }), params(ID))).status).toBe(200);
    expect(h.fns.updateProspect).toHaveBeenCalledWith(ID, expect.objectContaining({ stage: "won" }));

    expect((await dealsPOST(req("/deals", "POST", { prospect_id: ID, title: "Retainer" }))).status).toBe(201);
    expect(h.fns.createDeal).toHaveBeenCalledTimes(1);

    expect((await remindersPOST(req("/reminders", "POST", { due_at: "2026-07-01T00:00:00Z", note: "Follow up" }))).status).toBe(201);
    expect(h.fns.createReminder).toHaveBeenCalledTimes(1);
  });
});
