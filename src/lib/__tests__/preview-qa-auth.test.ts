import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  host: "preview-qa-git-example.vercel.app",
  pathname: "/admin/prospects",
  method: "GET",
  cookie: undefined as string | undefined,
  registryActive: true,
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    rpc: (_name: string) => Promise.resolve({ data: state.registryActive, error: null }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => {
      if (name === "host") return state.host;
      if (name === "x-caseload-request-path") return state.pathname;
      if (name === "x-caseload-request-method") return state.method;
      return null;
    },
  }),
  cookies: async () => ({
    get: (name: string) => name === "preview_qa_session" && state.cookie
      ? { value: state.cookie }
      : undefined,
  }),
}));

import {
  createPreviewQaSession,
  getPreviewQaReadSession,
  isPreviewQaBootstrapAuthorized,
  isPreviewQaEnvironment,
  verifyPreviewQaSession,
} from "../preview-qa-auth";
import { isPreviewQaReadRequest } from "../preview-qa-policy";

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PREVIEW_QA_ENABLED", "true");
  vi.stubEnv("VERCEL_URL", state.host);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://preview-project.supabase.co");
  vi.stubEnv("PREVIEW_QA_ALLOWED_SUPABASE_PROJECT_REF", "preview-project");
  vi.stubEnv("PREVIEW_QA_SIGNING_SECRET", "preview-qa-signing-secret-that-is-long-enough");
  vi.stubEnv("PREVIEW_QA_ACCESS_SECRET", "preview-qa-access-secret");
  vi.stubEnv("PREVIEW_QA_BOOTSTRAP_NONCE", "preview-qa-bootstrap-nonce");
  vi.stubEnv("PREVIEW_QA_BOOTSTRAP_GRANT_ID", "11111111-1111-4111-8111-111111111111");
  vi.stubEnv("PREVIEW_QA_TOKEN_VERSION", "preview-qa-token-v1");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
  state.pathname = "/admin/prospects";
  state.method = "GET";
  state.cookie = undefined;
  state.registryActive = true;
});

afterEach(() => vi.unstubAllEnvs());

describe("preview QA principal", () => {
  it("issues a separate short-lived read-only credential bound to the exact deployment", async () => {
    const issued = await createPreviewQaSession(state.host, "preview-qa-bootstrap-nonce");
    expect(issued).not.toBeNull();
    expect(issued?.name).toBe("preview_qa_session");
    expect(issued?.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", maxAge: 900 });
    expect(issued?.session).toMatchObject({
      purpose: "preview_qa_read",
      audience: state.host,
      capability: "read",
      commit_sha: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(issued?.session.session_id).toEqual(expect.any(String));
    await expect(verifyPreviewQaSession(issued!.value, state.host)).resolves.toMatchObject({ capability: "read" });
  });

  it("rejects a copied credential on another preview deployment", async () => {
    const issued = await createPreviewQaSession(state.host, "preview-qa-bootstrap-nonce");
    await expect(verifyPreviewQaSession(issued!.value, "other-preview.vercel.app")).resolves.toBeNull();
  });

  it("rejects tampering and never accepts a QA credential as a broad page grant", async () => {
    const issued = await createPreviewQaSession(state.host, "preview-qa-bootstrap-nonce");
    await expect(verifyPreviewQaSession(`${issued!.value}x`, state.host)).resolves.toBeNull();

    state.cookie = issued!.value;
    state.pathname = "/admin/triage";
    expect(await getPreviewQaReadSession()).toBeNull();
    state.pathname = "/admin/prospects";
    state.method = "POST";
    expect(await getPreviewQaReadSession()).toBeNull();
  });

  it("fails closed outside preview and when preview data points at production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPreviewQaEnvironment(state.host)).toBe(false);

    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ssxryjxifwiivghglqer.supabase.co");
    expect(isPreviewQaEnvironment(state.host)).toBe(false);
    await expect(createPreviewQaSession(state.host, "preview-qa-bootstrap-nonce")).resolves.toBeNull();
  });

  it("fails closed when the live registry cannot validate the session", async () => {
    const issued = await createPreviewQaSession(state.host, "preview-qa-bootstrap-nonce");
    state.registryActive = false;
    await expect(verifyPreviewQaSession(issued!.value, state.host)).resolves.toBeNull();
  });

  it("requires the dedicated bootstrap secret and exact configured host", () => {
    expect(isPreviewQaBootstrapAuthorized(state.host, "wrong", "preview-qa-bootstrap-nonce")).toBe(false);
    expect(isPreviewQaBootstrapAuthorized(state.host, "preview-qa-access-secret", "wrong")).toBe(false);
    expect(isPreviewQaBootstrapAuthorized("attacker.vercel.app", "preview-qa-access-secret", "preview-qa-bootstrap-nonce")).toBe(false);
    expect(isPreviewQaBootstrapAuthorized(state.host, "preview-qa-access-secret", "preview-qa-bootstrap-nonce")).toBe(true);
  });

  it("permits only safe runtime assets in addition to the exact read allowlist", () => {
    expect(isPreviewQaReadRequest("/_next/static/chunks/app.js", "GET")).toBe(true);
    expect(isPreviewQaReadRequest("/_next/image", "HEAD")).toBe(true);
    expect(isPreviewQaReadRequest("/favicon.ico", "GET")).toBe(true);
    expect(isPreviewQaReadRequest("/api/admin/prospect-operations/sources", "POST")).toBe(false);
    expect(isPreviewQaReadRequest("/admin/triage", "GET")).toBe(false);
    expect(isPreviewQaReadRequest("/api/public/report.json", "GET")).toBe(false);
  });
});
