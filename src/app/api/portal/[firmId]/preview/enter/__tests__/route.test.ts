/**
 * GET .../preview/enter: operator-only entry into support preview.
 * Covers required tests 1, 2, 3, and the entry half of 12/13 (only the
 * permitted audit event is written, no other table touched).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const MATTER = "22222222-2222-2222-2222-222222222222";

beforeAll(() => {
  process.env.PORTAL_SECRET = "test-preview-secret";
});

const state = {
  operatorSession: null as { lawyer_id?: string; role: string } | null,
  loggedOpens: [] as Array<{ operatorId: string | null; firmId: string; matterId?: string | null; target: string }>,
  otherWrites: [] as string[],
  reads: [] as string[],
  matterRow: { id: MATTER } as { id: string } | null,
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/preview-audit", () => ({
  logPreviewOpen: (input: { operatorId: string | null; firmId: string; matterId?: string | null; target: string }) => {
    state.loggedOpens.push(input);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/operator-workspace", () => ({
  clearOperatorWorkspaceCookie: () => ({ name: "operator_workspace", value: "", options: {} }),
}));

// Separates the firm-binding matter READ (client_matters, expected) from
// any other table touch (which would mean something outside the permitted
// audit path wrote or read something it should not have).
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => {
        state.reads.push(table);
        return {
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.matterRow }),
            }),
          }),
        };
      },
      insert: () => {
        state.otherWrites.push(table);
        return Promise.resolve({ error: null });
      },
      update: () => {
        state.otherWrites.push(table);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { GET } from "../route";

function makeReq(firmId: string, query: string): NextRequest {
  const url = `https://app.caseloadselect.ca/api/portal/${firmId}/preview/enter${query}`;
  return {
    url,
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

function params(firmId: string) {
  return { params: Promise.resolve({ firmId }) } as never;
}

beforeEach(() => {
  state.operatorSession = null;
  state.loggedOpens = [];
  state.otherWrites = [];
  state.reads = [];
  state.matterRow = { id: MATTER };
});

describe("GET preview/enter: required test 3 (unauthorized entry rejected)", () => {
  it("redirects to /portal/login and writes no audit event when there is no operator session", async () => {
    state.operatorSession = null;
    const res = await GET(makeReq(FIRM, "?target=lawyer"), params(FIRM));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("/portal/login");
    expect(state.loggedOpens).toHaveLength(0);
  });
});

describe("GET preview/enter: required test 1 (Lawyer decision-maker preview)", () => {
  beforeEach(() => {
    state.operatorSession = { lawyer_id: "op-1", role: "operator" };
  });

  it("sets the preview cookie and redirects into the firm's lawyer triage view", async () => {
    const res = await GET(makeReq(FIRM, "?target=lawyer"), params(FIRM));
    expect(res.headers.get("location")).toContain(`/portal/${FIRM}/triage`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("portal_preview");
  });

  it("logs exactly one permitted audit event, with the correct fields, and writes to no other table", async () => {
    await GET(makeReq(FIRM, "?target=lawyer"), params(FIRM));
    expect(state.loggedOpens).toHaveLength(1);
    expect(state.loggedOpens[0]).toMatchObject({ firmId: FIRM, target: "lawyer" });
    expect(state.otherWrites).toHaveLength(0);
  });
});

describe("GET preview/enter: required test 2 (Client viewer preview)", () => {
  beforeEach(() => {
    state.operatorSession = { lawyer_id: "op-1", role: "operator" };
  });

  it("requires matterId for a client preview", async () => {
    const res = await GET(makeReq(FIRM, "?target=client"), params(FIRM));
    expect(res.status).toBe(400);
    expect(state.loggedOpens).toHaveLength(0);
  });

  it("sets the preview cookie bound to the matter and redirects into the client matter view", async () => {
    const res = await GET(makeReq(FIRM, `?target=client&matterId=${MATTER}`), params(FIRM));
    expect(res.headers.get("location")).toContain(`/portal/${FIRM}/m/${MATTER}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("portal_preview");
  });

  it("logs the audit event with the matter id and writes to no other table", async () => {
    await GET(makeReq(FIRM, `?target=client&matterId=${MATTER}`), params(FIRM));
    expect(state.loggedOpens).toHaveLength(1);
    expect(state.loggedOpens[0]).toMatchObject({ firmId: FIRM, target: "client", matterId: MATTER });
    expect(state.otherWrites).toHaveLength(0);
  });

  it("404s when the matter does not belong to this firm, minting no cookie and logging no audit event", async () => {
    state.matterRow = null;
    const res = await GET(makeReq(FIRM, `?target=client&matterId=${MATTER}`), params(FIRM));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("portal_preview");
    expect(state.loggedOpens).toHaveLength(0);
    expect(state.otherWrites).toHaveLength(0);
  });

  it("performs the firm-binding read only for client previews, never for lawyer previews", async () => {
    await GET(makeReq(FIRM, "?target=lawyer"), params(FIRM));
    expect(state.reads).toHaveLength(0);
  });
});

describe("GET preview/enter: strict target validation", () => {
  beforeEach(() => {
    state.operatorSession = { lawyer_id: "op-1", role: "operator" };
  });

  it("400s on an invalid target value instead of silently defaulting to lawyer", async () => {
    const res = await GET(makeReq(FIRM, "?target=banana"), params(FIRM));
    expect(res.status).toBe(400);
    expect(state.loggedOpens).toHaveLength(0);
  });

  it("400s when target is omitted entirely", async () => {
    const res = await GET(makeReq(FIRM, ""), params(FIRM));
    expect(res.status).toBe(400);
  });
});
