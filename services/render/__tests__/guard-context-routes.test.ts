/**
 * Unit tests for guardContextRoutes in ../renderer.ts.
 *
 * Moved from src/lib/design-check/__tests__/guard-context-routes.test.ts
 * (main app, pre-isolation) as part of docs/BUILD_PLAN_render_isolation_v1.md
 * §3.4, and adapted to the transport swap that section made: the hop loop
 * itself (re-check every redirect target before following it, never let
 * Chromium auto-follow) is unchanged and still proven here, but each hop is
 * now fetched via an injectable `fetchHop` seam backed by
 * ssrfSafeFetchOneHop's pinned-DNS undici transport instead of Playwright's
 * own route.fetch({maxRedirects: 0}), which had no DNS pinning of its own
 * (the original TOCTOU gap this transport swap closes).
 *
 * These first seven tests exercise the loop's control flow against an
 * injected fetchHop, independent of any real browser, DNS, or network:
 * they prove the mechanism (does the handler re-check the Location target
 * and refuse to fetch it when fetchHop rejects it? does a blocked hop abort
 * without ever calling fulfill?), not the real SSRF range logic. The final
 * test proves the DEFAULT fetchHop wiring specifically: that guardContextRoutes,
 * used with no injected fetchHop at all, still refuses a hostname whose real
 * DNS answer lands in a blocked range -- the rebinding case the transport
 * swap exists to close.
 */

import { describe, it, expect, vi } from "vitest";
import type { BrowserContext, Route } from "playwright-core";

type RouteHandler = (route: Route) => Promise<void> | void;

function makeContext(): { context: BrowserContext; getHandler: () => RouteHandler } {
  let handler: RouteHandler | null = null;
  const context = {
    route: vi.fn(async (_pattern: string, h: RouteHandler) => {
      handler = h;
    }),
  } as unknown as BrowserContext;
  return {
    context,
    getHandler: () => {
      if (!handler) throw new Error("route handler was never registered via context.route()");
      return handler;
    },
  };
}

function makeRoute(url: string) {
  const abort = vi.fn(async () => undefined);
  const fulfill = vi.fn(async (_payload?: { status: number; headers?: Record<string, string>; body?: Buffer }) => undefined);
  const continueFn = vi.fn(async () => undefined);
  const route = {
    request: () => ({ url: () => url }),
    abort,
    fulfill,
    continue: continueFn,
  } as unknown as Route;
  return { route, abort, fulfill, continue: continueFn };
}

/** A fetch-standard Response with just enough shape for guardContextRoutes:
 * .status, .headers (a real Headers instance so both .get() and .forEach()
 * work), and .arrayBuffer(). */
function makeFetchResponse(status: number, headers: Record<string, string> = {}, bodyText = ""): Response {
  return {
    status,
    headers: new Headers(headers),
    arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
  } as unknown as Response;
}

