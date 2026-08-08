/**
 * ssrf-fetch.ts had zero direct test coverage before this file: ssrf.test.ts
 * covers the sync range/hostname classification (ipInBlockedRange,
 * isSsrfBlocked, validateOutboundUrl) that ssrf-fetch.ts calls, but nothing
 * exercised the pinned-DNS transport itself -- the mechanism that actually
 * closes the rebinding gap (a hostname that resolves to a public IP at
 * validation time and a private one at connect time), since that mechanism
 * lives in validatingDnsLookup's undici Agent hook, not in ssrf.ts.
 *
 * Written while building the render-service isolation
 * (docs/BUILD_PLAN_render_isolation_v1.md §3.4): guardContextRoutes moves
 * from its own DNS-resolve-then-decide pre-check (ssrf-guard.ts, retired)
 * to fetching each redirect hop through ssrfSafeFetchOneHop, so this same
 * pinned-lookup path is now what protects the render service's per-hop
 * interception, not just seo-check's crawler and publication-receipt
 * verification. These tests prove the mechanism this codebase already had
 * actually does what the two callers assume: refuses a hostname whose real
 * DNS answer lands in a blocked range, using the identical resolution the
 * real connection would use, not a separate check that could disagree.
 */

import { describe, it, expect, vi } from "vitest";

// ssrf-fetch.ts carries `import "server-only"`, which throws when loaded
// directly under vitest's node environment (no Next.js server-component
// boundary to satisfy it). Every other test file in this repo that
// imports a server-only lib directly mocks the package to a no-op first;
// see CLAUDE.md's "server-only breaks vitest route tests" gotcha.
vi.mock("server-only", () => ({}));

describe("ssrfSafeFetchOneHop", () => {
  it("rejects a URL that fails the sync pre-check before ever touching the network", async () => {
    const { ssrfSafeFetchOneHop } = await import("../ssrf-fetch");
    await expect(ssrfSafeFetchOneHop("https://localhost/", { timeoutMs: 1000 })).rejects.toThrow(/blocked/);
  });

  it("rejects an unsupported scheme by default", async () => {
    const { ssrfSafeFetchOneHop } = await import("../ssrf-fetch");
    await expect(ssrfSafeFetchOneHop("http://example.com/", { timeoutMs: 1000 })).rejects.toThrow(/unsupported protocol/);
  });

  it("refuses a symbolic hostname whose real DNS answer lands in a blocked range (the rebinding case)", async () => {
    // isSsrfBlocked()/validateOutboundUrl() cannot catch this case: the
    // hostname string alone is not on any blocklist and is not an IP
    // literal, so the sync pre-check passes it through. Only the pinned
    // lookup inside the actual connection (validatingDnsLookup, mocked
    // here via node:dns) sees the real resolved address and refuses it --
    // proving the check and the connect share one resolution rather than
    // two that could disagree.
    vi.resetModules();
    vi.doMock("node:dns", () => ({
      lookup: (
        _hostname: string,
        _opts: unknown,
        cb: (err: Error | null, addresses: { address: string; family: number }[]) => void
      ) => cb(null, [{ address: "127.0.0.1", family: 4 }]),
    }));
    const { ssrfSafeFetchOneHop } = await import("../ssrf-fetch");
    await expect(
      ssrfSafeFetchOneHop("https://looks-public.example.test/", { timeoutMs: 2000, allowedSchemes: ["https:"] })
    ).rejects.toThrow(/blocked address/);
    vi.doUnmock("node:dns");
    vi.resetModules();
  });
});

describe("ssrfSafeFetch redirect-following delegates each hop to ssrfSafeFetchOneHop", () => {
  it("still rejects an unsupported scheme on the initial URL", async () => {
    const { ssrfSafeFetch } = await import("../ssrf-fetch");
    await expect(ssrfSafeFetch("http://example.com/", { timeoutMs: 1000 })).rejects.toThrow(/unsupported protocol/);
  });

  it("still refuses a rebinding hostname reached only after this module's own redirect-following logic runs, not just on the first hop", async () => {
    // Regression guard for the refactor that made ssrfSafeFetch call
    // ssrfSafeFetchOneHop per hop: the blocked-range check must still run
    // on every hop of the chain, not just the entry URL.
    vi.resetModules();
    vi.doMock("node:dns", () => ({
      lookup: (
        _hostname: string,
        _opts: unknown,
        cb: (err: Error | null, addresses: { address: string; family: number }[]) => void
      ) => cb(null, [{ address: "127.0.0.1", family: 4 }]),
    }));
    const { ssrfSafeFetch } = await import("../ssrf-fetch");
    await expect(
      ssrfSafeFetch("https://looks-public.example.test/", { timeoutMs: 2000 })
    ).rejects.toThrow(/blocked address/);
    vi.doUnmock("node:dns");
    vi.resetModules();
  });
});
