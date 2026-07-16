/**
 * ssrf.ts: pure range/hostname classification and pre-fetch URL validation.
 * The full bypass list a URL-fetching validator must refuse.
 */

import { describe, it, expect } from "vitest";
import { ipInBlockedRange, isSsrfBlocked, validateOutboundUrl } from "@/lib/ssrf";

describe("ipInBlockedRange", () => {
  it("blocks loopback, private RFC1918, link-local, CGNAT, and metadata addresses", () => {
    const blocked = [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "169.254.1.1",
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1",
    ];
    for (const ip of blocked) expect(ipInBlockedRange(ip), ip).toBe(true);
  });

  it("allows global unicast IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(ipInBlockedRange(ip), ip).toBe(false);
    }
  });

  it("blocks the RFC 5737 documentation (TEST-NET) ranges", () => {
    expect(ipInBlockedRange("192.0.2.1")).toBe(true); // TEST-NET-1
    expect(ipInBlockedRange("198.51.100.1")).toBe(true); // TEST-NET-2
    expect(ipInBlockedRange("203.0.113.1")).toBe(true); // TEST-NET-3
  });

  it("blocks the RFC 2544 benchmarking range 198.18.0.0/15", () => {
    expect(ipInBlockedRange("198.18.0.1")).toBe(true);
    expect(ipInBlockedRange("198.19.255.254")).toBe(true);
    expect(ipInBlockedRange("198.20.0.1")).toBe(false); // just outside the /15
  });

  it("blocks the RFC 3068 6to4 relay anycast range 192.88.99.0/24", () => {
    expect(ipInBlockedRange("192.88.99.1")).toBe(true);
  });

  it("blocks IPv6 loopback and unspecified", () => {
    expect(ipInBlockedRange("::1")).toBe(true);
    expect(ipInBlockedRange("::")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 addresses by recursing into the embedded IPv4", () => {
    expect(ipInBlockedRange("::ffff:127.0.0.1")).toBe(true);
    expect(ipInBlockedRange("::ffff:169.254.169.254")).toBe(true);
    expect(ipInBlockedRange("::ffff:8.8.8.8")).toBe(false);
  });

  it("blocks NAT64-embedded private/metadata IPv4 addresses", () => {
    expect(ipInBlockedRange("64:ff9b::169.254.169.254")).toBe(true);
    expect(ipInBlockedRange("64:ff9b::a9fe:a9fe")).toBe(true); // 169.254.169.254 in hex groups
  });

  it("blocks 6to4-embedded private/metadata IPv4 addresses", () => {
    // 2002:AABB:CCDD::/48 encodes AA.BB.CC.DD immediately after the /16 prefix.
    expect(ipInBlockedRange("2002:a9fe:a9fe::")).toBe(true); // 169.254.169.254
    expect(ipInBlockedRange("2002:7f00:1::")).toBe(true); // 127.0.0.1
    expect(ipInBlockedRange("2002:0a00:0001::")).toBe(true); // 10.0.0.1
  });

  it("allows a 6to4 address that embeds a genuinely public IPv4", () => {
    expect(ipInBlockedRange("2002:0808:0808::")).toBe(false); // 8.8.8.8
  });

  it("blocks the Teredo tunneling range 2001:0000::/32 outright", () => {
    expect(ipInBlockedRange("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toBe(true);
    expect(ipInBlockedRange("2001::1")).toBe(true);
  });

  it("blocks IPv6 link-local, unique-local, deprecated site-local, and multicast", () => {
    expect(ipInBlockedRange("fe80::1")).toBe(true);
    expect(ipInBlockedRange("fc00::1")).toBe(true);
    expect(ipInBlockedRange("fd00::1")).toBe(true);
    expect(ipInBlockedRange("fec0::1")).toBe(true);
    expect(ipInBlockedRange("feff::1")).toBe(true);
    expect(ipInBlockedRange("ff00::1")).toBe(true);
    expect(ipInBlockedRange("fe7f::1")).toBe(false); // just below link-local
  });

  it("allows global unicast IPv6", () => {
    expect(ipInBlockedRange("2606:4700:4700::1111")).toBe(false);
  });
});

describe("isSsrfBlocked", () => {
  it("blocks the explicit hostname blocklist", () => {
    expect(isSsrfBlocked("localhost")).toBe(true);
    expect(isSsrfBlocked("metadata.google.internal")).toBe(true);
    expect(isSsrfBlocked("169.254.169.254")).toBe(true);
  });

  it("blocks a hostname that is itself a blocked IP literal", () => {
    expect(isSsrfBlocked("127.0.0.1")).toBe(true);
    expect(isSsrfBlocked("[::1]")).toBe(true);
  });

  it("allows an ordinary public hostname", () => {
    expect(isSsrfBlocked("drglaw.ca")).toBe(false);
    expect(isSsrfBlocked("example.com")).toBe(false);
  });
});

describe("validateOutboundUrl", () => {
  it("rejects non-https schemes by default", () => {
    const result = validateOutboundUrl(new URL("http://drglaw.ca/page"));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unsupported protocol/);
  });

  it("accepts http when explicitly allowed", () => {
    const result = validateOutboundUrl(new URL("http://drglaw.ca/page"), { allowedSchemes: ["http:", "https:"] });
    expect(result.ok).toBe(true);
  });

  it("rejects a credential-bearing URL", () => {
    const result = validateOutboundUrl(new URL("https://user:pass@drglaw.ca/page"));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/embedded credentials/);
  });

  it("rejects a blocked hostname (localhost)", () => {
    const result = validateOutboundUrl(new URL("https://localhost/page"));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/blocked/);
  });

  it("rejects an IP-literal URL in a private range", () => {
    const result = validateOutboundUrl(new URL("https://127.0.0.1/page"));
    expect(result.ok).toBe(false);
  });

  it("rejects the cloud metadata address", () => {
    const result = validateOutboundUrl(new URL("https://169.254.169.254/latest/meta-data/"));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/blocked/);
  });

  it("accepts a valid firm host over https", () => {
    const result = validateOutboundUrl(new URL("https://drglaw.ca/journal/example"));
    expect(result.ok).toBe(true);
  });

  it("accepts an unrelated public hostname (host-authenticity is a separate, caller-side check)", () => {
    const result = validateOutboundUrl(new URL("https://someoneelse.com/page"));
    expect(result.ok).toBe(true);
  });

  it("accepts a same-origin www redirect target", () => {
    const result = validateOutboundUrl(new URL("https://www.drglaw.ca/journal/example"));
    expect(result.ok).toBe(true);
  });
});

