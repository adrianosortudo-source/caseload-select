/**
 * Unit tests for guardContextRoutes in ../renderer.ts — the fix for the
 * confirmed redirect-bypass SSRF finding.
 *
 * The bug: the previous implementation (page.route + route.continue())
 * checked checkOutboundRequest() only against the URL Playwright's route
 * handler was invoked with. That handler fires once for the originally
 * requested URL; when that request's response is an HTTP redirect,
 * Chromium follows the Location header internally and Playwright never
 * re-invokes the handler for the redirect target. Confirmed empirically
 * against a real local server + real Chromium during this fix: a page
 * that 302'd to a loopback address rendered through with zero indication
 * the guard had ever run on it (see also renderer.redirect.test.ts, which
 * reproduces that exact scenario end-to-end against a real browser).
 *
 * The fix drives the whole redirect chain itself via route.fetch({
 * maxRedirects: 0 }), re-checking the target of every Location header
 * before ever fetching it, and never calls route.continue() for a
 * network request — Chromium is never given the chance to auto-follow a
 * redirect unchecked.
 *
 * These tests exercise that control flow directly against a mocked
 * Playwright Route/BrowserContext, independent of any real browser or
 * network: they prove the mechanism (does the handler re-check the
 * Location target and refuse to fetch it when checkFn says blocked?), not
 * the real SSRF range logic (checkOutboundRequest's own behavior is
 * covered by ssrf-guard.test.ts). checkFn is injected precisely so this
 * mechanism can be verified without needing a hostname that genuinely
 * resolves to a public address, which this sandbox cannot do offline.
 */

import { describe, it, expect, vi } from "vitest";
import type { BrowserContext, Route } from "playwright-core";
import { guardContextRoutes, type BlockedRequestLog } from "../renderer";
import type { ResolvedRequestCheck } from "../ssrf-guard";

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

interface FakeApiResponse {
  status: () => number;
  headers: () => Record<string, string>;
}

function makeRoute(url: string, fetchImpl: (opts?: { url?: string }) => Promise<FakeApiResponse>) {
  const abort = vi.fn(async () => undefined);
  const fulfill = vi.fn(async () => undefined);
  const continueFn = vi.fn(async () => undefined);
  const fetch = vi.fn(fetchImpl);
  const route = {
    request: () => ({ url: () => url }),
    fetch,
    abort,
    fulfill,
    continue: continueFn,
  } as unknown as Route;
  return { route, abort, fulfill, continue: continueFn, fetch };
}

