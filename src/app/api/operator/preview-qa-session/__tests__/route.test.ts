import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    rpc: () => Promise.resolve({ data: true, error: null }),
  },
}));

const previewOrigin = "https://preview-qa-git-example.vercel.app";

function request(body: object, options: { origin?: string; url?: string } = {}): NextRequest {
  const url = options.url ?? `${previewOrigin}/api/operator/preview-qa-session`;
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: options.origin ?? previewOrigin,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PREVIEW_QA_ENABLED", "true");
  vi.stubEnv("VERCEL_URL", "preview-qa-git-example.vercel.app");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://preview-project.supabase.co");
  vi.stubEnv("PREVIEW_QA_ALLOWED_SUPABASE_PROJECT_REF", "preview-project");
  vi.stubEnv("PREVIEW_QA_SIGNING_SECRET", "preview-qa-signing-secret-that-is-long-enough");
  vi.stubEnv("PREVIEW_QA_ACCESS_SECRET", "preview-qa-access-secret");
  vi.stubEnv("PREVIEW_QA_BOOTSTRAP_NONCE", "preview-qa-bootstrap-nonce");
  vi.stubEnv("PREVIEW_QA_BOOTSTRAP_GRANT_ID", "11111111-1111-4111-8111-111111111111");
  vi.stubEnv("PREVIEW_QA_TOKEN_VERSION", "preview-qa-token-v1");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/operator/preview-qa-session", () => {
  it("sets only the short-lived QA cookie and returns no secret-bearing body", async () => {
    const res = await POST(request({ accessSecret: "preview-qa-access-secret", bootstrapNonce: "preview-qa-bootstrap-nonce" }));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(res.status).toBe(204);
    expect(cookie).toContain("preview_qa_session=");
    expect(cookie).toContain("Max-Age=900");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("portal_session=");
    expect(cookie).not.toMatch(/\bDomain=/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["wrong secret", request({ accessSecret: "wrong", bootstrapNonce: "preview-qa-bootstrap-nonce" })],
    ["wrong nonce", request({ accessSecret: "preview-qa-access-secret", bootstrapNonce: "wrong" })],
    ["cross-origin request", request({ accessSecret: "preview-qa-access-secret", bootstrapNonce: "preview-qa-bootstrap-nonce" }, { origin: "https://attacker.test" })],
  ])("fails closed for %s", async (_label, req) => {
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not exist in production even with otherwise valid credentials", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await POST(request({ accessSecret: "preview-qa-access-secret", bootstrapNonce: "preview-qa-bootstrap-nonce" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