/**
 * These cases go through `new URL()` on purpose.
 *
 * Every caller reaches this classifier via a URL's `hostname`, never via a
 * hand-written literal, and WHATWG re-serializes IPv6 to its own canonical
 * hex form. A suite that only calls ipInBlockedRange("::ffff:127.0.0.1")
 * with the dotted string tests a shape production can never produce, and so
 * stayed green while "[::ffff:7f00:1]" was reachable. Assert on the same
 * input shape the real code path sees.
 */
describe("validateOutboundUrl: IPv4-in-IPv6 embeddings via new URL() (the real input shape)", () => {
  it.each([
    ["IPv4-mapped cloud metadata", "https://[::ffff:169.254.169.254]/latest/meta-data/"],
    ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/"],
    ["IPv4-mapped RFC1918 10/8", "https://[::ffff:10.0.0.1]/"],
    ["IPv4-mapped RFC1918 192.168/16", "https://[::ffff:192.168.1.1]/"],
    ["IPv4-compatible metadata (deprecated ::/96)", "https://[::a9fe:a9fe]/"],
    ["IPv4-translated metadata (RFC 2765)", "https://[::ffff:0:a9fe:a9fe]/"],
  ])("blocks %s", (_label, url) => {
    const result = validateOutboundUrl(new URL(url));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/blocked/);
  });

  it("blocks the mapped form after new URL() has normalized it to hex", () => {
    // Pins the exact normalization that made the dotted-only match dead code.
    const url = new URL("https://[::ffff:127.0.0.1]/");
    expect(url.hostname).toBe("[::ffff:7f00:1]");
    expect(validateOutboundUrl(url).ok).toBe(false);
  });

  it("still allows legitimate public IPv6 destinations", () => {
    expect(validateOutboundUrl(new URL("https://[2606:4700:4700::1111]/")).ok).toBe(true);
    expect(validateOutboundUrl(new URL("https://[2001:4860:4860::8888]/")).ok).toBe(true);
  });
});

describe("ipInBlockedRange: IPv6 spelling equivalence", () => {
  it("blocks the dotted and hex spellings of the same mapped address alike", () => {
    expect(ipInBlockedRange("::ffff:127.0.0.1")).toBe(true);
    expect(ipInBlockedRange("::ffff:7f00:1")).toBe(true);
    expect(ipInBlockedRange("::ffff:169.254.169.254")).toBe(true);
    expect(ipInBlockedRange("::ffff:a9fe:a9fe")).toBe(true);
  });

  it("blocks an uncompressed mapped address", () => {
    expect(ipInBlockedRange("0:0:0:0:0:ffff:7f00:1")).toBe(true);
  });

  it("refuses a malformed IPv6 rather than defaulting to allowed", () => {
    expect(ipInBlockedRange("::ffff:zzzz:1")).toBe(true);
    expect(ipInBlockedRange("not-an-ip")).toBe(true);
  });

  it("does not block a public address that merely starts with zeroes", () => {
    expect(ipInBlockedRange("2606:4700:4700::1111")).toBe(false);
  });
});
