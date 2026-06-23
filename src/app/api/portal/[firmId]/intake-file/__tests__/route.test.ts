/**
 * Tests for the firm-gated intake-attachment signer
 * (GET /api/portal/[firmId]/intake-file). Closes F9: the bucket is private,
 * and access is authorized + path-scoped before a signed URL is minted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "1f5a2391-85d8-45a2-b427-90441e78a93c";

type Session = { firm_id: string; role: "lawyer" | "operator" | "client"; exp: number } | null;
const state: { session: Session; signed: { signedUrl: string } | null } = {
  session: null,
  signed: { signedUrl: "https://storage.example/signed?token=abc" },
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        createSignedUrl: () =>
          Promise.resolve({ data: state.signed, error: state.signed ? null : { message: "no" } }),
      }),
    },
  },
}));

import { GET } from "../route";

function makeReq(path: string | null) {
  const url = new URL(`https://app.caseloadselect.ca/api/portal/${FIRM}/intake-file`);
  if (path !== null) url.searchParams.set("path", path);
  return { nextUrl: url } as never;
}
const params = () => ({ params: Promise.resolve({ firmId: FIRM }) }) as never;

beforeEach(() => {
  state.session = null;
  state.signed = { signedUrl: "https://storage.example/signed?token=abc" };
});

describe("GET intake-file", () => {
  it("401 when unauthenticated", async () => {
    const res = await GET(makeReq(`${FIRM}/sess/1-a.pdf`), params());
    expect(res.status).toBe(401);
  });

  it("401 for a client session", async () => {
    state.session = { firm_id: FIRM, role: "client", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`${FIRM}/sess/1-a.pdf`), params());
    expect(res.status).toBe(401);
  });

  it("401 for a lawyer of another firm", async () => {
    state.session = { firm_id: "other", role: "lawyer", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`${FIRM}/sess/1-a.pdf`), params());
    expect(res.status).toBe(401);
  });

  it("400 when the path is missing", async () => {
    state.session = { firm_id: FIRM, role: "lawyer", exp: Date.now() + 1000 };
    const res = await GET(makeReq(null), params());
    expect(res.status).toBe(400);
  });

  it("400 when the path is for another firm (no cross-firm signing)", async () => {
    state.session = { firm_id: FIRM, role: "lawyer", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`other-firm/sess/1-a.pdf`), params());
    expect(res.status).toBe(400);
  });

  it("redirects to the signed URL for a matching lawyer", async () => {
    state.session = { firm_id: FIRM, role: "lawyer", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`${FIRM}/sess/1-a.pdf`), params());
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe("https://storage.example/signed?token=abc");
  });

  it("redirects for an operator (cross-firm) signing the firm in the URL", async () => {
    state.session = { firm_id: "anything", role: "operator", exp: Date.now() + 1000 };
    const res = await GET(makeReq(`${FIRM}/sess/1-a.pdf`), params());
    expect(res.headers.get("location")).toBe("https://storage.example/signed?token=abc");
  });

  it("404 when the object cannot be signed", async () => {
    state.session = { firm_id: FIRM, role: "lawyer", exp: Date.now() + 1000 };
    state.signed = null;
    const res = await GET(makeReq(`${FIRM}/sess/1-a.pdf`), params());
    expect(res.status).toBe(404);
  });
});
