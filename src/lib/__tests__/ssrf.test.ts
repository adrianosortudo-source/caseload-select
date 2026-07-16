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
