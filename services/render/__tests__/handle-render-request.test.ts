import { describe, it, expect, vi } from "vitest";
import { handleRenderRequest } from "../handle-render-request";
import type { RenderRunResult } from "../render-types";

const ENV = { RENDER_SERVICE_TOKEN: "correct-token" } as NodeJS.ProcessEnv;
const AUTH = "Bearer correct-token";

const SAMPLE_RESULT: RenderRunResult = {
  captures: [
    {
      viewport: "mobile",
      finalUrl: "https://example.com/",
      screenshotPng: "aGVsbG8=", // "hello" base64 -- a placeholder, not a real PNG
      screenshotClippedFromPx: null,
      domSnapshot: {
        spacingValuesPx: [],
        h1Count: 1,
        h1Text: "Hello",
        headingOrder: ["h1"],
        headingSamples: [],
        bodyTextSample: [],
        hasHorizontalOverflow: false,
        viewportMetaContent: null,
        forms: [],
        tapTargets: [],
        hamburgerMenu: { found: false, hasAccessibleLabel: false },
        images: [],
        authority: {
          jsonLd: [],
          metaTitle: null,
          metaDescription: null,
          firmVoicedText: "",
          navLinks: [],
          footerLinks: [],
          authorBylines: [],
          testimonials: [],
          practiceAreaLabels: [],
          disclaimerPresent: false,
        },
        darkPatterns: {
          preCheckedConsentBoxes: [],
          urgencyOrCountdownSignals: [],
          exitIntentScriptSignals: [],
          bandwagonClaimsWithoutProof: [],
        },
      },
      webVitals: { lcpMs: null, cls: null, ttfbMs: null, tbtMs: null },
      blockedRequests: [],
      renderMs: 1234,
    },
  ],
  totalMs: 2000,
};

describe("handleRenderRequest", () => {
  it("rejects a non-POST method with 400 method_not_allowed", async () => {
    const result = await handleRenderRequest(
      { method: "GET", authorizationHeader: AUTH, rawBody: "" },
      { env: ENV }
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "method_not_allowed" });
  });

  it("rejects an unauthenticated request with 401 before ever touching the body", async () => {
    const renderFn = vi.fn();
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: null, rawBody: "not even json" },
      { env: ENV, renderFn }
    );
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: "unauthorized" });
    expect(renderFn).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token with 401", async () => {
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: "Bearer wrong-token", rawBody: JSON.stringify({ url: "https://example.com" }) },
      { env: ENV }
    );
    expect(result.status).toBe(401);
  });

  it("rejects malformed JSON with 400 malformed_json", async () => {
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: "{not json" },
      { env: ENV }
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "malformed_json" });
  });

  it("rejects a body with no url field with 400 missing_url", async () => {
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({}) },
      { env: ENV }
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "missing_url" });
  });

  it("rejects a non-string url with 400 missing_url", async () => {
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: 12345 }) },
      { env: ENV }
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "missing_url" });
  });

  it("rejects an unparseable url string with 400 invalid_url", async () => {
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "not a url" }) },
      { env: ENV }
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_url" });
  });

  it("rejects a blocked hostname with 403 url_blocked, without ever calling renderFn", async () => {
    const renderFn = vi.fn();
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://localhost/" }) },
      { env: ENV, renderFn }
    );
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: "url_blocked" });
    expect(renderFn).not.toHaveBeenCalled();
  });

  it("rejects an internal IP literal with 403 url_blocked", async () => {
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://169.254.169.254/" }) },
      { env: ENV }
    );
    expect(result.status).toBe(403);
  });

  it("returns 429 concurrency_exceeded when the in-flight cap is already at its limit", async () => {
    const renderFn = vi.fn();
    const concurrencyState = { inFlight: 2 };
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://example.com" }) },
      { env: ENV, renderFn, maxConcurrentRenders: 2, concurrencyState }
    );
    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({ error: "concurrency_exceeded" });
    expect(renderFn).not.toHaveBeenCalled();
  });

  it("returns 504 render_timeout when the render does not settle within the budget", async () => {
    const renderFn = () => new Promise<RenderRunResult>(() => {}); // never resolves
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://example.com" }) },
      { env: ENV, renderFn, renderTimeoutMs: 20 }
    );
    expect(result.status).toBe(504);
    expect(result.body).toMatchObject({ error: "render_timeout" });
  });

  it("returns 422 render_failed when renderFn throws, without leaking the underlying error message", async () => {
    const renderFn = () => Promise.reject(new Error("ENOTFOUND some.internal.detail.example"));
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://example.com" }) },
      { env: ENV, renderFn }
    );
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: "render_failed" });
    expect(JSON.stringify(result.body)).not.toContain("ENOTFOUND");
    expect(JSON.stringify(result.body)).not.toContain("some.internal.detail.example");
  });

  it("logs the underlying failure server-side even though the response stays generic", async () => {
    // The counterpart to the assertion above: the caller must learn
    // nothing, but the OPERATOR must learn everything. Shipping the
    // generic response without this log left the first real production
    // render failure undiagnosable -- a 23ms failure reported only as
    // "Could not render this site.", with no way to distinguish a
    // missing Chromium binary from a navigation error. Pinned as a test
    // so the log line cannot be quietly dropped again.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const renderFn = () => Promise.reject(new Error("ENOTFOUND some.internal.detail.example"));
      await handleRenderRequest(
        { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://example.com" }) },
        { env: ENV, renderFn }
      );
      expect(spy).toHaveBeenCalled();
      const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).toContain("ENOTFOUND some.internal.detail.example");
      expect(logged).toContain("https://example.com");
    } finally {
      spy.mockRestore();
    }
  });

  it("logs a distinguishable message on timeout rather than reusing the generic failure log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const renderFn = () => new Promise<RenderRunResult>(() => {});
      await handleRenderRequest(
        { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://example.com" }) },
        { env: ENV, renderFn, renderTimeoutMs: 20 }
      );
      const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).toContain("timed out");
      expect(logged).toContain("https://example.com");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns 200 with the renderFn's result verbatim on success", async () => {
    const renderFn = vi.fn().mockResolvedValue(SAMPLE_RESULT);
    const result = await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://example.com" }) },
      { env: ENV, renderFn }
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual(SAMPLE_RESULT);
    expect(renderFn).toHaveBeenCalledWith("https://example.com");
  });

  it("decrements in-flight state after both a success and a failure, never leaking the counter upward", async () => {
    const concurrencyState = { inFlight: 0 };
    await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://example.com" }) },
      { env: ENV, renderFn: () => Promise.resolve(SAMPLE_RESULT), concurrencyState }
    );
    expect(concurrencyState.inFlight).toBe(0);

    await handleRenderRequest(
      { method: "POST", authorizationHeader: AUTH, rawBody: JSON.stringify({ url: "https://example.com" }) },
      { env: ENV, renderFn: () => Promise.reject(new Error("boom")), concurrencyState }
    );
    expect(concurrencyState.inFlight).toBe(0);
  });
});
