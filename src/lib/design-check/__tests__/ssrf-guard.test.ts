/**
 * Unit tests for src/lib/design-check/ssrf-guard.ts.
 *
 * Written as part of closing the redirect-bypass finding in
 * renderer.ts (guardContextRoutes): ssrf-guard.ts had zero unit tests
 * before this fix despite being the sole SSRF decision point for both the
 * top-level render and the per-hop redirect checks. These tests cover the
 * function in isolation; renderer.redirect.test.ts covers the redirect
 * chain that actually calls it hop-by-hop.
 *
 * Every case here uses a literal IP address as the hostname, never a
 * symbolic hostname that requires a real DNS query: dns.lookup() on a
 * literal IP resolves locally (no network I/O), matching the offline test
 * environment this suite runs in. isIP()-driven range classification is
 * already covered exhaustively for src/lib/ssrf.ts's own ipInBlockedRange;
 * these tests exercise checkOutboundRequest's own logic (protocol gate,
 * the static hostname blocklist, the DNS-resolve-then-range-check path,
 * and the "resolution failed -> refuse" fail-closed branch), not
 * re-deriving the range table.
 */

import { describe, it, expect, vi } from "vitest";
import { checkOutboundRequest } from "../ssrf-guard";

describe("checkOutboundRequest", () => {
  describe("blocks private/internal/reserved IP literals", () => {
    const blockedIps = [
      "127.0.0.1", // loopback
      "169.254.169.254", // link-local / cloud metadata
      "10.0.0.1", // RFC1918
      "172.16.0.1", // RFC1918
      "192.168.1.1", // RFC1918
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "192.0.2.1", // TEST-NET-1
    ];

    for (const ip of blockedIps) {
      it(`blocks http://${ip}`, async () => {
        const result = await checkOutboundRequest(`http://${ip}/`);
        expect(result.blocked).toBe(true);
        // A literal IP in a blocked range is caught by isSsrfBlocked()
        // itself (the fast, no-DNS literal check), before resolveAll()
        // ever runs, so the reason is "blocked_hostname", not
        // "blocked_ip". "blocked_ip" is reserved for the DNS-rebinding
        // path below: a *symbolic* hostname that only turns out to
        // resolve to a blocked address once looked up.
        expect(result.reason).toBe("blocked_hostname");
      });
    }

    it("blocks the IPv6 loopback literal", async () => {
      const result = await checkOutboundRequest("http://[::1]/");
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("blocked_hostname");
    });
  });


  describe("blocks the static hostname blocklist", () => {
    it("blocks localhost", async () => {
      const result = await checkOutboundRequest("http://localhost/");
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("blocked_hostname");
    });

    it("blocks the cloud metadata hostname", async () => {
      const result = await checkOutboundRequest("http://metadata.google.internal/");
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("blocked_hostname");
    });
  });

  describe("allows public IP literals", () => {
    const publicIps = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];

    for (const ip of publicIps) {
      it(`allows http://${ip}`, async () => {
        const result = await checkOutboundRequest(`http://${ip}/`);
        expect(result.blocked).toBe(false);
      });
    }
  });

  describe("protocol gate", () => {
    it("blocks an unsupported/unparseable URL", async () => {
      const result = await checkOutboundRequest("not a url");
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("unsupported_protocol");
    });

    it("does not block non-network schemes (data:) — nothing to fetch", async () => {
      const result = await checkOutboundRequest("data:text/plain;base64,aGVsbG8=");
      expect(result.blocked).toBe(false);
    });

    it("does not block about:blank", async () => {
      const result = await checkOutboundRequest("about:blank");
      expect(result.blocked).toBe(false);
    });
  });

  describe("DNS resolution failure fails closed", () => {
    it("blocks a hostname that cannot be resolved rather than allowing it through", async () => {
      // A syntactically valid but unresolvable hostname (invalid TLD,
      // never delegated). No real network call succeeds for this, so
      // resolveAll() returns [] regardless of whether this sandbox has
      // outbound network access, and checkOutboundRequest must refuse
      // rather than let an unresolvable host through.
      const result = await checkOutboundRequest("http://this-host-does-not-exist.invalid/");
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("dns_failed");
    });
  });
});

describe("checkOutboundRequest — DNS-rebinding shape (symbolic hostname resolving to a blocked address)", () => {
  // A hostname that is NOT on the static blocklist and is not itself an IP
  // literal, so isSsrfBlocked() lets it through, but whose real DNS
  // resolution (mocked here so the test is offline and deterministic)
  // answers with a private/loopback address. This is the specific case
  // resolveAll()+ipInBlockedRange() exists for, distinct from every case
  // above where the block was decided from the hostname string alone.
  it("reports blocked_ip when the resolved address is in a blocked range", async () => {
    vi.resetModules();
    vi.doMock("node:dns", () => ({
      lookup: (
        _hostname: string,
        _opts: unknown,
        cb: (err: Error | null, addresses: { address: string; family: number }[]) => void
      ) => cb(null, [{ address: "127.0.0.1", family: 4 }]),
    }));
    const { checkOutboundRequest: checkWithMockedDns } = await import("../ssrf-guard");
    const result = await checkWithMockedDns("http://looks-public.example.test/");
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("blocked_ip");
    vi.doUnmock("node:dns");
    vi.resetModules();
  });
});
