/**
 * Tests for GET /api/dev/login, the local-only operator-session fixture.
 * The critical property is the environment gate: this must 404 on any
 * Vercel deployment (prod or preview) and on any production-mode run, and
 * only succeed under plain `next dev`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

const BASE = "http://localhost:3000";

function req(path: string): NextRequest {
  return new NextRequest(`${BASE}${path}`);
}

beforeEach(() => {
  vi.stubEnv("PORTAL_SECRET", "test-secret-for-dev-login-route");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/dev/login", () => {
  it("404s when VERCEL is set, even outside production NODE_ENV", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "test");
    const res = await GET(req("/api/dev/login"));
    expect(res.status).toBe(404);
  });

  it("404s when NODE_ENV is production, even without VERCEL set", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await GET(req("/api/dev/login"));
    expect(res.status).toBe(404);
  });

  it("redirects and sets an operator session cookie under plain local dev", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "test");
    const res = await GET(req("/api/dev/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/seo-check");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("portal_session=");
  });

  it("honours a same-origin redirect target", async () => {
    vi.stubEnv("VERCEL", "");
    const res = await GET(req("/api/dev/login?redirect=/admin/prospecting-diagnostic"));
    expect(res.headers.get("location")).toContain("/admin/prospecting-diagnostic");
  });

  it("refuses an open-redirect target and falls back to the default", async () => {
    vi.stubEnv("VERCEL", "");
    const res = await GET(req("/api/dev/login?redirect=//evil.example.com/steal"));
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("evil.example.com");
    expect(location).toContain("/admin/seo-check");
  });
});