describe("guardContextRoutes", () => {
  it("blocks when fetchHop rejects the originally requested URL, without ever fulfilling", async () => {
    const { renderer } = await importRenderer();
    const { context, getHandler } = makeContext();
    const blocked: import("../render-types").BlockedRequestLog[] = [];
    const fetchHop = vi.fn(async (url: string) => {
      if (url.includes("internal")) throw new Error("hostname resolved to a blocked address");
      return makeFetchResponse(200);
    });
    await renderer.guardContextRoutes(context, blocked, fetchHop);
    const handler = getHandler();

    const { route, abort, fulfill } = makeRoute("https://internal.example/");
    await handler(route);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(fulfill).not.toHaveBeenCalled();
    expect(fetchHop).toHaveBeenCalledTimes(1);
    expect(blocked).toEqual([{ url: "https://internal.example/", reason: "hostname resolved to a blocked address" }]);
  });

  it("closes the redirect bypass: refuses a Location header pointing at a blocked address before it is ever fetched", async () => {
    const { renderer } = await importRenderer();
    const { context, getHandler } = makeContext();
    const blocked: import("../render-types").BlockedRequestLog[] = [];
    // Simulates the reported bug precisely: the originally requested URL
    // ("/start") is allowed and redirects; the redirect TARGET
    // ("/internal") is what fetchHop refuses.
    const fetchHop = vi.fn(async (url: string) => {
      if (url.includes("/internal")) throw new Error("hostname resolved to a blocked address");
      return makeFetchResponse(302, { location: "https://public-looking.example/internal" });
    });
    await renderer.guardContextRoutes(context, blocked, fetchHop);
    const handler = getHandler();

    const { route, abort, fulfill } = makeRoute("https://public-looking.example/start");
    await handler(route);

    // The mechanism that actually closes the gap: fetchHop is invoked
    // again with the resolved redirect target, not just the original URL.
    expect(fetchHop).toHaveBeenCalledWith("https://public-looking.example/start", expect.any(Number));
    expect(fetchHop).toHaveBeenCalledWith("https://public-looking.example/internal", expect.any(Number));
    expect(fetchHop).toHaveBeenCalledTimes(2);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(fulfill).not.toHaveBeenCalled();
    expect(blocked.some((b) => b.url === "https://public-looking.example/internal")).toBe(true);
  });

  it("allows a request with no redirect through via route.fulfill with the real status/headers/body, and never calls route.continue for a network request", async () => {
    const { renderer } = await importRenderer();
    const { context, getHandler } = makeContext();
    const blocked: import("../render-types").BlockedRequestLog[] = [];
    const fetchHop = vi.fn(async () => makeFetchResponse(200, { "content-type": "text/html" }, "<html></html>"));
    await renderer.guardContextRoutes(context, blocked, fetchHop);
    const handler = getHandler();

    const { route, abort, fulfill, continue: continueFn } = makeRoute("https://public.example/");
    await handler(route);

    expect(fulfill).toHaveBeenCalledTimes(1);
    const call = fulfill.mock.calls[0][0] as { status: number; headers: Record<string, string>; body: Buffer };
    expect(call.status).toBe(200);
    expect(call.headers["content-type"]).toBe("text/html");
    expect(call.body.toString("utf8")).toBe("<html></html>");
    expect(abort).not.toHaveBeenCalled();
    expect(continueFn).not.toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });

  it("walks a multi-hop safe redirect chain, re-checking every hop via fetchHop, and fulfills with the final response", async () => {
    const { renderer } = await importRenderer();
    const { context, getHandler } = makeContext();
    const blocked: import("../render-types").BlockedRequestLog[] = [];
    let hop = 0;
    const fetchHop = vi.fn(async () => {
      hop++;
      if (hop === 1) return makeFetchResponse(302, { location: "https://a.example/2" });
      if (hop === 2) return makeFetchResponse(302, { location: "https://a.example/3" });
      return makeFetchResponse(200, {}, "final");
    });
    await renderer.guardContextRoutes(context, blocked, fetchHop);
    const handler = getHandler();

    const { route, fulfill } = makeRoute("https://a.example/1");
    await handler(route);

    expect(fetchHop).toHaveBeenCalledWith("https://a.example/1", expect.any(Number));
    expect(fetchHop).toHaveBeenCalledWith("https://a.example/2", expect.any(Number));
    expect(fetchHop).toHaveBeenCalledWith("https://a.example/3", expect.any(Number));
    expect(fulfill).toHaveBeenCalledTimes(1);
    const call = fulfill.mock.calls[0][0] as { status: number; body: Buffer };
    expect(call.status).toBe(200);
    expect(call.body.toString("utf8")).toBe("final");
  });

  it("aborts with too_many_redirects rather than looping forever on a chain that never resolves", async () => {
    const { renderer } = await importRenderer();
    const { context, getHandler } = makeContext();
    const blocked: import("../render-types").BlockedRequestLog[] = [];
    let hop = 0;
    const fetchHop = vi.fn(async () => {
      hop++;
      return makeFetchResponse(302, { location: `https://loop.example/${hop}` });
    });
    await renderer.guardContextRoutes(context, blocked, fetchHop);
    const handler = getHandler();

    const { route, abort, fulfill } = makeRoute("https://loop.example/0");
    await handler(route);

    expect(fulfill).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(blocked.some((b) => b.reason === "too_many_redirects")).toBe(true);
  });

  it("aborts when a redirect response is missing its Location header", async () => {
    const { renderer } = await importRenderer();
    const { context, getHandler } = makeContext();
    const blocked: import("../render-types").BlockedRequestLog[] = [];
    const fetchHop = vi.fn(async () => makeFetchResponse(302, {}));
    await renderer.guardContextRoutes(context, blocked, fetchHop);
    const handler = getHandler();

    const { route, abort } = makeRoute("https://a.example/");
    await handler(route);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(blocked.some((b) => b.reason === "redirect_missing_location")).toBe(true);
  });

  it("passes non-network protocols (data:) straight through via route.continue, without checking or calling fetchHop", async () => {
    const { renderer } = await importRenderer();
    const { context, getHandler } = makeContext();
    const blocked: import("../render-types").BlockedRequestLog[] = [];
    const fetchHop = vi.fn(async () => {
      throw new Error("fetchHop should never be called for a data: url");
    });
    await renderer.guardContextRoutes(context, blocked, fetchHop);
    const handler = getHandler();

    const { route, continue: continueFn, abort, fulfill } = makeRoute("data:text/plain;base64,aGVsbG8=");
    await handler(route);

    expect(continueFn).toHaveBeenCalledTimes(1);
    expect(fetchHop).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(fulfill).not.toHaveBeenCalled();
  });

  it("with the REAL default fetchHop wiring (no injected mock), refuses a hostname whose real DNS answer lands in a blocked range", async () => {
    // Exercises the actual production wiring, not a stand-in: this proves
    // guardContextRoutes' default parameter really does resolve to the
    // pinned-DNS transport end to end, down to the DNS-rebinding boundary,
    // the same shape of proof ssrf-guard.test.ts's own "DNS-rebinding
    // shape" test gave the retired ssrf-guard.ts implementation.
    vi.resetModules();
    vi.doMock("node:dns", () => ({
      lookup: (
        _hostname: string,
        _opts: unknown,
        cb: (err: Error | null, addresses: { address: string; family: number }[]) => void
      ) => cb(null, [{ address: "127.0.0.1", family: 4 }]),
    }));
    const { guardContextRoutes } = await import("../renderer.js");
    const { context, getHandler } = makeContext();
    const blocked: import("../render-types").BlockedRequestLog[] = [];
    await guardContextRoutes(context, blocked); // no third argument -- exercises the real default
    const handler = getHandler();

    const { route, abort, fulfill } = makeRoute("https://looks-public.example.test/");
    await handler(route);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(fulfill).not.toHaveBeenCalled();
    expect(blocked.some((b) => b.reason.includes("blocked address"))).toBe(true);

    vi.doUnmock("node:dns");
    vi.resetModules();
  });
});

/**
 * Every test except the last imports ../renderer fresh via dynamic import
 * so that vi.resetModules() calls (used by the DNS-mocking test) never
 * leave a stale module graph behind for the tests that run after it,
 * regardless of vitest's execution order within this file.
 */
async function importRenderer() {
  const renderer = await import("../renderer.js");
  return { renderer };
}
