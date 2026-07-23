/**
 * GET .../preview/exit: clears the preview cookie and returns to the
 * console. Covers the exit half of required tests 12/13 -- no supabase
 * write of any kind happens on exit.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const state = {
  operatorSession: null as { lawyer_id?: string; role: string } | null,
  writes: [] as string[],
};

beforeAll(() => {
  process.env.PORTAL_SECRET = "test-preview-secret";
});

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      state.writes.push(table);
      return { insert: () => Promise.resolve({ error: null }) };
    },
  },
}));

import { GET } from "../route";

function makeReq(): NextRequest {
  return {
    url: "https://app.caseloadselect.ca/api/portal/eec1d25e-a047-4827-8e4a-6eb96becca2b/preview/exit",
  } as unknown as NextRequest;
}

beforeEach(() => {
  state.operatorSession = null;
  state.writes = [];
});

describe("GET preview/exit", () => {
  it("redirects to /admin", async () => {
    const res = await GET(makeReq());
    expect(res.headers.get("location")).toContain("/admin");
  });

  it("clears the preview cookie (maxAge 0)", async () => {
    const res = await GET(makeReq());
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("portal_preview");
    expect(setCookie.toLowerCase()).toMatch(/max-age=0/);
  });

  it("performs zero supabase writes on exit (no audit table, no other table)", async () => {
    state.operatorSession = { lawyer_id: "op-1", role: "operator" };
    await GET(makeReq());
    expect(state.writes).toHaveLength(0);
  });

  it("is safe to call with no operator session and no preview cookie set", async () => {
    state.operatorSession = null;
    const res = await GET(makeReq());
    expect(res.headers.get("location")).toContain("/admin");
  });
});