describe("guardContextRoutes", () => {
  it("blocks when the originally requested URL itself is blocked, without ever calling route.fetch", async () => {
    const { context, getHandler } = makeContext();
    const blocked: BlockedRequestLog[] = [];
    const checkFn = vi.fn(
      async (url: string): Promise<ResolvedRequestCheck> =>
        url.includes("internal") ? { blocked: true, reason: "blocked_ip" } : { blocked: false }
    );
    await guardContextRoutes(context, blocked, checkFn);
    const handler = getHandler();

    const { route, abort, fulfill, fetch } = makeRoute("https://internal.example/", async () => {
      throw new Error("fetch should never be called when the very first hop is already blocked");
    });
    await handler(route);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(fulfill).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(blocked).toEqual([{ url: "https://internal.example/", reason: "blocked_ip" }]);
  });

  it("closes the redirect bypass: blocks a Location header pointing at a blocked address before it is ever fetched", async () => {
    const { context, getHandler } = makeContext();
    const blocked: BlockedRequestLog[] = [];
    // Simulates the reported bug precisely: the originally requested URL
    // ("/start") is allowed; the server's own 302 response then points at
    // an address checkFn refuses ("/internal").
    const checkFn = vi.fn(
      async (url: string): Promise<ResolvedRequestCheck> =>
        url.includes("/internal") ? { blocked: true, reason: "blocked_ip" } : { blocked: false }
    );
    await guardContextRoutes(context, blocked, checkFn);
    const handler = getHandler();

    let fetchCallCount = 0;
    const { route, abort, fulfill, fetch } = makeRoute(
      "https://public-looking.example/start",
      async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return {
            status: () => 302,
            headers: () => ({ location: "https://public-looking.example/internal" }),
          };
        }
        throw new Error("should never fetch the blocked redirect target");
      }
    );

    await handler(route);

    // The mechanism that actually closes the gap: checkFn is invoked
    // again with the resolved redirect target, not just the original URL.
    expect(checkFn).toHaveBeenCalledWith("https://public-looking.example/start");
    expect(checkFn).toHaveBeenCalledWith("https://public-looking.example/internal");
    // And the blocked hop is refused before being fetched a second time --
    // this is a check-before-fetch, not a fetch-then-reject.
    expect(fetchCallCount).toBe(1);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(fulfill).not.toHaveBeenCalled();
    expect(blocked.some((b) => b.url === "https://public-looking.example/internal" && b.reason === "blocked_ip")).toBe(
      true
    );
  });

  it("allows a request with no redirect through via route.fulfill, and never calls route.continue for a network request", async () => {
    const { context, getHandler } = makeContext();
    const blocked: BlockedRequestLog[] = [];
    const checkFn = vi.fn(async (): Promise<ResolvedRequestCheck> => ({ blocked: false }));
    await guardContextRoutes(context, blocked, checkFn);
    const handler = getHandler();

    const fakeResponse = { status: () => 200, headers: () => ({}) };
    const { route, abort, fulfill, continue: continueFn } = makeRoute("https://public.example/", async () => fakeResponse);

    await handler(route);

    expect(fulfill).toHaveBeenCalledWith({ response: fakeResponse });
    expect(abort).not.toHaveBeenCalled();
    expect(continueFn).not.toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });

  it("walks a multi-hop safe redirect chain, re-checking every hop, and fulfills with the final response", async () => {
    const { context, getHandler } = makeContext();
    const blocked: BlockedRequestLog[] = [];
    const checkFn = vi.fn(async (): Promise<ResolvedRequestCheck> => ({ blocked: false }));
    await guardContextRoutes(context, blocked, checkFn);
    const handler = getHandler();

    let hop = 0;
    const finalResponse = { status: () => 200, headers: () => ({}) };
    const { route, fulfill } = makeRoute("https://a.example/1", async () => {
      hop++;
      if (hop === 1) return { status: () => 302, headers: () => ({ location: "https://a.example/2" }) };
      if (hop === 2) return { status: () => 302, headers: () => ({ location: "https://a.example/3" }) };
      return finalResponse;
    });

    await handler(route);

    expect(checkFn).toHaveBeenCalledWith("https://a.example/1");
    expect(checkFn).toHaveBeenCalledWith("https://a.example/2");
    expect(checkFn).toHaveBeenCalledWith("https://a.example/3");
    expect(fulfill).toHaveBeenCalledWith({ response: finalResponse });
  });

  it("aborts with too_many_redirects rather than looping forever on a chain that never resolves", async () => {
    const { context, getHandler } = makeContext();
    const blocked: BlockedRequestLog[] = [];
    const checkFn = vi.fn(async (): Promise<ResolvedRequestCheck> => ({ blocked: false }));
    await guardContextRoutes(context, blocked, checkFn);
    const handler = getHandler();

    let hop = 0;
    const { route, abort, fulfill } = makeRoute("https://loop.example/0", async () => {
      hop++;
      return { status: () => 302, headers: () => ({ location: `https://loop.example/${hop}` }) };
    });

    await handler(route);

    expect(fulfill).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(blocked.some((b) => b.reason === "too_many_redirects")).toBe(true);
  });

  it("aborts when a redirect response is missing its Location header", async () => {
    const { context, getHandler } = makeContext();
    const blocked: BlockedRequestLog[] = [];
    const checkFn = vi.fn(async (): Promise<ResolvedRequestCheck> => ({ blocked: false }));
    await guardContextRoutes(context, blocked, checkFn);
    const handler = getHandler();

    const { route, abort } = makeRoute("https://a.example/", async () => ({
      status: () => 302,
      headers: () => ({}),
    }));

    await handler(route);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(blocked.some((b) => b.reason === "redirect_missing_location")).toBe(true);
  });

  it("passes non-network protocols (data:) straight through via route.continue, without checking or fetching", async () => {
    const { context, getHandler } = makeContext();
    const blocked: BlockedRequestLog[] = [];
    const checkFn = vi.fn(async (): Promise<ResolvedRequestCheck> => ({ blocked: false }));
    await guardContextRoutes(context, blocked, checkFn);
    const handler = getHandler();

    const { route, continue: continueFn, fetch, abort, fulfill } = makeRoute(
      "data:text/plain;base64,aGVsbG8=",
      async () => {
        throw new Error("fetch should never be called for a data: url");
      }
    );

    await handler(route);

    expect(continueFn).toHaveBeenCalledTimes(1);
    expect(checkFn).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(fulfill).not.toHaveBeenCalled();
  });
});
